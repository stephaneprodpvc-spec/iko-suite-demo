// Audit sécurité n°3 : un visiteur sans connexion ne reçoit jamais plus que les champs publics
// (fiche entreprise, ticket par identifiant, agences). Une session connectée reçoit les données complètes.
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.AIRTABLE_TOKEN = "faux";
process.env.AIRTABLE_BASE_ID = "appLOCALFICTIF000";
process.env.IKO_DEMO_OUVERT = "0";
process.env.JWT_ACCESS_SECRET = "secret-de-test-champs";
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
const { default: handler, filtrerPourAnonyme } = await import("../api/airtable-proxy.js");

let ip = 0;
async function appeler(chemin, query = {}, { connecte = false, methode = "GET", corps } = {}) {
  const cookie = connecte ? "iko_access=" + encodeURIComponent(jwt.sign({ userId: "u1", role: "SUPER_ADMIN_IKO" }, process.env.JWT_ACCESS_SECRET, { expiresIn: "10m" })) : undefined;
  const req = { method: methode, query: { path: chemin, ...query }, headers: { origin: "http://localhost:3000", "x-forwarded-for": "10.7.0." + (++ip), ...(cookie ? { cookie } : {}) }, socket: { remoteAddress: "10.7.0.1" }, body: corps };
  let code = 200, json = null;
  const res = { status(c) { code = c; return res; }, json(o) { json = o; return res; }, setHeader() {}, end() { return res; }, send(o) { json = o; return res; } };
  await handler(req, res);
  return { code, json };
}

test("fiche entreprise : un visiteur ne voit ni e-mails, ni liste de tickets, ni réglages internes", async () => {
  const r = await appeler("Clients", { filterByFormula: '{Slug}="demo-local"', maxRecords: "1" });
  assert.equal(r.code, 200);
  const f = r.json.records[0].fields;
  assert.ok(f["Nom client"], "le nom reste visible (thème de la page)");
  for (const interdit of ["Emails contact", "Tickets SAV", "Planning", "Notes", "Connaissance entreprise (JSON)", "Qui paie mode", "Qui paie seuil", "Lien de paiement", "Devis", "Utilisateurs", "Contrats entretien", "Techniciens"]) {
    assert.ok(!(interdit in f), interdit + " ne doit pas sortir");
  }
});

test("ticket par identifiant : pas d'e-mail, de téléphone, d'adresse, de facturation ni de jeton", async () => {
  const id = db["Tickets SAV"][0].id;
  const r = await appeler("Tickets SAV/" + id);
  assert.equal(r.code, 200);
  for (const interdit of ["Email", "Téléphone", "Adresse", "Client", "Qui paie", "Qui paie détail", "Note Token", "Devis Token", "Garantie", "Facture", "Qualification", "Mode paiement", "Montant encaissé", "Photo chèque", "Coût SAV Réel"]) {
    assert.ok(!(interdit in r.json.fields), interdit + " ne doit pas sortir");
  }
  assert.ok("Name" in r.json.fields && "Statut" in r.json.fields, "le suivi garde ce dont il a besoin");
});

test("réponse d'une écriture anonyme : même filtre (pas de ticket complet renvoyé)", async () => {
  const id = db["Tickets SAV"][0].id;
  const r = await appeler("Tickets SAV/" + id, {}, { methode: "PATCH", corps: { fields: { "Message client": "bonjour" } } });
  assert.ok(r.code === 200 || r.code === 400 || r.code === 403, "code " + r.code);
  if (r.json && r.json.fields) { assert.ok(!("Email" in r.json.fields)); assert.ok(!("Téléphone" in r.json.fields)); }
});

test("agences : seulement le nom, le lien au client et l'état (pas d'e-mails)", async () => {
  const r = await appeler("Agences", { filterByFormula: 'FIND("recLOCALCLIENT0001",ARRAYJOIN({Client}))', maxRecords: "50" });
  assert.equal(r.code, 200);
  for (const a of r.json.records) { assert.ok(!("Email agence" in a.fields)); assert.ok(!("Email technicien SAV" in a.fields)); }
});

test("connecté : les données complètes restent disponibles", async () => {
  const r = await appeler("Clients", { filterByFormula: '{Slug}="demo-local"', maxRecords: "1" }, { connecte: true });
  assert.equal(r.code, 200);
  assert.ok(Object.keys(r.json.records[0].fields).length > 5, "session connectée : fiche complète");
});

test("filtre direct : les autres tables ne sont pas touchées, valeurs inconnues ignorées", () => {
  const planning = { records: [{ id: "r1", fields: { Date: "2026-11-20", Statut: "Libre" } }] };
  assert.deepEqual(filtrerPourAnonyme("Planning", planning).records[0].fields, { Date: "2026-11-20", Statut: "Libre" });
  assert.equal(filtrerPourAnonyme("Tickets%20SAV", { fields: { Email: "x@y.fr", Name: "SAV-1" } }).fields.Email, undefined);
  assert.equal(filtrerPourAnonyme("clients", null), null);
});
