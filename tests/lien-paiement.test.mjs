// Lien de paiement de l'entreprise dans le message « Qui paie ? » : jamais pris du navigateur, seulement chez un prestataire connu.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SUIVI_TOKEN_SECRET = "secret-de-test-assez-long-pour-le-test";
const { lienPaiementSur, ajouterMailsAuCorps } = await import("../api/_mail.js");

const corpsBase = () => ({ ticket: "SAV-1", nom: "Jean", "e-mail": "jean@example.fr", texte_facturation: "Le déplacement est facturé." });

test("hôtes de paiement acceptés, tout le reste refusé", () => {
  assert.equal(lienPaiementSur("https://buy.stripe.com/test_abc123"), "https://buy.stripe.com/test_abc123");
  assert.equal(lienPaiementSur("https://paypal.me/entreprise/65"), "https://paypal.me/entreprise/65");
  assert.equal(lienPaiementSur("http://buy.stripe.com/abc12345"), "");              // pas de http
  assert.equal(lienPaiementSur("https://buy.stripe.com.pirate.fr/abc12345"), "");   // faux sous-domaine
  assert.equal(lienPaiementSur("https://pirate.fr/buy.stripe.com/abc"), "");
  assert.equal(lienPaiementSur("javascript:alert(1)"), "");
  assert.equal(lienPaiementSur('https://buy.stripe.com/a"onclick="x'), "");
  assert.equal(lienPaiementSur(""), "");
});

test("le mail contient le bouton « Payer en ligne » quand l'entreprise a un lien valide", () => {
  const c = ajouterMailsAuCorps(corpsBase(), "qui_paie_client", { nom: "Menuiserie A", lienPaiement: "https://buy.stripe.com/test_abc123" });
  assert.ok(c.mail_html.includes("Payer en ligne"));
  assert.ok(c.mail_html.includes('href="https://buy.stripe.com/test_abc123"'));
});

test("sans lien, ou avec un lien non autorisé : pas de bouton", () => {
  assert.ok(!ajouterMailsAuCorps(corpsBase(), "qui_paie_client", { nom: "A" }).mail_html.includes("Payer en ligne"));
  assert.ok(!ajouterMailsAuCorps(corpsBase(), "qui_paie_client", { nom: "A", lienPaiement: "https://pirate.fr/payer" }).mail_html.includes("Payer en ligne"));
});

test("un lien de paiement envoyé par le navigateur est ignoré", () => {
  const corps = Object.assign(corpsBase(), { lien_paiement: "https://buy.stripe.com/pirate999" });
  const c = ajouterMailsAuCorps(corps, "qui_paie_client", { nom: "A" });
  assert.ok(!c.mail_html.includes("pirate999"));
  assert.equal(c.lien_paiement, undefined);
});

test("les autres mails n'ont jamais de lien de paiement", () => {
  const c = ajouterMailsAuCorps(corpsBase(), "nouveau_ticket", { nom: "A", lienPaiement: "https://buy.stripe.com/test_abc123" });
  assert.ok(!String(c.mail_html || "").includes("buy.stripe.com"));
});
