// Sonde (hors suite de tests) : que peut ÉCRIRE un visiteur sans connexion ? (base factice, aucun appel réseau)
process.env.AIRTABLE_TOKEN = 'faux'; process.env.AIRTABLE_BASE_ID = 'appLOCALFICTIF000'; process.env.IKO_DEMO_OUVERT = '0'; process.env.JWT_ACCESS_SECRET = 'secret-de-test';
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const { creerDonnees } = await import('../iko-local/donnees.mjs'); const { creerFaux } = await import('../iko-local/airtable-faux.mjs');
const db = creerDonnees(); const faux = creerFaux(db);
globalThis.fetch = async (url, init) => { const u = new URL(typeof url === 'string' ? url : url.url); if (u.hostname === 'api.airtable.com') return faux(u.href, init || {}); throw new Error('réseau bloqué ' + u.hostname); };
const { default: handler } = await import('../api/airtable-proxy.js');
let n = 0;
async function appeler(methode, chemin, corps) {
  const req = { method: methode, query: { path: chemin }, headers: { origin: 'http://localhost:3000', 'x-forwarded-for': '10.1.1.' + (++n) }, socket: { remoteAddress: '10.1.1.1' }, body: corps };
  let code = 200, json = null; const res = { status(c) { code = c; return res; }, json(o) { json = o; return res; }, setHeader() {}, end() { return res; }, send(o) { json = o; return res; } };
  await handler(req, res); return { code, json };
}
const t = db['Tickets SAV'][0].id; const p = db.Planning.find(x => x.fields.Statut) || db.Planning[0]; const c = db.Clients[0].id;
const essais = [
  ['PATCH ticket : changer l\'e-mail', 'PATCH', 'Tickets SAV/' + t, { fields: { Email: 'pirate@x.fr' } }],
  ['PATCH ticket : Statut Terminé', 'PATCH', 'Tickets SAV/' + t, { fields: { Statut: 'Terminé' } }],
  ['PATCH ticket : Message client (autorisé ?)', 'PATCH', 'Tickets SAV/' + t, { fields: { 'Message client': 'test' } }],
  ['PATCH ticket : Qui paie', 'PATCH', 'Tickets SAV/' + t, { fields: { 'Qui paie détail': '{}' } }],
  ['DELETE ticket', 'DELETE', 'Tickets SAV/' + t, undefined],
  ['POST ticket (création directe)', 'POST', 'Tickets SAV', { fields: { Name: 'X', Client: 'Y' } }],
  ['PATCH planning : Statut Pris', 'PATCH', 'Planning/' + p.id, { fields: { Statut: 'Pris' } }],
  ['PATCH planning : Statut Bloqué', 'PATCH', 'Planning/' + p.id, { fields: { Statut: 'Bloqué' } }],
  ['PATCH planning : autre champ (Date)', 'PATCH', 'Planning/' + p.id, { fields: { Date: '2030-01-01' } }],
  ['DELETE planning', 'DELETE', 'Planning/' + p.id, undefined],
  ['PATCH client : Emails contact', 'PATCH', 'Clients/' + c, { fields: { 'Emails contact': 'pirate@x.fr' } }],
  ['PATCH client : Accès bloqué', 'PATCH', 'Clients/' + c, { fields: { 'Accès bloqué': true } }],
  ['POST client', 'POST', 'Clients', { fields: { 'Nom client': 'X' } }],
  ['PATCH agence', 'PATCH', 'Agences/' + (db.Agences[0] && db.Agences[0].id), { fields: { 'Email agence': 'pirate@x.fr' } }],
  ['POST devis', 'POST', 'Devis', { fields: { 'N° devis': 'X' } }],
  ['PATCH devis (Statut Validé)', 'PATCH', 'Devis/' + (db.Devis[0] && db.Devis[0].id), { fields: { Statut: 'Validé' } }],
];
for (const [nom, m, ch, corps] of essais) { const r = await appeler(m, ch, corps); console.log((r.code >= 200 && r.code < 300 ? 'ACCEPTÉ ' : 'refusé  ') + String(r.code).padEnd(4) + nom + (r.code >= 400 && r.json && r.json.error ? '  — ' + String(typeof r.json.error === 'string' ? r.json.error : JSON.stringify(r.json.error)).slice(0, 70) : '')); }
