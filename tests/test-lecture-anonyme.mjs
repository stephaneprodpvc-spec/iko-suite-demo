// Test : un visiteur NON connecté ne peut plus lire les listes de données (tickets, devis, clients, tables internes),
// mais les pages publiques (suivi, devis, avis, Amandine) gardent les accès dont elles ont besoin.
//   node tests/test-lecture-anonyme.mjs      (base Airtable factice en mémoire, aucun appel réseau)
process.env.AIRTABLE_TOKEN = 'faux';
process.env.AIRTABLE_BASE_ID = 'appLOCALFICTIF000';
process.env.IKO_DEMO_OUVERT = '0';          // comme en production : pas de session = pas de droits
process.env.JWT_ACCESS_SECRET = 'secret-de-test';
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;

import jwt from 'jsonwebtoken';
import { creerDonnees } from '../iko-local/donnees.mjs';
import { creerFaux } from '../iko-local/airtable-faux.mjs';

const db = creerDonnees();
const faux = creerFaux(db);
globalThis.fetch = async (url, init) => {
  const u = new URL(typeof url === 'string' ? url : url.url);
  if (u.hostname === 'api.airtable.com') return faux(u.href, init || {});
  throw new Error('appel réseau bloqué : ' + u.hostname);
};
const { default: handler } = await import('../api/airtable-proxy.js');

let echecs = 0;
const ok = (c, m) => { console.log((c ? '  OK    ' : '  ÉCHEC ') + m); if (!c) echecs++; };

let compteurIp = 0;
async function appeler(chemin, query = {}, { connecte = false, ip } = {}) {
  const req = {
    method: 'GET', query: { path: chemin, ...query },
    headers: { origin: 'http://localhost:3000', 'x-forwarded-for': ip || ('10.0.0.' + (++compteurIp)), ...(connecte ? { cookie: 'iko_access=' + encodeURIComponent(jwt.sign({ userId: 'u1', role: 'SUPER_ADMIN_IKO' }, 'secret-de-test', { expiresIn: '5m' })) } : {}) },
    socket: { remoteAddress: '10.0.0.1' }, body: undefined,
  };
  let code = 200, corps = null;
  const res = { status(c) { code = c; return res; }, json(o) { corps = o; return res; }, setHeader() {}, end() { return res; }, send(o) { corps = o; return res; } };
  await handler(req, res);
  return { code, corps };
}

console.log('Sans connexion (visiteur anonyme) :');
let r;
r = await appeler('Tickets SAV'); ok(r.code === 401, 'liste des tickets refusée (' + r.code + ')');
r = await appeler('Tickets SAV', { filterByFormula: '{Statut}!=""', maxRecords: '100' }); ok(r.code === 401, 'liste filtrée des tickets refusée (' + r.code + ')');
r = await appeler('Tickets SAV', { filterByFormula: '{Devis Token}!=""' }); ok(r.code === 401, 'astuce « jeton non vide » refusée (' + r.code + ')');
r = await appeler('Tickets SAV', { filterByFormula: '{Devis Token}=""' }); ok(r.code === 401, 'astuce « jeton vide » refusée (' + r.code + ')');
r = await appeler('Tickets SAV', { filterByFormula: '{Devis Token}="abcdefghijklmnop"', maxRecords: '1' }); ok(r.code === 200, 'recherche par jeton de devis autorisée (' + r.code + ')');
r = await appeler('Tickets SAV', { filterByFormula: '{Note Token}="abcdefghijklmnop"', maxRecords: '1' }); ok(r.code === 200, 'recherche par jeton d\'avis autorisée (' + r.code + ')');
const idTicket = db['Tickets SAV'][0].id;
r = await appeler('Tickets SAV/' + idTicket); ok(r.code === 200 && r.corps && r.corps.id === idTicket, 'lecture d\'un ticket par son identifiant autorisée (suivi)');
r = await appeler('Devis'); ok(r.code === 401, 'liste des devis refusée (' + r.code + ')');
r = await appeler('Devis', { filterByFormula: '{Statut}!=""' }); ok(r.code === 401, 'liste filtrée des devis refusée (' + r.code + ')');
const memeIp = '10.9.9.9';
r = await appeler('Devis', { filterByFormula: 'FIND("SAV-2026-1002",ARRAYJOIN({Ticket lié}))', maxRecords: '10' }, { ip: memeIp }); ok(r.code === 200, 'devis d\'un ticket précis autorisé (suivi) (' + r.code + ')');
let dernier = 200; for (let i = 0; i < 9; i++) dernier = (await appeler('Devis', { filterByFormula: 'FIND("SAV-2026-100' + (i % 10) + '",ARRAYJOIN({Ticket lié}))' }, { ip: memeIp })).code;
ok(dernier === 429, 'essais en rafale sur les devis bloqués (' + dernier + ')');
r = await appeler('Clients'); ok(r.code === 401, 'liste des clients refusée (' + r.code + ')');
r = await appeler('Clients', { filterByFormula: '{Statut client}!=""' }); ok(r.code === 401, 'liste filtrée des clients refusée (' + r.code + ')');
r = await appeler('Clients', { filterByFormula: '{Slug}="demo-local"', maxRecords: '1' }); ok(r.code === 200 && r.corps.records.length === 1, 'recherche d\'un client par son identifiant public autorisée (Amandine)');
for (const t of ['Contrats entretien', 'Techniciens', 'Métrés', 'Catalogue Produits', "Grille Main d'œuvre", 'Mise en page Devis']) { r = await appeler(t); ok(r.code === 401, 'table interne refusée : ' + t + ' (' + r.code + ')'); }
r = await appeler('Planning', { maxRecords: '3' }); ok(r.code === 200, 'planning public toujours lisible (créneaux de rendez-vous) (' + r.code + ')');
r = await appeler('Agences', { filterByFormula: 'FIND("recLOCALCLIENT0001",ARRAYJOIN({Client}))', maxRecords: '50' }); ok(r.code === 200, 'agences d\'un client toujours lisibles (formulaire de demande) (' + r.code + ')');

console.log('Connecté (session valide) :');
r = await appeler('Tickets SAV', { maxRecords: '100' }, { connecte: true }); ok(r.code === 200 && r.corps.records.length > 1, 'liste des tickets lisible (' + (r.corps && r.corps.records ? r.corps.records.length : r.code) + ' tickets)');
r = await appeler('Devis', {}, { connecte: true }); ok(r.code === 200, 'liste des devis lisible (' + r.code + ')');
r = await appeler('Clients', {}, { connecte: true }); ok(r.code === 200, 'liste des clients lisible (' + r.code + ')');
r = await appeler('Contrats entretien', {}, { connecte: true }); ok(r.code === 200, 'contrats d\'entretien lisibles (' + r.code + ')');
r = await appeler('Techniciens', {}, { connecte: true }); ok(r.code === 200, 'techniciens lisibles (' + r.code + ')');

console.log(echecs ? '\n' + echecs + ' ÉCHEC(S)' : '\nTOUT EST OK');
process.exit(echecs ? 1 : 0);
