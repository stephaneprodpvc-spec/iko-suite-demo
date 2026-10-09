// Agenda du technicien en abonnement (format iCalendar) : Google Agenda, Apple Calendrier et Outlook savent
// s'abonner à une URL .ics. Fichier utilitaire appelé via api/yousign-webhook.js (limite de 12 fonctions).
//  - GET /api/agenda?lien=1&agence=…   (session requise)  → { url } à coller dans l'agenda
//  - GET /api/agenda?t=…&a=…&k=…       (jeton signé)       → flux .ics des interventions ouvertes de l'agence
// Le jeton « k » est une signature HMAC du couple (client, agence) : impossible à deviner, pas de mot de passe exposé.
import crypto from 'crypto';
import { verifierSession, verifierOrigine, reponseBloquee } from './_securite.js';

function jeton(tenantId, agence) {
  const secret = process.env.JWT_ACCESS_SECRET || '';
  return crypto.createHmac('sha256', secret).update('agenda|' + tenantId + '|' + agence).digest('hex').slice(0, 32);
}
const ics = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const pad = (n) => String(n).padStart(2, '0');

// « 8h30 — 9h30 », « Matin (8h30 — 12h00) », « Après-midi (13h00 — 17h00) » → [début, fin] en minutes
function plage(creneau) {
  const h = String(creneau || '').match(/(\d{1,2})h(\d{2})/g) || [];
  const m = (x) => { const r = x.match(/(\d{1,2})h(\d{2})/); return parseInt(r[1], 10) * 60 + parseInt(r[2], 10); };
  if (h.length >= 2) return [m(h[0]), m(h[1])];
  if (h.length === 1) return [m(h[0]), m(h[0]) + 60];
  return /après|apres/i.test(creneau || '') ? [13 * 60, 17 * 60] : [8 * 60 + 30, 12 * 60];
}

export async function handleAgenda(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
  const headers = { Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN };

  if (req.query.lien !== undefined) {
    if (!verifierOrigine(req, { strict: true })) return reponseBloquee(res, 'origine');
    const session = verifierSession(req);
    const agence = typeof req.query.agence === 'string' ? req.query.agence : '';
    if (!session || !session.tenantId || !agence) return res.status(403).json({ error: 'Session requise.' });
    const hote = req.headers['x-forwarded-host'] || req.headers.host;
    const url = 'https://' + hote + '/api/agenda.ics?t=' + encodeURIComponent(session.tenantId) + '&a=' + encodeURIComponent(agence) + '&k=' + jeton(session.tenantId, agence);
    return res.status(200).json({ url });
  }

  const t = String(req.query.t || ''), a = String(req.query.a || ''), k = String(req.query.k || '');
  const attendu = jeton(t, a);
  if (!t || !a || k.length !== attendu.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(attendu))) return res.status(403).send('Lien invalide.');

  let tickets = [];
  try {
    const f = 'AND({Agence}="' + a.replace(/"/g, '') + '", OR({Statut}="Nouveau",{Statut}="En cours"))';
    const r = await fetch('https://api.airtable.com/v0/' + baseId + '/Tickets%20SAV?filterByFormula=' + encodeURIComponent(f) + '&maxRecords=200', { headers });
    if (!r.ok) return res.status(502).send('Lecture impossible.');
    tickets = ((await r.json()).records || []).filter(x => Array.isArray(x.fields['Compte client']) ? x.fields['Compte client'].includes(t) : false);
  } catch (e) { return res.status(502).send('Erreur.'); }

  // Dates réelles : table Planning (Date + Créneau), lue par lots
  const ids = tickets.map(x => x.fields.PlanningID).filter(Boolean);
  const planning = {};
  for (let i = 0; i < ids.length; i += 40) {
    const lot = ids.slice(i, i + 40);
    try {
      const f = 'OR(' + lot.map(id => 'RECORD_ID()="' + id + '"').join(',') + ')';
      const r = await fetch('https://api.airtable.com/v0/' + baseId + '/Planning?filterByFormula=' + encodeURIComponent(f) + '&maxRecords=100', { headers });
      if (r.ok) ((await r.json()).records || []).forEach(p => { planning[p.id] = p.fields; });
    } catch (e) { /* ticket ignoré si son créneau est introuvable */ }
  }

  const lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Iko Suite//Agenda technicien//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Iko — ' + ics(a), 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  tickets.forEach(x => {
    const p = planning[x.fields.PlanningID];
    const date = p && String(p.Date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!date) return;
    const [d0, d1] = plage(p.Créneau || x.fields['Créneau']);
    const jour = date[1] + date[2] + date[3];
    const hm = (min) => pad(Math.floor(min / 60)) + pad(min % 60) + '00';
    lignes.push('BEGIN:VEVENT', 'UID:' + x.id + '@iko-suite', 'DTSTAMP:' + stamp,
      'DTSTART;TZID=Europe/Paris:' + jour + 'T' + hm(d0), 'DTEND;TZID=Europe/Paris:' + jour + 'T' + hm(d1),
      'SUMMARY:' + ics('SAV ' + (x.fields.Name || '') + ' — ' + (x.fields.Client || '') + (x.fields.Qualification === 'Oui' ? ' (URGENT)' : '')),
      'LOCATION:' + ics(x.fields.Adresse || ''),
      'DESCRIPTION:' + ics([x.fields.Produit, x.fields['Problème'], x.fields['Téléphone'] ? 'Tél. ' + x.fields['Téléphone'] : ''].filter(Boolean).join(' — ')),
      'END:VEVENT');
  });
  lignes.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=600');
  return res.status(200).send(lignes.join('\r\n'));
}
