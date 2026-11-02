// Tests des correctifs de l'audit de securite du 02/11/2026 (api/AUDIT-SECURITE-2026-11-02.md dans 6-DOCUMENTS). Aucun appel reseau.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.AIRTABLE_BASE_ID = "appTEST00000000A";
process.env.YOUSIGN_API_KEY = "ys-test";
delete process.env.IKO_DEMO_OUVERT; delete process.env.IKO_MDP_UNIQUE;

const securite = await import("../api/_securite.js");
const { handleAlerte } = await import("../api/_alertes.js");
const { default: webhook } = await import("../api/yousign-webhook.js");
const { estDemoSession } = await import("../api/_ia-secours.js");
const fetchReel = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchReel; });

const cookie = (s) => "iko_access=" + jwt.sign(s, process.env.JWT_ACCESS_SECRET);
const SUPER = { userId: "recSUPER000000001", role: "SUPER_ADMIN_IKO" };
const PATRON_A = { userId: "recPATRON0000001A", tenantId: "recCLIENTA0000001", role: "TENANT_ADMIN" };
function appeler(handler, { methode = "GET", query = {}, session, corps }) {
  const req = { method: methode, query, body: corps, headers: { origin: "http://localhost:3000", host: "localhost:3000", ...(session ? { cookie: cookie(session) } : {}) }, socket: { remoteAddress: "127.0.0.1" }, [Symbol.asyncIterator]: async function* () {} };
  return new Promise((resolve) => {
    const res = { code: 200, entetes: {}, setHeader(k, v) { this.entetes[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b }); }, send(b) { resolve({ code: this.code, corps: b }); }, end() { resolve({ code: this.code }); } };
    Promise.resolve(handler(req, res)).catch((e) => resolve({ code: 500, corps: String(e && e.stack || e) }));
  });
}

test("constat 1 : le mode demo ouvert est FERME par defaut (il faut IKO_DEMO_OUVERT=1 explicite)", async () => {
  assert.equal(securite.MODE_DEMO_OUVERT, false);
  assert.equal(securite.verifierSession({ headers: {} }), null, "sans cookie : aucune session");
  assert.equal(securite.verifierSession({ headers: { cookie: "iko_access=n-importe-quoi" } }), null, "jeton invalide : aucune session");
});

test("constat 2 : seule la supervision IKO (super admin) lit ou modifie la configuration d'alerte", async () => {
  for (const methode of ["GET", "POST"]) {
    const r = await appeler(handleAlerte, { methode, session: PATRON_A, corps: { action: "config", email: "pirate@x.fr", tel: "0600000000", actif: true } });
    assert.equal(r.code, 403, methode + " par un patron de client");
  }
  const sans = await appeler(handleAlerte, { methode: "GET" });
  assert.equal(sans.code, 403);
});

test("constat 3 : telechargement du devis signe = session + devis connu + meme entreprise", async () => {
  const appels = [];
  globalThis.fetch = async (url) => {
    const u = String(url); appels.push(u);
    if (u.includes("api.airtable.com") && u.includes("/Devis")) {
      const connu = decodeURIComponent(u).includes("REQUETE-DEVIS-A-1234");
      return { ok: true, status: 200, json: async () => ({ records: connu ? [{ id: "recDEVIS10000001", fields: { "Client Record ID": ["recCLIENTA0000001"] } }] : [] }) };
    }
    return { ok: true, status: 200, headers: { get: () => "application/pdf" }, arrayBuffer: async () => new TextEncoder().encode("%PDF-test").buffer };
  };
  const q = (id) => ({ download: id });
  assert.equal((await appeler(webhook, { query: q("REQUETE-DEVIS-A-1234") })).code, 401, "sans session");
  assert.equal(appels.length, 0, "aucun appel Yousign sans session");
  assert.equal((await appeler(webhook, { query: q("../../etc"), session: SUPER })).code, 400, "identifiant invalide");
  assert.equal((await appeler(webhook, { query: q("REQUETE-INCONNUE-9999"), session: SUPER })).code, 404, "demande inconnue");
  assert.equal((await appeler(webhook, { query: q("REQUETE-DEVIS-A-1234"), session: { ...PATRON_A, tenantId: "recCLIENTB0000002" } })).code, 403, "autre entreprise");
  assert.equal((await appeler(webhook, { query: q("REQUETE-DEVIS-A-1234"), session: PATRON_A })).code, 200, "meme entreprise");
  assert.equal((await appeler(webhook, { query: q("REQUETE-DEVIS-A-1234"), session: SUPER })).code, 200, "super admin");
});

test("secours IA : jamais pour un client reel, une session expiree ou absente ; oui pour le super admin sans client", async () => {
  const req = (cookieHeader) => ({ headers: cookieHeader ? { cookie: cookieHeader } : {} });
  assert.equal(await estDemoSession(req(cookie(SUPER))), true);
  assert.equal(await estDemoSession(req(cookie(PATRON_A))), false, "patron d'un client");
  assert.equal(await estDemoSession(req(null)), false, "sans session");
  assert.equal(await estDemoSession(req("iko_access=expire-ou-invalide")), false, "jeton invalide/expire");
});
