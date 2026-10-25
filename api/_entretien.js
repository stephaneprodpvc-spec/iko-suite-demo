// api/_entretien.js
// Contrats d'entretien : gestion À PART des tickets SAV, mais sur le MÊME planning par agence (une visite réserve un créneau
// du planning, donc impossible de doubler un rendez-vous SAV). Fichier préfixé « _ » : helper partagé, pas une fonction Vercel.
//
// Actions (POST /api/airtable/entretien) :
//   demander        public    : le client demande un contrat (crée un contrat au statut « Demande », jamais un ticket SAV)
//   creneaux        client (lien du mail) ou agence (session) : créneaux libres d'un mois donné (jusqu'à 14 mois à l'avance)
//   planifier       client ou agence : réserve un créneau et l'ajoute aux visites du contrat
//   annuler_visite  client ou agence : libère le créneau (jusqu'à 2 jours avant)
// Les visites sont stockées dans le champ « Visites (JSON) » du contrat : [{ id, date, creneau, planningId, statut }].

import { lireJeton, lienSuivi, normaliserEmail, normaliserTel } from './_suivi.js';
import { creneauxLibres, identDepuisClientId } from './_planning.js';
import { verifierOrigine, verifierDebit, verifierSession } from './_securite.js';
import { signalerAbus } from './_abus.js';
import { enteteMake } from './_make.js';
import { ajouterMailsAuCorps, marqueClient } from './_mail.js';
import { pousserAgence } from './_alertes.js';

const MAKE_WEBHOOK = 'https://hook.eu1.make.com/n3lwi92wldkf22jcemmjfem334p4mv6a';
const TABLE = 'Contrats%20entretien';
const MAX_VISITES = 24;
const HORIZON_MOIS = 14;
const DELAI_ANNULATION_JOURS = 2;
const FREQUENCES = { 'Une fois par an (conseillé)': 12, 'Deux fois par an': 6, 'Tous les 2 ans': 24 };

const iso = (d) => d.toISOString().slice(0, 10);
const nettoyer = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function lireVisites(c) { try { const v = JSON.parse((c.fields || {})['Visites (JSON)'] || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function prochaine(visites) {
  const auj = iso(new Date());
  const f = visites.filter((v) => v.statut !== 'Annulée' && v.date >= auj).map((v) => v.date).sort();
  return f[0] || null;
}

async function airtable(baseId, headers, chemin, options) {
  // Airtable refuse un corps JSON sans « Content-Type: application/json » (erreur 422 constatée en production).
  const entetes = options && options.body ? Object.assign({}, headers, { 'Content-Type': 'application/json' }) : headers;
  const r = await fetch('https://api.airtable.com/v0/' + baseId + '/' + chemin, Object.assign({}, options || {}, { headers: entetes }));
  return r;
}

// Le contrat est-il bien celui de la personne (lien du mail) ou de l'agence connectée ?
async function chargerContratAutorise(baseId, headers, body, session) {
  const id = String(body.contratId || '');
  if (!/^rec[A-Za-z0-9]{10,}$/.test(id)) return { erreur: 'Contrat introuvable.', code: 404 };
  const r = await airtable(baseId, headers, TABLE + '/' + id);
  if (!r.ok) return { erreur: 'Contrat introuvable.', code: 404 };
  const c = await r.json();
  const f = c.fields || {};
  if (typeof body.jeton === 'string' && body.jeton) {
    const identite = lireJeton(body.jeton);
    if (!identite) return { erreur: 'Lien invalide ou expiré.', code: 403, abus: 'jeton-invalide' };
    const memeMail = identite.email && normaliserEmail(f.Email) === identite.email;
    const memeTel = identite.tel && normaliserTel(f['Téléphone']) === identite.tel;
    if (!memeMail && !memeTel) return { erreur: 'Ce contrat n\'est pas le vôtre.', code: 403, abus: 'jeton-invalide' };
    return { contrat: c, auteur: 'client' };
  }
  if (typeof body.reference === 'string' && typeof body.contact === 'string' && body.reference) {
    const ref = body.reference.trim().toUpperCase();
    const email = normaliserEmail(body.contact);
    const tel = email ? '' : normaliserTel(body.contact);
    const memeRef = String(f['Référence'] || '').toUpperCase() === ref;
    const memeContact = (email && normaliserEmail(f.Email) === email) || (tel && normaliserTel(f['Téléphone']) === tel);
    if (!memeRef || !memeContact) return { erreur: 'Contrat introuvable.', code: 404, abus: 'suivi-introuvable' };
    return { contrat: c, auteur: 'client' };
  }
  if (session) {
    const liens = Array.isArray(f['Compte client']) ? f['Compte client'] : [];
    if (session.role === 'SUPER_ADMIN_IKO' || (session.tenantId && liens.includes(session.tenantId))) return { contrat: c, auteur: 'agence' };
  }
  return { erreur: 'Accès refusé.', code: 403, abus: 'acces-refuse' };
}

async function notifierMake(corps, clientId) {
  try {
    ajouterMailsAuCorps(corps, corps.action, await marqueClient(clientId));
    await fetch(MAKE_WEBHOOK, { method: 'POST', headers: enteteMake({ 'Content-Type': 'application/json' }), body: JSON.stringify(corps) });
  } catch (e) { console.error('Entretien : notification Make impossible', e && e.message); }
}

export async function handlerEntretien(req, res, { baseId, headers }) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  if (!verifierOrigine(req)) return res.status(403).json({ error: 'Origine non autorisée.' });
  const body = req.body || {};
  const action = String(body.action || '');
  const session = verifierSession(req);

  try {
    // ------------------------------------------------------------------ demande publique
    if (action === 'demander') {
      if (!verifierDebit(req, { max: 5, fenetreMs: 10 * 60 * 1000, cle: 'entretien-demande' })) return res.status(429).json({ error: 'Trop de demandes. Réessayez dans quelques minutes.' });
      if (body.site) { signalerAbus(req, 'robot'); return res.status(200).json({ ok: true, reference: 'ENT-0000-0000' }); } // champ piège rempli = robot : on fait semblant
      const nom = nettoyer(body.nom, 80), tel = nettoyer(body.tel, 25), mail = nettoyer(body.email, 120), adresse = nettoyer(body.adresse, 200), agence = nettoyer(body.agence, 60);
      if (!nom || !tel || !adresse || !agence || !/^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(mail)) return res.status(400).json({ error: 'Merci de remplir tous les champs obligatoires.' });
      const equip = (Array.isArray(body.equipements) ? body.equipements : []).map((e) => nettoyer(e, 40)).filter(Boolean).slice(0, 10);
      const frequence = FREQUENCES[body.frequence] ? body.frequence : 'Une fois par an (conseillé)';
      const message = nettoyer(body.message, 600);
      let clientId = null;
      const slug = nettoyer(body.client_slug, 60);
      if (slug) {
        const rc = await airtable(baseId, headers, 'Clients?maxRecords=1&filterByFormula=' + encodeURIComponent('{Slug}="' + slug.replace(/"/g, '') + '"'));
        if (rc.ok) { const j = await rc.json(); clientId = (j.records && j.records[0] && j.records[0].id) || null; }
      }
      const reference = 'ENT-' + new Date().getFullYear() + '-' + (Math.floor(Math.random() * 9000) + 1000);
      const fields = { Client: nom, Email: mail, 'Téléphone': tel, Agence: agence, Adresse: adresse, 'Équipements': equip.join(', ') + (message ? ' — ' + message : ''),
        'Périodicité (mois)': FREQUENCES[frequence], 'Statut contrat': 'Demande', 'Carnet (JSON)': '[]', 'Visites (JSON)': '[]', 'Référence': reference, 'Date demande': iso(new Date()) };
      if (clientId) fields['Compte client'] = [clientId];
      const rc2 = await airtable(baseId, headers, TABLE, { method: 'POST', body: JSON.stringify({ fields }) });
      if (!rc2.ok) { console.error('Entretien : création impossible', rc2.status, await rc2.text().catch(() => '')); return res.status(502).json({ error: 'Enregistrement impossible, réessayez dans un instant.' }); }
      const cree = await rc2.json();
      await pousserAgence({ agence, titre: "Nouvelle demande de contrat d'entretien", message: nom + ' — ' + (equip.join(', ') || 'équipements à préciser') });
      await notifierMake({ marque: 'iko', action: 'entretien_demande', marqueur_entretien_demande: '1', ticket: reference, nom, 'e-mail': mail, tel, agence, adresse, equipements: equip.join(', '), frequence, message,
        lien_suivi: lienSuivi(null, { email: mail, tel, ticket: reference }), email_agence: '' }, clientId);
      return res.status(200).json({ ok: true, reference, id: cree.id });
    }

    // ------------------------------------------------------------------ actions sur un contrat existant
    if (!verifierDebit(req, { max: 60, fenetreMs: 10 * 60 * 1000, cle: 'entretien-contrat' })) return res.status(429).json({ error: 'Trop de requêtes. Réessayez dans quelques minutes.' });
    const acces = await chargerContratAutorise(baseId, headers, body, session);
    if (acces.erreur) { if (acces.abus) signalerAbus(req, acces.abus); return res.status(acces.code).json({ error: acces.erreur }); }
    const contrat = acces.contrat, f = contrat.fields || {};
    const clientId = (Array.isArray(f['Compte client']) && f['Compte client'][0]) || null;
    const agence = f.Agence || '';
    const visites = lireVisites(contrat);
    const ctx = { baseId, headers, finAt: Date.now() + 8000 };

    if (action === 'creneaux') {
      if ((f['Statut contrat'] || 'Actif') !== 'Actif') return res.status(200).json({ creneaux: [], raison: 'Le contrat n\'est pas encore actif.' });
      const mois = /^\d{4}-\d{2}$/.test(String(body.mois || '')) ? body.mois : iso(new Date()).slice(0, 7);
      const limite = new Date(); limite.setMonth(limite.getMonth() + HORIZON_MOIS);
      if (mois > iso(limite).slice(0, 7)) return res.status(200).json({ creneaux: [], raison: 'Les dates ne sont pas encore ouvertes (' + HORIZON_MOIS + ' mois maximum à l\'avance).' });
      const ident = await identDepuisClientId(ctx, clientId);
      if (!ident || ident.bloque) return res.status(200).json({ creneaux: [] });
      const r = await creneauxLibres(ctx, ident, { agence, mois, periode: body.periode === 'apres_midi' ? 'apres_midi' : body.periode === 'matin' ? 'matin' : undefined, admin: acces.auteur === 'agence' });
      const pris = new Set(visites.filter((v) => v.statut !== 'Annulée').map((v) => v.date));
      return res.status(200).json({ creneaux: (r.creneaux || []).filter((c) => !pris.has(c.date)).slice(0, 80) });
    }

    if (action === 'planifier') {
      if ((f['Statut contrat'] || 'Actif') !== 'Actif') return res.status(409).json({ error: 'Le contrat n\'est pas encore actif.' });
      if (visites.filter((v) => v.statut !== 'Annulée').length >= MAX_VISITES) return res.status(409).json({ error: 'Nombre maximum de visites planifiées atteint.' });
      const pid = String(body.planningId || '');
      if (!/^rec[A-Za-z0-9]{10,}$/.test(pid)) return res.status(400).json({ error: 'Créneau invalide.' });
      const rp = await airtable(baseId, headers, 'Planning/' + pid);
      if (!rp.ok) return res.status(404).json({ error: 'Créneau introuvable.' });
      const fp = (await rp.json()).fields || {};
      const date = String(fp.Date || '').slice(0, 10);
      // Le créneau doit être libre, de la bonne agence, et réellement proposé à ce client (même règle que le SAV : délai minimum, client, fermetures).
      const ident = await identDepuisClientId(ctx, clientId);
      const offre = ident && !ident.bloque ? await creneauxLibres(ctx, ident, { agence, date, admin: acces.auteur === 'agence' }) : { creneaux: [] };
      if (fp.Statut !== 'Libre' || fp.Agence !== agence || !(offre.creneaux || []).some((c) => c.id === pid)) return res.status(409).json({ error: 'Ce créneau n\'est plus disponible, choisissez-en un autre.' });
      const limite = new Date(); limite.setMonth(limite.getMonth() + HORIZON_MOIS);
      if (date > iso(limite)) return res.status(400).json({ error: 'Date trop éloignée.' });
      if (visites.some((v) => v.statut !== 'Annulée' && v.date === date)) return res.status(409).json({ error: 'Une visite est déjà prévue ce jour-là.' });
      const prise = await airtable(baseId, headers, 'Planning/' + pid, { method: 'PATCH', body: JSON.stringify({ fields: { Statut: 'Pris' } }) });
      if (!prise.ok) return res.status(409).json({ error: 'Ce créneau n\'est plus disponible, choisissez-en un autre.' });
      const visite = { id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), date, creneau: fp['Créneau'] || '', planningId: pid, statut: 'Planifiée', par: acces.auteur };
      const nouvelles = visites.concat([visite]).sort((a, b) => a.date.localeCompare(b.date));
      const maj = await airtable(baseId, headers, TABLE + '/' + contrat.id, { method: 'PATCH', body: JSON.stringify({ fields: { 'Visites (JSON)': JSON.stringify(nouvelles), 'Prochaine visite': prochaine(nouvelles) || undefined } }) });
      if (!maj.ok) { await airtable(baseId, headers, 'Planning/' + pid, { method: 'PATCH', body: JSON.stringify({ fields: { Statut: 'Libre' } }) }); return res.status(502).json({ error: 'Enregistrement impossible, réessayez.' }); }
      const lisible = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      await pousserAgence({ agence, titre: 'Visite d\'entretien planifiée', message: (f.Client || 'Client') + ' — ' + lisible + ' (' + visite.creneau + ')' });
      await notifierMake({ marque: 'iko', action: 'entretien_visite', marqueur_entretien_visite: '1', ticket: f['Référence'] || '', nom: f.Client, 'e-mail': f.Email || '', tel: f['Téléphone'] || '', agence, adresse: f.Adresse || '',
        date_visite: lisible, creneau: visite.creneau, equipements: f['Équipements'] || '', lien_suivi: f.Email ? lienSuivi(null, { email: f.Email, tel: f['Téléphone'], ticket: f['Référence'] || '' }) : '', email_agence: '' }, clientId);
      return res.status(200).json({ ok: true, visites: nouvelles, visite });
    }

    if (action === 'annuler_visite') {
      const v = visites.find((x) => x.id === String(body.visiteId || ''));
      if (!v || v.statut === 'Annulée') return res.status(404).json({ error: 'Visite introuvable.' });
      const limite = new Date(); limite.setDate(limite.getDate() + DELAI_ANNULATION_JOURS);
      if (v.date < iso(limite) && acces.auteur !== 'agence') return res.status(409).json({ error: 'Trop tard pour annuler en ligne (moins de ' + DELAI_ANNULATION_JOURS + ' jours) : contactez votre agence.' });
      if (v.planningId) await airtable(baseId, headers, 'Planning/' + v.planningId, { method: 'PATCH', body: JSON.stringify({ fields: { Statut: 'Libre' } }) });
      const nouvelles = visites.filter((x) => x.id !== v.id);
      await airtable(baseId, headers, TABLE + '/' + contrat.id, { method: 'PATCH', body: JSON.stringify({ fields: { 'Visites (JSON)': JSON.stringify(nouvelles), 'Prochaine visite': prochaine(nouvelles) || undefined } }) });
      await pousserAgence({ agence, titre: 'Visite d\'entretien annulée', message: (f.Client || 'Client') + ' — ' + v.date });
      return res.status(200).json({ ok: true, visites: nouvelles });
    }

    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) {
    console.error('Erreur entretien:', e && e.message);
    return res.status(502).json({ error: 'Une erreur est survenue. Réessayez dans un instant.' });
  }
}
