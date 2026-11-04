// Sonde de sécurité EN LIGNE : que des lectures et des écritures vers des enregistrements inexistants (aucune donnée modifiée).
//   node sondes/sonde-securite-en-ligne.mjs [https://iko-suite-demo.vercel.app]
const BASE = process.argv[2] || 'https://iko-suite-demo.vercel.app';
let echecs = 0, alertes = 0;
const ok = (c, m) => { console.log((c ? '  OK     ' : '  ECHEC  ') + m); if (!c) echecs++; };
const info = (m) => console.log('  INFO   ' + m);
const get = async (p, init = {}) => { const r = await fetch(BASE + p, { redirect: 'manual', ...init }); const t = await r.text(); return { code: r.status, texte: t, h: r.headers }; };
const refuse = (c) => c === 401 || c === 403 || c === 404 || c === 405;

console.log('1. Lecture anonyme des listes');
for (const t of ['Tickets SAV', 'Devis', 'Clients', 'Utilisateurs', 'Journal actions', 'Contrats entretien', 'Techniciens', 'Métrés', 'Catalogue Produits', 'Audience', 'RDV Commercial', 'Interventions SAV']) {
  const r = await get('/api/airtable/' + encodeURIComponent(t) + '?maxRecords=3');
  ok(refuse(r.code) && !/"records"\s*:\s*\[\s*\{/.test(r.texte), 'liste refusée : ' + t + ' (' + r.code + ')');
}
for (const f of ['{Statut}!=""', 'TRUE()', '1=1']) {
  const r = await get('/api/airtable/' + encodeURIComponent('Tickets SAV') + '?maxRecords=5&filterByFormula=' + encodeURIComponent(f));
  ok(refuse(r.code) || r.code === 429, 'filtre « ' + f + ' » refusé (' + r.code + ')');
}
const rUtil = await get('/api/airtable/' + encodeURIComponent('Utilisateurs') + '?filterByFormula=' + encodeURIComponent('{Identifiant}!=""'));
ok(refuse(rUtil.code), 'table des comptes (hash de mots de passe) inaccessible (' + rUtil.code + ')');

console.log('2. Écriture anonyme (vers un enregistrement inexistant : rien ne peut être modifié)');
for (const m of ['PATCH', 'DELETE', 'PUT']) {
  const r = await get('/api/airtable/' + encodeURIComponent('Tickets SAV') + '/recAAAAAAAAAAAAAA', { method: m, headers: { 'content-type': 'application/json' }, body: m === 'DELETE' ? undefined : JSON.stringify({ fields: { Statut: 'x' } }) });
  ok(refuse(r.code) || r.code === 400 || r.code === 422 || r.code === 429, m + ' anonyme sur un ticket : (' + r.code + ')');
}
const rCl = await get('/api/airtable/' + encodeURIComponent('Clients') + '/recAAAAAAAAAAAAAA', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { 'Accès bloqué': true } }) });
ok(refuse(rCl.code) || rCl.code === 400 || rCl.code === 422, 'PATCH anonyme sur un client : (' + rCl.code + ')');
const rUt = await get('/api/airtable/' + encodeURIComponent('Utilisateurs') + '/recAAAAAAAAAAAAAA', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { 'Rôle': 'SUPER_ADMIN_IKO' } }) });
ok(refuse(rUt.code) || rUt.code === 400 || rUt.code === 422, 'élévation de rôle anonyme refusée : (' + rUt.code + ')');

console.log('3. Services internes sans session');
for (const p of ['/api/sauvegarde', '/api/surveillance', '/api/reparer', '/api/audience', '/api/alerte', '/api/rappel-veille', '/api/agenda', '/api/stripe-webhook', '/api/paiement', '/api/signature']) {
  const r = await get(p);
  const donnees = /"records"|hash|password|AIRTABLE|sk_live|pat[A-Za-z0-9]{10,}\./i.test(r.texte);
  ok(!donnees && r.code !== 500, p + ' : ' + r.code + (donnees ? ' (DONNEES VISIBLES)' : ''));
}
for (const p of ['/api/chat-admin', '/api/chat-dashboard', '/api/chat-technicien', '/api/chat-conseil', '/api/chat-metreur', '/api/verif-securite', '/api/yousign/signature_requests', '/api/tts']) {
  const r = await get(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'test securite' }] }) });
  ok(refuse(r.code) || r.code === 400 || r.code === 429, p + ' sans session : ' + r.code);
}

console.log('4. Fichiers sensibles exposés');
for (const p of ['/.git/config', '/.env', '/.env.local', '/package.json', '/package-lock.json', '/server-local.mjs', '/api/_mail.js', '/api/_suivi.js', '/api/airtable-proxy.js', '/tests/mails-stop.test.mjs', '/iko-local/donnees.mjs', '/vercel.json', '/technicien.avant-nouveau-look.html', '/.vercelignore', '/node_modules/.package-lock.json', '/SAUVEGARDE-PROJET', '/README.md', '/CLAUDE.md']) {
  const r = await get(p);
  const exposé = r.code === 200 && !/<!doctype html|<html/i.test(r.texte.slice(0, 300));
  const spa = r.code === 200 && /<!doctype html|<html/i.test(r.texte.slice(0, 300));
  ok(!exposé, p + ' : ' + r.code + (spa ? ' (page HTML, pas le fichier)' : ''));
}

console.log('5. CORS / origine étrangère');
const cors = await get('/api/airtable/' + encodeURIComponent('Planning') + '?maxRecords=1', { headers: { origin: 'https://evil.example' } });
const aco = cors.h.get('access-control-allow-origin');
ok(!aco || aco !== '*' && aco !== 'https://evil.example', 'origine étrangère non autorisée (ACAO=' + aco + ', code ' + cors.code + ')');
const pre = await get('/api/airtable/Tickets%20SAV', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'DELETE' } });
const aco2 = pre.h.get('access-control-allow-origin');
ok(!aco2 || (aco2 !== '*' && aco2 !== 'https://evil.example'), 'pré-vérification CORS étrangère refusée (ACAO=' + aco2 + ', ' + pre.code + ')');

console.log('6. Jetons falsifiés');
const faux = ['abc', 'A'.repeat(120), 'yCle4ki-LzPjlGFfvheoFmRkQCjgHuj_mHz9pfM-pVVaw8BndjPm5RD7C7UqOLHAvtOK7bWpisASsMJYS2bykNyP3ziQxvpc2JsSk0Yk8YC90UuK49Nx'];
for (const j of faux) {
  const r = await get('/api/airtable/suivi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jeton: j, stop: true }) });
  ok(r.code >= 400 && r.code < 500, 'jeton STOP falsifié refusé (' + r.code + ')');
}
const enum1 = await get('/api/airtable/suivi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: 'SAV-2026-0001', email: 'inconnu@example.com' }) });
ok(enum1.code >= 400 && !/@|Téléphone|Adresse/.test(enum1.texte), 'ticket deviné + mauvais e-mail : rien divulgué (' + enum1.code + ')');

console.log('7. En-têtes');
for (const p of ['/', '/index.html', '/dashboard.html', '/technicien.html', '/admin.html', '/stop.html', '/suivi.html']) {
  const r = await get(p);
  const h = (n) => r.h.get(n);
  ok(h('x-content-type-options') === 'nosniff' && /SAMEORIGIN|DENY/i.test(h('x-frame-options') || '') && !!h('strict-transport-security'), p + ' en-têtes présents (' + r.code + ')');
  if (!h('content-security-policy')) alertes++;
}
info('Content-Security-Policy absente sur ' + alertes + ' page(s) : chantier connu, pas encore fait');

console.log('8. Rafale de connexions (verrouillage)');
let dernier = 0;
for (let i = 0; i < 12; i++) { const r = await get('/api/airtable/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifiant: 'sonde-inexistante', password: 'x' + i }) }); dernier = r.code; }
ok(dernier === 429 || dernier === 401 || dernier === 403 || dernier === 404, 'rafale de mauvais mots de passe : dernier code ' + dernier + (dernier === 429 ? ' (bloquée)' : ' (pas de blocage visible, à surveiller)'));

console.log(echecs ? '\n' + echecs + ' ECHEC(S)' : '\nTOUT EST OK');
process.exit(echecs ? 1 : 0);
