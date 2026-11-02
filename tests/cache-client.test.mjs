// Tests : cache court de la fiche Clients du tenant (economie d'appels Airtable, forfait gratuit = 1000 appels/mois).
// Lancer : node --test tests/cache-client.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { creerFaux } from "./fake-airtable.mjs";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.AIRTABLE_BASE_ID = "appTEST00000000A";
process.env.IKO_DEMO_OUVERT = "0";
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const { default: proxy } = await import("../api/airtable-proxy.js");

const A = "recCLIENTA0000001";
const db = {
  Clients: [{ id: A, fields: { "Nom client": "Entreprise A", Slug: "a", "Modules actifs": ["Dashboard", "Technicien", "SAV"] } }],
  Agences: [], "Tickets SAV": [{ id: "recTICKET10000001", fields: { Name: "SAV-1", Agence: "Agence 1", "Compte client": [A], Statut: "Nouveau" } }],
  Planning: [], Techniciens: [], Devis: [], "Interventions SAV": [], "Contrats entretien": [], "Catalogue Produits": [],
  Utilisateurs: [], "Journal actions": [], "Planning Commercial": [], "RDV Commercial": [], "Métrés": [],
};
const faux = creerFaux(db);
let lecturesClient = 0;
globalThis.fetch = async (url, init) => {
  if (/\/Clients\/recCLIENTA0000001/.test(String(url)) && (!init || !init.method || init.method === "GET")) lecturesClient++;
  return faux(url, init);
};

const PATRON = { userId: "recPATRON0000001A", tenantId: A, role: "TENANT_ADMIN" };
function http({ methode = "GET", chemin, corps }) {
  const req = { method: methode, query: { path: chemin }, body: corps, headers: { origin: "http://localhost:3000", cookie: "iko_access=" + jwt.sign(PATRON, process.env.JWT_ACCESS_SECRET) }, socket: { remoteAddress: "127.0.0.1" } };
  return new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b }); }, end() { resolve({ code: this.code }); } };
    proxy(req, res).catch((e) => resolve({ code: 500, corps: String(e && e.stack || e) }));
  });
}

test("la fiche du client n'est relue qu'une fois par minute pour des lectures successives", async () => {
  const r1 = await http({ chemin: "Interventions SAV" });
  const r2 = await http({ chemin: "Interventions SAV" });
  const r3 = await http({ chemin: "Interventions SAV" });
  assert.equal(r1.code, 200); assert.equal(r2.code, 200); assert.equal(r3.code, 200);
  assert.equal(Array.isArray(r1.corps.records), true);
  assert.equal(lecturesClient, 1, "3 lectures d interventions = 1 seule lecture de la fiche client");
});

test("une modification de la table Clients vide le cache : la fiche est relue", async () => {
  const avant = lecturesClient;
  await http({ methode: "PATCH", chemin: "Clients/" + A, corps: { fields: { Notes: "x" } } });
  await http({ chemin: "Interventions SAV" });
  assert.ok(lecturesClient > avant, "la fiche doit etre relue apres une ecriture sur Clients");
});
