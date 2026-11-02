import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUIVI_TOKEN_SECRET = 'secret-de-test-assez-long-pour-le-test';
const { ajouterMailsAuCorps, retirerMailClient, estDesinscrit } = await import('../api/_mail.js');
const { lireJeton } = await import('../api/_suivi.js');

const demande = () => ({ ticket: 'SAV-2026-0001', nom: 'Jean Dupont', 'e-mail': 'jean@example.fr', tel: '0612345678', produit: 'Volet', probleme: 'Bloqué', creneau: 'lundi', agence: 'Agence 1' });

test('le mail client porte les mentions légales et le lien STOP', () => {
  const c = ajouterMailsAuCorps(demande(), undefined, null);
  assert.match(c.mail_html, /Ne plus recevoir d&#39;e-mails|Ne plus recevoir d'e-mails/);
  assert.match(c.mail_html, /STOP/);
  assert.match(c.mail_html, /CNIL/);
  assert.match(c.mail_html, /confidentialite\.html/);
  const lien = c.lien_stop;
  assert.match(lien, /\/stop\.html\?t=/);
  const id = lireJeton(new URL(lien).searchParams.get('t'));
  assert.equal(id.email, 'jean@example.fr');
});

test('la notification de l\'agence ne porte pas la désinscription', () => {
  const c = ajouterMailsAuCorps(demande(), undefined, null);
  assert.ok(c.mail_html_agence);
  assert.doesNotMatch(c.mail_html_agence, /Ne plus recevoir/);
  assert.doesNotMatch(c.mail_html_agence, /CNIL/);
});

test('un lien STOP envoyé par le navigateur est ignoré', () => {
  const d = demande(); d.lien_stop = 'https://evil.example/stop';
  const c = ajouterMailsAuCorps(d, undefined, null);
  assert.doesNotMatch(c.mail_html, /evil\.example/);
});

test('sans adresse e-mail : pas de lien, mais la consigne STOP reste', () => {
  const d = demande(); delete d['e-mail'];
  const c = ajouterMailsAuCorps(d, undefined, null);
  assert.equal(c.lien_stop, undefined);
  assert.match(c.mail_html, /répondez <b>STOP<\/b>/);
});

test('désinscrit : le mail client est retiré, l\'agence reste prévenue', () => {
  const c = ajouterMailsAuCorps(demande(), undefined, null);
  assert.equal(retirerMailClient(c), true);
  assert.equal(c['e-mail'], '');
  assert.equal(c.mail_html, '');
  assert.ok(c.mail_html_agence);
  const r = ajouterMailsAuCorps({ ticket: 'SAV-1', nom: 'X', 'e-mail': 'x@example.fr', produit: 'Fenêtre' }, 'technicien_en_route', null);
  assert.equal(retirerMailClient(r), false); // rien d'autre à envoyer
});

test('estDesinscrit lit la case Airtable', () => {
  assert.equal(estDesinscrit({ 'Mails désactivés': true }), true);
  assert.equal(estDesinscrit({}), false);
  assert.equal(estDesinscrit(null), false);
});

test('les alertes d\'exploitation n\'ont pas de mentions client', () => {
  const c = ajouterMailsAuCorps({ marque: 'iko', titre: 'Panne', message: 'm', quand: 'maintenant' }, 'alerte_incident', null);
  assert.doesNotMatch(c.mail_html, /CNIL/);
});
