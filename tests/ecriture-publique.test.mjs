// Audit sécurité n°3 : ce qu'un visiteur SANS connexion peut écrire (liste blanche champ par champ).
// Les cas « permis » reproduisent exactement les écritures des pages publiques (suivi, devis, avis, prise de rendez-vous).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.AIRTABLE_TOKEN = "faux";
process.env.AIRTABLE_BASE_ID = "appLOCALFICTIF000";
process.env.IKO_DEMO_OUVERT = "0";
process.env.JWT_ACCESS_SECRET = "secret-de-test-ecriture";
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const { creerDonnees } = await import("../iko-local/donnees.mjs");
const { creerFaux } = await import("../iko-local/airtable-faux.mjs");
const db = creerDonnees();
const faux = creerFaux(db);
globalThis.fetch = async (url, init) => {
  const u = new URL(typeof url === "string" ? url : url.url);
  if (u.hostname === "api.airtable.com") return faux(u.href, init || {});
  throw new Error("appel réseau bloqué : " + u.hostname);
};
const { default: handler, verifierEcritureAnonyme: verifier } = await import("../api/airtable-proxy.js");

let ip = 0;
async function appeler(methode, chemin, corps) {
  const req = { method: methode, query: { path: chemin }, headers: { origin: "http://localhost:3000", "x-forwarded-for": "10.3.0." + (++ip) }, socket: { remoteAddress: "10.3.0.1" }, body: corps };
  let code = 200, json = null;
  const res = { status(c) { code = c; return res; }, json(o) { json = o; return res; }, setHeader() {}, end() { return res; }, send(o) { json = o; return res; } };
  const log = console.log; console.log = () => {};
  try { await handler(req, res); } finally { console.log = log; }
  return { code, json };
}
const idTicket = db["Tickets SAV"][0].id;
const idCreneau = (db.Planning.find((p) => p.fields.Statut) || db.Planning[0]).id;

test("gestes des pages publiques : tous permis", () => {
  assert.equal(verifier("Tickets SAV", "PATCH", "rec1", { fields: { "Message client": "bonjour", "Message client non lu": true } }), null);
  assert.equal(verifier("Tickets SAV", "PATCH", "rec1", { fields: { Statut: "Annulé", "Raison annulation": "plus besoin" } }), null);
  assert.equal(verifier("Tickets SAV", "PATCH", "rec1", { fields: { Statut: "Nouveau", Créneau: "Matin — lundi", PlanningID: "recX", "Proposition auto en attente": false, "Proposition auto créneau": "", "Proposition auto mois": "", "RDV modifié - notif technicien": true, "En route depuis": null, "Arrivée estimée": null, "Réponse agence": "ok" } }), null);
  assert.equal(verifier("Tickets SAV", "PATCH", "rec1", { fields: { Statut: "Devis refusé", Commentaire: "trop cher" } }), null);
  assert.equal(verifier("Tickets SAV", "PATCH", "rec1", { fields: { Note: 5, "Note Commentaire": "super" } }), null);
  assert.equal(verifier("Tickets SAV", "PATCH", "rec1", { fields: { Photos: "https://res.cloudinary.com/dvbh3llqq/image/upload/v1/iko-suite-sav/a.jpg, https://res.cloudinary.com/dvbh3llqq/raw/upload/v1/iko-suite-sav/b.pdf" } }), null);
  assert.equal(verifier("Planning", "PATCH", "rec1", { fields: { Statut: "Pris" } }), null);
  assert.equal(verifier("Planning", "PATCH", "rec1", { fields: { Statut: "Libre" } }), null);
  assert.equal(verifier("Devis", "PATCH", "rec1", { fields: { "Devis refusé": true, "Motif refus": "x", "Categorie refus": "Prix" } }), null);
  assert.equal(verifier("Devis", "PATCH", "rec1", { fields: { "Yousign Signer Link": "https://yousign.app/auth/abc" } }), null);
  assert.equal(verifier("Devis", "PATCH", "rec1", { fields: { "Yousign Signer Link": "https://ys-sandbox.yousign.app/s/abc?x=1" } }), null);
});

test("tout le reste est refusé sans connexion", () => {
  const refuse = (...a) => { const r = verifier(...a); assert.ok(r && r.code >= 400, JSON.stringify(a)); };
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { Email: "pirate@x.fr" } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { "Téléphone": "0600" } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { "Qui paie détail": "{}" } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { "Compte client": ["recX"] } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { "Mails désactivés": true } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { Statut: "Terminé" } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { Statut: "Supprimé" } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { Note: 99 } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { Photos: "https://pirate.fr/x.jpg" } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { "Message client": "x".repeat(9000) } });
  refuse("Tickets SAV", "PATCH", "rec1", { fields: { "Message client": "ok" }, typecast: true });   // pas d'option cachée
  refuse("Tickets SAV", "PATCH", undefined, { fields: { "Message client": "ok" } });                 // pas d'écriture en lot sans identifiant
  refuse("Tickets SAV", "PATCH", "rec1", { records: [{ id: "rec1", fields: { Email: "x" } }] });
  refuse("Tickets SAV", "POST", undefined, { fields: { Name: "X" } });
  refuse("Tickets SAV", "DELETE", "rec1", undefined);
  refuse("Planning", "PATCH", "rec1", { fields: { Statut: "Bloqué" } });
  refuse("Planning", "PATCH", "rec1", { fields: { Date: "2030-01-01" } });
  refuse("Planning", "POST", undefined, { fields: { Statut: "Libre" } });
  refuse("Devis", "PATCH", "rec1", { fields: { Statut: "Validé" } });
  refuse("Devis", "PATCH", "rec1", { fields: { "Montant TTC": 1 } });
  refuse("Devis", "PATCH", "rec1", { fields: { "Yousign Signer Link": "https://pirate.fr/yousign.app/x" } });
  refuse("Devis", "PATCH", "rec1", { fields: { "Yousign Signer Link": "https://yousign.app.pirate.fr/x" } });
  refuse("Devis", "POST", undefined, { fields: { "N° devis": "X" } });
  for (const table of ["Agences", "Clients", "Techniciens", "Contrats entretien", "Catalogue Produits", "Questionnaire SAV", "Métrés", "Utilisateurs"]) refuse(table, "PATCH", "rec1", { fields: { Nom: "x" } });
});

test("de bout en bout (base factice) : e-mail de ticket, e-mail d'agence, statut de devis refusés ; message client accepté", async () => {
  assert.equal((await appeler("PATCH", "Tickets SAV/" + idTicket, { fields: { Email: "pirate@x.fr" } })).code, 403);
  assert.notEqual(db["Tickets SAV"][0].fields.Email, "pirate@x.fr");
  assert.equal((await appeler("PATCH", "Agences/" + (db.Agences[0] && db.Agences[0].id), { fields: { "Email agence": "pirate@x.fr" } })).code, 401);
  assert.equal((await appeler("PATCH", "Planning/" + idCreneau, { fields: { Statut: "Bloqué" } })).code, 403);
  assert.equal((await appeler("PATCH", "Tickets SAV/" + idTicket, { fields: { "Message client": "bonjour" } })).code, 200);
  assert.equal(db["Tickets SAV"][0].fields["Message client"], "bonjour");
});

test("plafond d'écritures par heure et par adresse", async () => {
  const meme = "10.3.9.9";
  let dernier = 200;
  for (let i = 0; i < 65; i++) {
    const req = { method: "PATCH", query: { path: "Tickets SAV/" + idTicket }, headers: { origin: "http://localhost:3000", "x-forwarded-for": meme }, socket: { remoteAddress: meme }, body: { fields: { "Message client": "m" + i } } };
    const res = { status(c) { dernier = c; return res; }, json() { return res; }, setHeader() {}, end() { return res; }, send() { return res; } };
    const log = console.log; console.log = () => {};
    try { await handler(req, res); } finally { console.log = log; }
  }
  assert.equal(dernier, 429);
});
