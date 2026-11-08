// Tests : message « Qui paie ? » envoyé au client (airtable-proxy, action qui_paie_client). Aucun appel réseau.
// Lancer : node --test tests/qui-paie-mail.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { creerFaux } from "./fake-airtable.mjs";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.AIRTABLE_BASE_ID = "appTEST00000000A";
process.env.IKO_DEMO_OUVERT = "0";
process.env.SUIVI_TOKEN_SECRET = "secret-de-test-assez-long-pour-le-test";
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const { default: proxy } = await import("../api/airtable-proxy.js");

const A = "recCLIENTA0000001", B = "recCLIENTB0000002";
const detail = (o = {}) => JSON.stringify({ payeur: "client", deplacementFacture: true, montantDeplacement: 65, decision: "auto", texteFacturation: "Le déplacement et le diagnostic (65 € HT) sont facturés.", ...o });
let db, make, compteur = 0;

function reinitialiser(detailTicket = detail()) {
  db = {
    Clients: [{ id: A, fields: { "Nom client": "Entreprise A", Slug: "a", "Modules actifs": ["Dashboard", "Technicien", "SAV"] } }, { id: B, fields: { "Nom client": "Entreprise B" } }],
    "Tickets SAV": [{ id: "recTICKET10000001", fields: { Name: "SAV-1", Client: "Jean", Email: "jean@example.fr", "Compte client": [A], "Qui paie détail": detailTicket } }],
    Planning: [], Agences: [], Utilisateurs: [], "Journal actions": [],
  };
  const faux = creerFaux(db);
  make = [];
  globalThis.fetch = async (url, opt) => {
    if (String(url).includes("hook.eu1.make.com")) { make.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    return faux(url, opt);
  };
}
beforeEach(() => reinitialiser());

const cookieDe = (s) => "iko_access=" + jwt.sign(s, process.env.JWT_ACCESS_SECRET);
const PATRON_A = { userId: "recPATRON0000001A", tenantId: A, role: "TENANT_ADMIN" };
const PATRON_B = { userId: "recPATRON0000002B", tenantId: B, role: "TENANT_ADMIN" };
function envoyer(session, ticket = "SAV-1") {
  const req = { method: "POST", query: { path: "webhook" }, body: { action: "qui_paie_client", ticket }, headers: { origin: "http://localhost:3000", cookie: session ? cookieDe(session) : "" }, socket: { remoteAddress: "10.5.0." + (compteur++ & 255) } };
  return new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b }); return this; }, end() { resolve({ code: this.code }); return this; } };
    proxy(req, res).catch((e) => resolve({ code: 500, corps: String(e && e.stack || e) }));
  });
}

test("décision claire, client à facturer : le mail part une fois, via la route Make existante", async () => {
  const r = await envoyer(PATRON_A);
  assert.equal(r.code, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.envoye, true);
  assert.equal(make.length, 1);
  assert.equal(make[0].action, "reponse_agence");
  assert.match(make[0].mail_html, /65 € HT/);
  assert.equal(make[0]["e-mail"], "jean@example.fr");
  const q = JSON.parse(db["Tickets SAV"][0].fields["Qui paie détail"]);
  assert.ok(q.messageEnvoye);
  const encore = await envoyer(PATRON_A);
  assert.equal(encore.corps.raison, "deja-envoye");
  assert.equal(make.length, 1);
});

test("pas de session : refusé, rien n'est envoyé", async () => {
  const r = await envoyer(null);
  assert.equal(r.code, 401); assert.equal(make.length, 0);
});

test("un autre client ne peut pas déclencher le mail d'un ticket qui n'est pas le sien", async () => {
  const r = await envoyer(PATRON_B);
  assert.equal(r.code, 403); assert.equal(make.length, 0);
});

test("décision à valider, ou rien à facturer au client : aucun mail", async () => {
  reinitialiser(detail({ decision: "a_valider" }));
  assert.equal((await envoyer(PATRON_A)).corps.raison, "decision-non-validee");
  reinitialiser(detail({ payeur: "fabricant", deplacementFacture: false, texteFacturation: "" }));
  assert.equal((await envoyer(PATRON_A)).corps.raison, "rien-a-facturer-au-client");
  assert.equal(make.length, 0);
});

test("client désinscrit (STOP) ou sans e-mail : aucun mail", async () => {
  db["Tickets SAV"][0].fields["Mails désactivés"] = true;
  assert.equal((await envoyer(PATRON_A)).corps.raison, "client-desinscrit");
  reinitialiser(); delete db["Tickets SAV"][0].fields.Email;
  assert.equal((await envoyer(PATRON_A)).corps.raison, "pas-d-email");
  assert.equal(make.length, 0);
});
