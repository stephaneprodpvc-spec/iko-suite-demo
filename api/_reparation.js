// api/_reparation.js
// Contrôle et réparation AUTOMATIQUES de la base : IKO corrige seul ce qui peut l'être sans risque et signale le reste.
// Corrigé seul : créneau resté « Pris » sans ticket (après 2 h d'observation, pour ne jamais libérer un créneau en cours de réservation),
//                ticket actif dont le créneau est marqué « Libre » (risque de double réservation).
// Signalé seulement : numéros de ticket en double (jamais supprimés automatiquement).
// Aucune suppression, aucun changement de statut de ticket.

import { verifierSession } from './_securite.js';

const baseId = () => process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
const entetes = () => ({ Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' });
const DELAI_ORPHELIN_MS = 2 * 3600 * 1000;
const FERMES = ['Annulé', 'Supprimé'];

async function toutLire(table, formule) {
  let offset = ''; const out = [];
  for (let page = 0; page < 6; page++) {
    const url = 'https://api.airtable.com/v0/' + baseId() + '/' + encodeURIComponent(table) + '?pageSize=100' + (formule ? '&filterByFormula=' + encodeURIComponent(formule) : '') + (offset ? '&offset=' + offset : '');
    const r = await fetch(url, { headers: entetes() });
    if (!r.ok) throw new Error(table + ' : HTTP ' + r.status);
    const j = await r.json();
    out.push(...(j.records || []));
    offset = j.offset || '';
    if (!offset) break;
  }
  return out;
}

async function majCreneau(id, statut) {
  const r = await fetch('https://api.airtable.com/v0/' + baseId() + '/Planning/' + encodeURIComponent(id), { method: 'PATCH', headers: entetes(), body: JSON.stringify({ fields: { Statut: statut } }) });
  return r.ok;
}

// options : { appliquer: bool, lireConfig, ecrireConfig } — lireConfig/ecrireConfig servent à mémoriser depuis quand un créneau orphelin est observé.
export async function reparer({ appliquer = true, lireConfig, ecrireConfig } = {}) {
  const rapport = { controle: new Date().toISOString(), verifie: { creneaux: 0, tickets: 0 }, corriges: [], signales: [], erreur: null };
  try {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const [pris, tickets] = await Promise.all([toutLire('Planning', '{Statut}="Pris"'), toutLire('Tickets SAV', '')]);
    let contrats = []; try { contrats = await toutLire('Contrats entretien', ''); } catch (e) { contrats = []; }
    const creneauxLibres = [];
    rapport.verifie.creneaux = pris.length; rapport.verifie.tickets = tickets.length;

    // 1. Doublons de numéro de ticket (signalés, jamais supprimés)
    const parNom = new Map();
    tickets.forEach((t) => { const n = (t.fields || {}).Name; if (n) parNom.set(n, [...(parNom.get(n) || []), t]); });
    parNom.forEach((l, n) => { if (l.length > 1) rapport.signales.push({ type: 'doublon', detail: 'Le ticket ' + n + ' existe ' + l.length + ' fois : à vérifier et supprimer à la main.' }); });

    // 2. Créneaux « Pris » que plus aucun ticket n'utilise
    const utilises = new Set(tickets.filter((t) => !FERMES.includes((t.fields || {}).Statut)).map((t) => (t.fields || {}).PlanningID).filter(Boolean));
    // Créneaux réservés par les visites d'entretien (contrats) : à ne jamais libérer.
    contrats.forEach((c) => { try { JSON.parse((c.fields || {})['Visites (JSON)'] || '[]').forEach((v) => { if (v && v.planningId && v.statut !== 'Annulée') utilises.add(v.planningId); }); } catch (e) { /* visites illisibles : ignorées */ } });
    const orphelins = pris.filter((p) => !utilises.has(p.id) && String((p.fields || {}).Date || '').slice(0, 10) >= aujourdhui && (p.fields || {}).Date !== 'CONFIG-PLANNING');
    let cfg = null;
    if (lireConfig) { try { cfg = await lireConfig(); } catch (e) { cfg = null; } }
    const memo = (cfg && cfg.reparation && cfg.reparation.orphelins) || {};
    const nouvelleMemo = {};
    for (const p of orphelins) {
      const vu = memo[p.id];
      if (!vu) { nouvelleMemo[p.id] = Date.now(); rapport.signales.push({ type: 'creneau-a-surveiller', detail: 'Créneau du ' + String(p.fields.Date).slice(0, 10) + ' (' + (p.fields['Créneau'] || '') + ') réservé sans ticket : recontrôlé dans 2 h.' }); continue; }
      if (Date.now() - vu >= DELAI_ORPHELIN_MS) {
        if (appliquer && await majCreneau(p.id, 'Libre')) rapport.corriges.push({ type: 'creneau-libere', detail: 'Créneau du ' + String(p.fields.Date).slice(0, 10) + ' (' + (p.fields['Créneau'] || '') + ') réservé sans ticket : remis à disposition.' });
        else if (!appliquer) rapport.signales.push({ type: 'creneau-orphelin', detail: 'Créneau du ' + String(p.fields.Date).slice(0, 10) + ' réservé sans ticket depuis plus de 2 h : sera libéré.' });
      } else nouvelleMemo[p.id] = vu;
    }
    if (appliquer && cfg && ecrireConfig) { cfg.reparation = Object.assign({}, cfg.reparation, { orphelins: nouvelleMemo, dernierControle: rapport.controle }); try { await ecrireConfig(cfg); } catch (e) { /* mémoire non critique */ } }

    // 3. Tickets actifs dont le créneau est marqué « Libre » : on le remet à « Pris » (évite une double réservation)
    const idsPris = new Set(pris.map((p) => p.id));
    const actifs = tickets.filter((t) => !FERMES.includes((t.fields || {}).Statut) && (t.fields || {}).Statut !== 'Terminé' && (t.fields || {}).PlanningID);
    for (const t of actifs) {
      const pid = t.fields.PlanningID;
      if (idsPris.has(pid)) continue;
      const r = await fetch('https://api.airtable.com/v0/' + baseId() + '/Planning/' + encodeURIComponent(pid), { headers: entetes() });
      if (!r.ok) continue;
      const fp = (await r.json()).fields || {};
      if (fp.Statut === 'Libre' && String(fp.Date || '').slice(0, 10) >= aujourdhui) {
        if (appliquer && await majCreneau(pid, 'Pris')) rapport.corriges.push({ type: 'creneau-reserve', detail: 'Le créneau du ticket ' + (t.fields.Name || '') + ' était affiché libre : il est de nouveau réservé.' });
        else if (!appliquer) rapport.signales.push({ type: 'creneau-libre', detail: 'Le créneau du ticket ' + (t.fields.Name || '') + ' est affiché libre : sera réservé.' });
      }
    }
    void creneauxLibres;
  } catch (e) {
    rapport.erreur = 'Contrôle impossible : ' + (e && e.message ? e.message : 'erreur');
  }
  return rapport;
}

// Appel depuis le tableau de bord (session agence obligatoire). GET = simulation, POST = contrôle + réparation.
export async function handleReparation(req, res, outils) {
  const session = verifierSession(req);
  if (!session) return res.status(401).json({ error: 'Session requise.' });
  const rapport = await reparer({ appliquer: req.method === 'POST', ...(outils || {}) });
  return res.status(200).json(rapport);
}
