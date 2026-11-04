// Sonde fonctionnelle EN LIGNE (lecture seule) sur le ticket de test TEST-STOP-0411 :
//   node sondes/sonde-fonctionnelle-en-ligne.mjs <jeton-suivi> [url]
const JETON = process.argv[2];
const BASE = process.argv[3] || 'https://iko-suite-demo.vercel.app';
let echecs = 0;
const ok = (c, m) => { console.log((c ? '  OK     ' : '  ECHEC  ') + m); if (!c) echecs++; };
const post = async (p, o) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) }); let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch {} return { code: r.status, j, t }; };
const get = async (p) => { const r = await fetch(BASE + p); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { code: r.status, j, t }; };

console.log('Suivi client');
let r = await post('/api/airtable/suivi', { jeton: JETON });
ok(r.code === 200 && r.j && r.j.tickets && r.j.tickets.length >= 1, 'lien du mail : ' + (r.j && r.j.tickets ? r.j.tickets.length : r.code) + ' demande(s) retrouvée(s)');
r = await post('/api/airtable/suivi', { numero: 'TEST-STOP-0411', contact: 'stephane.prodpvc@gmail.com' });
ok(r.code === 200 && r.j.tickets.length === 1, 'numéro + bon e-mail : exactement 1 ticket');
r = await post('/api/airtable/suivi', { numero: 'TEST-STOP-0411', contact: 'autre@example.com' });
ok(r.code === 404, 'numéro + mauvais e-mail : refusé (' + r.code + ')');
for (const piege of ['x" ,TRUE(), "', '") OR (1=1', "' OR '1'='1", '{Email}!=""']) {
  r = await post('/api/airtable/suivi', { numero: 'TEST-STOP-0411', contact: piege });
  ok(r.code >= 400 && r.code < 500, 'injection dans le contact refusée (' + r.code + ')');
  r = await post('/api/airtable/suivi', { numero: 'TEST-STOP-0411"," ', contact: 'stephane.prodpvc@gmail.com' });
}
r = await post('/api/airtable/suivi', { numero: 'TEST-STOP-0411', contact: 'stephane.prodpvc@gmail.com' });
ok(!/Photo chèque|Montant encaissé|Note Token|Devis Token|Coût SAV/.test(r.t), 'champs privés absents de la réponse du suivi');

console.log('Pages publiques');
for (const p of ['/', '/index.html', '/amandine.html', '/suivi.html', '/stop.html', '/confidentialite.html', '/avis.html', '/devis.html', '/entretien.html', '/dashboard.html', '/technicien.html', '/admin.html', '/acces.html']) {
  const x = await get(p);
  ok(x.code === 200 && x.t.length > 500, p + ' répond (' + x.code + ', ' + x.t.length + ' octets)');
}
console.log('Planning public');
r = await get('/api/airtable/Planning?maxRecords=3');
ok(r.code === 200 && r.j && r.j.records, 'créneaux lisibles (' + (r.j && r.j.records ? r.j.records.length : r.code) + ')');
r = await get('/api/airtable/Agences?maxRecords=3');
ok(r.code === 200 || r.code === 401, 'agences : ' + r.code);
console.log('Assistants sans crédit (comportement attendu : réponse propre, pas d\'erreur 500)');
for (const p of ['/api/chat-amandine']) {
  r = await post(p, { messages: [{ role: 'user', content: 'Bonjour, ma fenêtre ferme mal' }] });
  ok(r.code !== 500, p + ' : ' + r.code + ' ' + String(r.t).slice(0, 140).replace(/\s+/g, ' '));
}
console.log(echecs ? '\n' + echecs + ' ECHEC(S)' : '\nTOUT EST OK');
process.exit(echecs ? 1 : 0);
