// api/_alertes.js — Alertes d'exploitation vers le responsable (téléphone / mail / SMS) + journal « Alertes clients » du Poste de pilotage.
// Appelé via api/yousign-webhook.js (?service=alerte | surveillance) : Vercel Hobby plafonne à 12 fonctions.
//
// Canaux d'envoi, tous optionnels :
//  1. Notification sur le téléphone (Web Push, appareil enregistré avec l'agence « alertes »). Marche sans Make.
//  2. Mail + SMS : action « alerte_incident » envoyée au scénario Make. Elle ne part vraiment que si une route
//     « alerte_incident » existe dans Make (champs : titre, message, email, tel, quand).
// Le journal (config.alertes.journal, 100 entrées max) est lu par le Poste de pilotage (admin.html) : chaque incident
// y est rattaché au client concerné quand il est connu. Une alerte identique n'est renvoyée qu'après DELAI_ANTI_REPETITION_H heures.
// Aucune donnée personnelle de client dans les alertes : numéros de ticket, agences, comptes uniquement.
import webpush from 'web-push';
import { verifierOrigine, verifierSession, reponseBloquee } from './_securite.js';
import { enteteMake } from './_make.js';
import { ajouterMailsAuCorps } from './_mail.js';
import { reparer } from './_reparation.js';

const MAKE_WEBHOOK = 'https://hook.eu1.make.com/n3lwi92wldkf22jcemmjfem334p4mv6a'; // même scénario que le proxy
const CONFIG_RECORD_ID = 'rec45X231n9dXnyaU';
const DELAI_ANTI_REPETITION_H = 6;
const AGENCE_PUSH = 'alertes';
const MAX_JOURNAL = 100;
const SEUILS = { urgentSansTechnicienH: 2, messageNonLuH: 24, rdvModifieNonVuH: 48 };

const baseId = () => process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
const entetesAirtable = () => ({ Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' });

export async function lireConfig() {
  const r = await fetch('https://api.airtable.com/v0/' + baseId() + '/Planning/' + CONFIG_RECORD_ID, { headers: entetesAirtable() });
  const j = await r.json();
  let c = {};
  try { c = JSON.parse((j.fields && j.fields['Config JSON']) || '{}'); } catch (e) { c = {}; }
  if (!Array.isArray(c.pushSubscriptions)) c.pushSubscriptions = [];
  if (!c.alertes || typeof c.alertes !== 'object') c.alertes = {};
  if (!Array.isArray(c.alertes.journal)) c.alertes.journal = [];
  return c;
}
export async function ecrireConfig(c) {
  await fetch('https://api.airtable.com/v0/' + baseId() + '/Planning/' + CONFIG_RECORD_ID, {
    method: 'PATCH', headers: entetesAirtable(), body: JSON.stringify({ fields: { 'Config JSON': JSON.stringify(c) } }),
  });
}

// Ajoute (ou incrémente) une ligne du journal. Une même alerte encore « nouvelle » pour le même client n'est pas dupliquée.
function inscrireAuJournal(c, { cle, titre, message, client }) {
  const a = c.alertes;
  const maintenant = new Date().toISOString();
  const existante = a.journal.find((j) => j.cle === cle && (j.client || null) === (client || null) && j.statut === 'nouvelle');
  if (existante) { existante.compteur = (existante.compteur || 1) + 1; existante.derniere = maintenant; existante.message = message; return; }
  a.journal.unshift({ id: 'al-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), quand: maintenant, derniere: maintenant, cle, titre, message, client: client || null, statut: 'nouvelle', compteur: 1 });
  a.journal = a.journal.slice(0, MAX_JOURNAL);
}

async function envoyer(c, { titre, message }) {
  const a = c.alertes;
  const res = { envoye: true, push: 0, make: false, sms: null };
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:stephane.prodpvc@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const cibles = c.pushSubscriptions.filter((s) => s.agence === AGENCE_PUSH);
    const morts = [];
    await Promise.all(cibles.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: titre, body: message, url: '/admin.html' })); res.push++; }
      catch (err) { if (err.statusCode === 404 || err.statusCode === 410) morts.push(s.endpoint); }
    }));
    if (morts.length) c.pushSubscriptions = c.pushSubscriptions.filter((s) => !morts.includes(s.endpoint));
  }
  if (a.email || a.tel) {
    try {
      const w = await fetch(MAKE_WEBHOOK, {
        method: 'POST', headers: enteteMake({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(ajouterMailsAuCorps({ marque: 'iko', action: 'alerte_incident', titre, message, email: a.email || '', tel: a.tel || '', quand: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) }, 'alerte_incident')),
      });
      res.make = w.ok;
    } catch (e) { res.make = false; }
  }
  // SMS GRATUIT via l'option « Notifications par SMS » de Free Mobile : le SMS part vers le numéro du titulaire de la ligne
  // (le patron), jamais vers un autre numéro. Actif seulement si FREE_SMS_USER et FREE_SMS_PASS sont définis dans Vercel.
  if (process.env.FREE_SMS_USER && process.env.FREE_SMS_PASS) {
    try {
      const sms = await fetch('https://smsapi.free-mobile.fr/sendmsg', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: process.env.FREE_SMS_USER, pass: process.env.FREE_SMS_PASS, msg: ('IKO - ' + titre + ' : ' + message).slice(0, 300) }),
      });
      res.sms = sms.ok;
    } catch (e) { res.sms = false; }
  }
  a.dernierEnvoi = { quand: new Date().toISOString(), titre, push: res.push, make: res.make, sms: res.sms };
  return res;
}

// Signale un incident : l'inscrit au journal (toujours, sauf test) puis envoie l'alerte si elle est active et pas déjà envoyée récemment.
// Ne lève jamais d'exception (une alerte ne doit jamais casser le parcours d'un client).
// options : cle, titre, message, client (identifiant du client pro concerné), force (test), sansJournal.
export async function alerter({ cle, titre, message, client = null, force = false, sansJournal = false, journalSeulement = false }) {
  try {
    const c = await lireConfig();
    const a = c.alertes;
    if (!force && !sansJournal) inscrireAuJournal(c, { cle: cle || titre, titre, message, client });
    let resultat;
    if (journalSeulement) resultat = { envoye: false, raison: 'journal seulement' };
    else if (!a.actif && !force) resultat = { envoye: false, raison: 'alertes désactivées' };
    else if (cle && !force && a.derniers && a.derniers[cle] && Date.now() - a.derniers[cle] < DELAI_ANTI_REPETITION_H * 3600 * 1000) resultat = { envoye: false, raison: 'déjà signalé récemment' };
    else {
      resultat = await envoyer(c, { titre, message });
      if (cle) a.derniers = { ...(a.derniers || {}), [cle]: Date.now() };
    }
    await ecrireConfig(c);
    return resultat;
  } catch (e) {
    console.error('alerter() :', e);
    return { envoye: false, raison: 'erreur interne' };
  }
}

async function lireCorpsJson(req) {
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  try { return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}'); } catch (e) { return {}; }
}

// Réglages + test (administrateurs) ; journal « Alertes clients » (super-administrateur IKO uniquement).
export async function handleAlerte(req, res) {
  if (!verifierOrigine(req, { strict: true })) return reponseBloquee(res, 'origine');
  const session = verifierSession(req);
  if (!session || session.mdpAChanger || !['SUPER_ADMIN_IKO', 'TENANT_ADMIN'].includes(session.role)) return res.status(403).json({ error: 'Accès refusé.' });
  if (session.agence && session.role !== 'SUPER_ADMIN_IKO') return res.status(403).json({ error: 'Réservé au responsable de l\'entreprise.' });
  const superAdmin = session.role === 'SUPER_ADMIN_IKO';
  try {
    if (req.method === 'GET') {
      const c = await lireConfig();
      const a = c.alertes;
      if (req.query && req.query.journal !== undefined) {
        if (!superAdmin) return res.status(403).json({ error: 'Réservé au super-administrateur.' });
        return res.status(200).json({ journal: a.journal, nbNouvelles: a.journal.filter((j) => j.statut === 'nouvelle').length });
      }
      return res.status(200).json({
        actif: !!a.actif, email: a.email || '', tel: a.tel || '', dernierEnvoi: a.dernierEnvoi || null,
        appareils: c.pushSubscriptions.filter((s) => s.agence === AGENCE_PUSH).length,
        pushDisponible: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        surveillanceActive: !!process.env.CRON_SECRET,
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
    const corps = await lireCorpsJson(req);
    if (corps.action === 'config') {
      const email = String(corps.email || '').trim().slice(0, 120);
      const tel = String(corps.tel || '').trim().slice(0, 25);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
      if (tel && !/^[+0-9 ().-]{6,25}$/.test(tel)) return res.status(400).json({ error: 'Numéro de téléphone invalide.' });
      const c = await lireConfig();
      c.alertes = { ...c.alertes, actif: corps.actif === true, email, tel };
      await ecrireConfig(c);
      return res.status(200).json({ ok: true });
    }
    if (corps.action === 'test') {
      const c = await lireConfig();
      const r = await envoyer(c, { titre: 'Alerte test IKO', message: 'Ceci est un test : si vous lisez ce message, les alertes IKO fonctionnent.' });
      await ecrireConfig(c);
      return res.status(200).json(r);
    }
    if (corps.action === 'traiter' || corps.action === 'tout_traiter') {
      if (!superAdmin) return res.status(403).json({ error: 'Réservé au super-administrateur.' });
      const c = await lireConfig();
      const maintenant = new Date().toISOString();
      c.alertes.journal.forEach((j) => { if (j.statut === 'nouvelle' && (corps.action === 'tout_traiter' || j.id === corps.id)) { j.statut = 'traitee'; j.traiteeLe = maintenant; } });
      await ecrireConfig(c);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Action inconnue.' });
  } catch (e) {
    return res.status(502).json({ error: 'Erreur du service d\'alerte.' });
  }
}

const NON_CLOS = ['Terminé', 'Annulé', 'Supprimé'];
const heuresDepuis = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000;
function dernierHorodatageMessage(texte) {
  const toutes = [...String(texte || '').matchAll(/\[(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})\]/g)];
  if (!toutes.length) return null;
  const m = toutes[toutes.length - 1];
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).toISOString();
}

// Contrôle déclenché par le cron quotidien (vercel.json) ou par un « pinger » externe : Authorization: Bearer <CRON_SECRET>
// ou ?cle=<CRON_SECRET>. Ne modifie aucun ticket. Les problèmes sont rattachés au client (champ « Compte client » du ticket).
export async function handleSurveillance(req, res) {
  const secret = process.env.CRON_SECRET;
  const fourni = (req.headers.authorization || '').replace(/^Bearer /, '') || (req.query && req.query.cle) || '';
  if (!secret || fourni !== secret) return res.status(401).json({ error: 'Non autorisé.' });
  const problemes = []; // { cle, client, texte }
  // ?h=0 (avec le secret) : seuils ramenés à 0 h pour vérifier la détection sans attendre.
  const seuils = (req.query && req.query.h !== undefined && !isNaN(Number(req.query.h))) ? { urgentSansTechnicienH: Number(req.query.h), messageNonLuH: Number(req.query.h), rdvModifieNonVuH: Number(req.query.h) } : SEUILS;
  try {
    const url = 'https://api.airtable.com/v0/' + baseId() + '/Tickets%20SAV?maxRecords=100&filterByFormula=' +
      encodeURIComponent('AND({Statut}!="Terminé",{Statut}!="Annulé",{Statut}!="Supprimé")');
    const r = await fetch(url, { headers: entetesAirtable() });
    if (!r.ok) problemes.push({ cle: 'base-inaccessible', client: null, texte: 'Base de données inaccessible (HTTP ' + r.status + ')' });
    else {
      const tickets = ((await r.json()).records || []).filter((t) => !NON_CLOS.includes((t.fields || {}).Statut));
      const clientDe = (t) => (Array.isArray(t.fields['Compte client']) && t.fields['Compte client'][0]) || null;
      const nums = (liste) => liste.slice(0, 5).map((t) => t.fields.Name || t.id).join(', ') + (liste.length > 5 ? ' …' : '');
      const regrouper = (liste, cle, libelle) => {
        const parClient = new Map();
        liste.forEach((t) => { const k = clientDe(t); parClient.set(k, [...(parClient.get(k) || []), t]); });
        parClient.forEach((l, k) => problemes.push({ cle, client: k, texte: l.length + ' ' + libelle + ' : ' + nums(l) }));
      };
      regrouper(tickets.filter((t) => t.fields.Qualification === 'Oui' && !t.fields['Technicien assigné'] && heuresDepuis(t.createdTime) > seuils.urgentSansTechnicienH), 'urgents-sans-technicien', 'ticket(s) urgent(s) sans technicien depuis plus de ' + seuils.urgentSansTechnicienH + ' h');
      regrouper(tickets.filter((t) => t.fields['Message client non lu'] === true && (() => { const h = dernierHorodatageMessage(t.fields['Message client']); return h && heuresDepuis(h) > seuils.messageNonLuH; })()), 'messages-sans-reponse', 'message(s) client sans réponse depuis plus de ' + seuils.messageNonLuH + ' h');
      regrouper(tickets.filter((t) => t.fields['RDV modifié - notif technicien'] === true && heuresDepuis(t.createdTime) > seuils.rdvModifieNonVuH), 'rdv-modifie-non-vu', 'rendez-vous modifié(s) pas vu(s) par le technicien');
    }
  } catch (e) { problemes.push({ cle: 'base-erreur', client: null, texte: 'Contrôle impossible : erreur de lecture de la base' }); }
  // Réparation automatique (créneaux bloqués à tort, créneaux non réservés) : faite chaque jour avec le contrôle.
  let reparation = null;
  try {
    reparation = await reparer({ appliquer: true, lireConfig, ecrireConfig });
    (reparation.corriges || []).forEach((c) => problemes.push({ cle: 'reparation-' + c.type, client: null, texte: 'Réparé automatiquement : ' + c.detail }));
    (reparation.signales || []).filter((s) => s.type === 'doublon').forEach((s) => problemes.push({ cle: 'reparation-doublon', client: null, texte: 'À vérifier : ' + s.detail }));
  } catch (e) { reparation = { erreur: 'Réparation impossible' }; }
  let alerte = null;
  if (problemes.length) {
    // Journal : une ligne par client concerné ; envoi : un seul message récapitulatif (pas de rafale de notifications).
    for (const p of problemes) await alerter({ cle: p.cle, titre: 'IKO : ' + p.texte.split(' : ')[0].replace(/^\d+ /, ''), message: p.texte, client: p.client, journalSeulement: true });
    alerte = await alerter({ cle: 'surveillance:' + [...new Set(problemes.map((p) => p.cle))].sort().join('+'), titre: 'IKO : ' + problemes.length + ' point(s) à traiter', message: problemes.map((p) => p.texte).join(' — '), sansJournal: true });
  }
  return res.status(200).json({ controle: new Date().toISOString(), problemes, alerte, reparation });
}

// Notification en direct (téléphone) aux techniciens d'une agence : appareils enregistrés avec cette agence (ou « global »).
// Ne lève jamais d'exception. Retourne le nombre d'appareils prévenus.
export async function pousserAgence({ agence, titre, message, url = '/technicien.html' }) {
  try {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return 0;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:stephane.prodpvc@gmail.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const c = await lireConfig();
    const ag = String(agence || '');
    const cibles = c.pushSubscriptions.filter((s) => s.agence !== AGENCE_PUSH && (s.agence === 'global' || (ag && (String(s.agence).startsWith(ag) || ag.startsWith(String(s.agence))))));
    let envoyes = 0; const morts = [];
    await Promise.all(cibles.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: titre, body: message, url })); envoyes++; }
      catch (err) { if (err.statusCode === 404 || err.statusCode === 410) morts.push(s.endpoint); }
    }));
    if (morts.length) { c.pushSubscriptions = c.pushSubscriptions.filter((s) => !morts.includes(s.endpoint)); await ecrireConfig(c); }
    return envoyes;
  } catch (e) { return 0; }
}
