// Audit sécurité n°3 : notifications téléphone. Sans connexion : rien. Avec connexion : uniquement son entreprise, des adresses de
// services de notification connus, des liens internes.
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import webpush from "web-push";
import { creerFaux } from "./fake-airtable.mjs";

const cles = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = cles.publicKey; process.env.VAPID_PRIVATE_KEY = cles.privateKey;
process.env.JWT_ACCESS_SECRET = "secret-push"; process.env.JWT_REFRESH_SECRET = "r"; process.env.AIRTABLE_TOKEN = "faux"; process.env.AIRTABLE_BASE_ID = "appTEST00000000A"; process.env.IKO_DEMO_OUVERT = "0";
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const A = "recCLIENTA0000001", B = "recCLIENTB0000002";
const db = {
  Clients: [{ id: A, fields: { "Nom client": "A", Slug: "a" } }, { id: B, fields: { "Nom client": "B", Slug: "b" } }],
  Planning: [{ id: "rec45X231n9dXnyaU", fields: { Date: "CONFIG-PLANNING", "Config JSON": JSON.stringify({ pushSubscriptions: [] }) } }],
  "Tickets SAV": [], Agences: [], Utilisateurs: [], "Journal actions": [],
};
const faux = creerFaux(db);
globalThis.fetch = async (url, opt) => faux(url, opt);
const { default: proxy, endpointPushValide, lienPushSur } = await import("../api/airtable-proxy.js");
const { appareilsConcernes } = await import("../api/_alertes.js");
const cookieDe = (s) => "iko_access=" + jwt.sign(s, process.env.JWT_ACCESS_SECRET);
const PATRON_A = { userId: "recPATRON0000001A", tenantId: A, role: "TENANT_ADMIN" };
const PATRON_B = { userId: "recPATRON0000002B", tenantId: B, role: "TENANT_ADMIN" };
const TECH_A = { userId: "recTECHNIC000001A", tenantId: A, role: "TECHNICIEN", agence: "Agence 2" };
const SUPER = { userId: "recSUPER000000001", role: "SUPER_ADMIN_IKO" };
let n = 0;
async function push(session, corps, methode = "POST") {
  const req = { method: methode, query: { path: "push" }, body: corps, headers: { origin: "http://localhost:3000", cookie: session ? cookieDe(session) : "", "x-forwarded-for": "10.5.0." + (++n) }, socket: { remoteAddress: "10.5.0.1" } };
  return new Promise((resolve) => { const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b }); return this; }, end() { resolve({ code: this.code }); return this; } }; proxy(req, res).catch((e) => resolve({ code: 500, corps: String(e) })); });
}
const abonnement = (endpoint) => ({ endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } });
const stockes = () => JSON.parse(db.Planning[0].fields["Config JSON"]).pushSubscriptions;

test("sans connexion : ni inscription, ni envoi (la clé publique reste lisible)", async () => {
  assert.equal((await push(null, { subscribe: true, agence: "Agence 1", subscription: abonnement("https://fcm.googleapis.com/fcm/send/abc") })).code, 401);
  assert.equal((await push(null, { action: "send", agence: "Agence 1", title: "x", body: "y", url: "https://pirate.fr" })).code, 401);
  assert.equal(stockes().length, 0);
  const cle = await push(null, undefined, "GET");
  assert.equal(cle.code, 200); assert.ok(cle.corps.publicKey);
});

test("adresses d'abonnement : seuls les services de notification connus", () => {
  assert.equal(endpointPushValide("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(endpointPushValide("https://updates.push.services.mozilla.com/wpush/v2/abc"), true);
  assert.equal(endpointPushValide("https://web.push.apple.com/abc"), true);
  assert.equal(endpointPushValide("https://wns2-par02p.notify.windows.com/w/?token=abc"), true);
  assert.equal(endpointPushValide("http://fcm.googleapis.com/x"), false);
  assert.equal(endpointPushValide("https://pirate.example/x"), false);
  assert.equal(endpointPushValide("https://fcm.googleapis.com.pirate.example/x"), false);
  assert.equal(endpointPushValide("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(endpointPushValide(""), false);
});

test("lien de la notification : chemin interne seulement", () => {
  assert.equal(lienPushSur("/technicien.html"), "/technicien.html");
  assert.equal(lienPushSur("/dashboard.html?ticket=SAV-1"), "/dashboard.html?ticket=SAV-1");
  assert.equal(lienPushSur("https://pirate.fr/connexion"), "/technicien.html");
  assert.equal(lienPushSur("//pirate.fr/x"), "/technicien.html");
  assert.equal(lienPushSur("javascript:alert(1)"), "/technicien.html");
  assert.equal(lienPushSur(undefined), "/technicien.html");
});

test("inscription : entreprise gardée, agence imposée pour un compte d'agence, adresse contrôlée, alertes réservées", async () => {
  assert.equal((await push(PATRON_A, { subscribe: true, agence: "Agence 1", subscription: abonnement("https://pirate.example/x") })).code, 400);
  assert.equal((await push(PATRON_A, { subscribe: true, agence: "Agence 1", subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/a1", keys: {} } })).code, 400);
  assert.equal((await push(PATRON_A, { subscribe: true, agence: "alertes", subscription: abonnement("https://fcm.googleapis.com/fcm/send/a2") })).code, 403);
  assert.equal((await push(PATRON_A, { subscribe: true, agence: "Agence 1", subscription: abonnement("https://fcm.googleapis.com/fcm/send/a3") })).code, 200);
  assert.equal((await push(TECH_A, { subscribe: true, agence: "Agence 9", subscription: abonnement("https://fcm.googleapis.com/fcm/send/a4") })).code, 200);
  assert.equal((await push(SUPER, { subscribe: true, agence: "alertes", subscription: abonnement("https://fcm.googleapis.com/fcm/send/a5") })).code, 200);
  const s = stockes();
  assert.deepEqual(s.find((x) => x.endpoint.endsWith("/a3")), { agence: "Agence 1", tenant: A, endpoint: "https://fcm.googleapis.com/fcm/send/a3", keys: abonnement("x").keys });
  assert.equal(s.find((x) => x.endpoint.endsWith("/a4")).agence, "Agence 2"); // le technicien reste sur son agence
  assert.equal(s.find((x) => x.endpoint.endsWith("/a5")).tenant, "");
});

test("envoi : le patron de B n'atteint aucun appareil de l'entreprise A", async () => {
  const r = await push(PATRON_B, { action: "send", agence: "Agence 1", title: "Test", body: "x" });
  assert.equal(r.code, 200); assert.equal(r.corps.envoyes, 0);
  assert.equal((await push(PATRON_B, { action: "send", agence: "alertes", title: "Test", body: "x" })).corps.envoyes, 0); // pas d'alertes d'administration
});

test("sélection des appareils : même entreprise, agence exacte (Agence 1 ≠ Agence 10), anciens abonnements seulement « global »", () => {
  const subs = [
    { agence: "Agence 1", tenant: A, endpoint: "e1" }, { agence: "Agence 10", tenant: A, endpoint: "e10" }, { agence: "Agence 1", tenant: B, endpoint: "eB" },
    { agence: "global", tenant: A, endpoint: "eGlobalA" }, { agence: "Agence 1", endpoint: "eAncien" }, { agence: "global", endpoint: "eAncienGlobal" }, { agence: "alertes", tenant: "", endpoint: "eAlerte" },
  ];
  const noms = (l) => l.map((s) => s.endpoint).sort();
  assert.deepEqual(noms(appareilsConcernes(subs, "Agence 1", A)), ["e1", "eAncienGlobal", "eGlobalA"]);
  assert.deepEqual(noms(appareilsConcernes(subs, "Agence 10", A)), ["e10", "eAncienGlobal", "eGlobalA"]);
  assert.deepEqual(noms(appareilsConcernes(subs, "Agence 1", B)), ["eAncienGlobal", "eB"]);
  assert.deepEqual(noms(appareilsConcernes(subs, "Agence 1", "")), ["eAncienGlobal"]);
});
