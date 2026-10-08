// Tests du planning par client et par agence (api/_planning.js, route /api/airtable/creneaux,
// actions admin). Lancer : npm install && node --test
// AUCUN appel reseau reel, AUCUNE ecriture Airtable reelle : faux Airtable en memoire.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { creerFaux } from "./fake-airtable.mjs";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.AIRTABLE_TOKEN = "test-token";

const P = await import("../api/_planning.js");
const { default: proxy } = await import("../api/airtable-proxy.js");
const { default: verif } = await import("../api/verif-securite.js");

// 2026-10-08 est un jeudi ; delai minimum 7 jours -> premier jour propose : 2026-10-15
const NOW = new Date("2026-10-08T10:00:00Z");
const A = { clientId: "recAAAAAAAAAAAAAA", clientNom: "Roussel" };
const B = { clientId: "recBBBBBBBBBBBBBB", clientNom: "Roussel Pro" }; // le nom de A est une sous-chaine de celui de B
let db;
let panne;

function reinitialiser() {
  panne = false;
  db = {
    Clients: [
      { id: A.clientId, fields: { "Nom client": "Roussel", "Slug": "roussel" } },
      { id: B.clientId, fields: { "Nom client": "Roussel Pro", "Slug": "roussel-pro" } },
      { id: "recCCCCCCCCCCCCCC", fields: { "Nom client": "Bloque SA", "Slug": "bloque", "Accès bloqué": true } },
    ],
    Agences: [], Utilisateurs: [], Planning: [], "Tickets SAV": [],
  };
  globalThis.fetch = creerFaux(db, { echec: (m, t, n) => panne !== false && m === "POST" && t === "Planning" && n >= panne });
}
beforeEach(reinitialiser);

const ctx = () => ({ baseId: "appTEST", headers: { Authorization: "Bearer test" }, maintenant: () => NOW, sansCache: true });
const libres = (rows) => rows.filter((r) => r.fields.Statut === "Libre");
const lignesCreneaux = (client) => db.Planning.filter((r) => r.fields.Date !== P.CLE_CONFIG && (client ? (r.fields["Compte client"] || [])[0] === client : true));

// ---------- fonctions pures ----------

test("jours feries francais (dont Paques, Ascension, Pentecote)", () => {
  const f = P.joursFeriesFR(2026);
  for (const d of ["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25"]) assert.ok(f.has(d), d);
  assert.equal(f.size, 11);
  assert.ok(P.joursFeriesFR(2027).has("2027-03-29")); // lundi de Paques 2027
});

test("validation des reglages : bornes, heures precises refusees pour l'instant", () => {
  assert.equal(P.validerReglages({ capacite: 0 }).ok, false);
  assert.equal(P.validerReglages({ capacite: 21 }).ok, false);
  assert.equal(P.validerReglages({ joursTravailles: [] }).ok, false);
  assert.equal(P.validerReglages({ delaiMinJours: -1 }).ok, false);
  assert.equal(P.validerReglages({ horizonSemaines: 13 }).ok, false);
  assert.equal(P.validerReglages({ decoupage: { mode: "demi-journees", periodes: [] } }).ok, false);
  assert.equal(P.validerReglages({ fermetures: [{ du: "2026-12-31", au: "2026-12-24" }] }).ok, false);
  assert.equal(P.validerReglages({ fermetures: [{ du: "2026-02-30", au: "2026-03-01" }] }).ok, false);
  const h = P.validerReglages({ decoupage: { mode: "heures", plages: [{ debut: "09:00", fin: "12:00" }], dureeMinutes: 60 } });
  assert.equal(h.ok, false);
  assert.match(h.erreur, /heures précises/);
  const ok = P.validerReglages({ capacite: 2, joursTravailles: [3, 1, 1], fermetures: [{ du: "2026-12-24", au: "2026-12-31", motif: "Conges" }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.reglages.joursTravailles, [1, 3]);
});

test("la structure heures precises est prete : le generateur sait decouper (phase 2)", () => {
  const r = P.fusionnerReglages(P.REGLAGES_DEFAUT, { decoupage: { mode: "heures", plages: [{ debut: "09:00", fin: "12:00" }, { debut: "14:00", fin: "16:00" }], dureeMinutes: 60 } });
  assert.deepEqual(P.decouper(r).map((c) => c.label), ["9h00 — 10h00", "10h00 — 11h00", "11h00 — 12h00", "14h00 — 15h00", "15h00 — 16h00"]);
});

test("fusion : l'agence remplace champ par champ", () => {
  const r = P.fusionnerReglages(P.REGLAGES_DEFAUT, { capacite: 2, delaiMinJours: 3 }, { capacite: 5 });
  assert.equal(r.capacite, 5);
  assert.equal(r.delaiMinJours, 3);
  assert.equal(r.horizonSemaines, 6);
});

test("creneaux theoriques : jours travailles, feries et fermetures exclus", () => {
  const r = P.fusionnerReglages(P.REGLAGES_DEFAUT, { fermetures: [{ du: "2026-12-24", au: "2026-12-31", motif: "Conges" }] });
  const c = P.creneauxTheoriques(r, "2026-12-21", "2027-01-04");
  assert.deepEqual([...new Set(c.map((x) => x.date))], ["2026-12-21", "2026-12-22", "2026-12-23", "2027-01-04"]);
  assert.equal(c.length, 8);
  assert.deepEqual([...new Set(c.map((x) => x.label))], ["Matin (8h30 — 12h00)", "Après-midi (13h00 — 17h00)"]);
});

// ---------- generation et lecture par client ----------

test("generation a la demande : creneaux du client, delai minimum, horizon, pas de doublon", async () => {
  const r1 = await P.creneauxLibres(ctx(), A, { agence: "Agence 1", periode: "matin" });
  assert.ok(r1.creneaux.length > 20);
  r1.creneaux.forEach((c) => {
    assert.ok(c.date >= "2026-10-15" && c.date <= "2026-11-19", c.date);
    assert.ok([1, 2, 3, 4, 5].includes(P.jourSemaine(c.date)));
    assert.notEqual(c.date, "2026-11-11"); // jour ferie
    assert.match(c.creneau, /^Matin/);
  });
  const lignes = lignesCreneaux();
  assert.ok(lignes.every((l) => (l.fields["Compte client"] || [])[0] === A.clientId && l.fields.Statut === "Libre" && l.fields.Agence === "Agence 1"));
  const attendu = P.creneauxTheoriques(P.REGLAGES_DEFAUT, "2026-10-15", "2026-11-19").length;
  assert.equal(lignes.length, attendu);
  await P.creneauxLibres(ctx(), A, { agence: "Agence 1", periode: "matin" }); // relance
  assert.equal(lignesCreneaux().length, attendu);
});

test("capacite : N lignes libres identiques par creneau", async () => {
  await P.enregistrerReglages(ctx(), A, null, { capacite: 2 });
  const r = await P.creneauxLibres(ctx(), A, { agence: "Agence 1", periode: "apres_midi" });
  const parDate = {};
  r.creneaux.forEach((c) => { parDate[c.date] = (parDate[c.date] || 0) + 1; });
  assert.ok(Object.values(parDate).every((n) => n === 2));
  // une place prise : il en reste une sur ce creneau
  const prise = db.Planning.find((l) => l.id === r.creneaux[0].id);
  prise.fields.Statut = "Pris";
  const r2 = await P.creneauxLibres(ctx(), A, { agence: "Agence 1", periode: "apres_midi" });
  assert.equal(r2.creneaux.filter((c) => c.date === r.creneaux[0].date).length, 1);
  assert.equal(lignesCreneaux().filter((l) => l.fields.Date === r.creneaux[0].date && l.fields["Créneau"].startsWith("Apr")).length, 2); // pas de regeneration d'une place prise
});

test("isolation : deux clients avec la meme 'Agence 1' (et un nom sous-chaine de l'autre)", async () => {
  const ra = await P.creneauxLibres(ctx(), A, { agence: "Agence 1" });
  const rb = await P.creneauxLibres(ctx(), B, { agence: "Agence 1" });
  assert.ok(ra.creneaux.length > 0 && rb.creneaux.length > 0);
  const idsB = new Set(db.Planning.filter((l) => (l.fields["Compte client"] || [])[0] === B.clientId).map((l) => l.id));
  ra.creneaux.forEach((c) => assert.equal(idsB.has(c.id), false, "creneau de B renvoye a A"));
  const idsA = new Set(db.Planning.filter((l) => (l.fields["Compte client"] || [])[0] === A.clientId).map((l) => l.id));
  rb.creneaux.forEach((c) => assert.equal(idsA.has(c.id), false, "creneau de A renvoye a B"));
});

test("delai minimum reglable par client", async () => {
  await P.enregistrerReglages(ctx(), A, null, { delaiMinJours: 14 });
  const r = await P.creneauxLibres(ctx(), A, { agence: "Agence 1" });
  assert.ok(r.creneaux.every((c) => c.date >= "2026-10-22"));
  await P.enregistrerReglages(ctx(), A, null, { delaiMinJours: 0 });
  const r0 = await P.creneauxLibres(ctx(), A, { agence: "Agence 1" });
  assert.ok(r0.creneaux.some((c) => c.date === "2026-10-08"));
});

test("reglages d'agence : remplacent ceux du client ; fermeture ajoutee apres coup jamais proposee", async () => {
  await P.enregistrerReglages(ctx(), A, null, { capacite: 1 });
  await P.enregistrerReglages(ctx(), A, "Agence 2", { capacite: 3, joursTravailles: [1, 2, 3] });
  await P.creneauxLibres(ctx(), A, { agence: "Agence 2", periode: "matin" }); // 1er passage : tranche de 80 lignes maximum
  const r2 = await P.creneauxLibres(ctx(), A, { agence: "Agence 2", periode: "matin" }); // 2e passage : complete
  assert.ok(r2.creneaux.every((c) => [1, 2, 3].includes(P.jourSemaine(c.date))));
  const n = {};
  r2.creneaux.forEach((c) => { n[c.date] = (n[c.date] || 0) + 1; });
  assert.ok(Object.values(n).every((v) => v === 3));
  const r1 = await P.creneauxLibres(ctx(), A, { agence: "Agence 1", periode: "matin" });
  assert.ok(r1.creneaux.some((c) => P.jourSemaine(c.date) === 5)); // vendredi travaille chez Agence 1
  const n1 = {};
  r1.creneaux.forEach((c) => { n1[c.date] = (n1[c.date] || 0) + 1; });
  assert.ok(Object.values(n1).every((v) => v === 1));
  // fermeture ajoutee APRES generation : les lignes existent mais ne sont plus proposees
  const date = r1.creneaux[0].date;
  await P.enregistrerReglages(ctx(), A, null, { fermetures: [{ du: date, au: date, motif: "Conges" }] });
  const apres = await P.creneauxLibres(ctx(), A, { agence: "Agence 1", periode: "matin" });
  assert.equal(apres.creneaux.some((c) => c.date === date), false);
  assert.ok(db.Planning.some((l) => l.fields.Date === date && l.fields.Agence === "Agence 1")); // la ligne n'est pas supprimee
});

test("renouvellement : creneaux LIBRES passes du client supprimes, jamais Pris/Bloques, jamais les autres clients ni la demo", async () => {
  const ligne = (date, statut, clients, agence = "Agence 1") => db.Planning.push({ id: "recP" + String(db.Planning.length + 1).padStart(11, "0"), fields: { Date: date, "Créneau": "Matin (8h30 — 12h00)", Agence: agence, Statut: statut, ...(clients ? { "Compte client": [clients] } : {}) } });
  ligne("2026-09-01", "Libre", A.clientId);
  ligne("2026-09-01", "Pris", A.clientId);
  ligne("2026-09-02", "Bloqué - Congé", A.clientId);
  ligne("2026-09-01", "Libre", B.clientId);
  ligne("2026-08-17", "Libre", null); // demo
  await P.creneauxLibres(ctx(), A, { agence: "Agence 1" });
  const reste = (statut, c) => db.Planning.filter((l) => l.fields.Statut === statut && l.fields.Date < "2026-10-01" && (l.fields["Compte client"] || [])[0] === c).length;
  assert.equal(reste("Libre", A.clientId), 0);
  assert.equal(reste("Pris", A.clientId), 1);
  assert.equal(reste("Bloqué - Congé", A.clientId), 1);
  assert.equal(reste("Libre", B.clientId), 1);
  assert.equal(db.Planning.filter((l) => l.fields.Date === "2026-08-17").length, 1);
});

test("demo (sans client) : reglages propres, lignes sans Compte client, les 360 existantes ne sont ni modifiees ni supprimees", async () => {
  const existantes = [];
  for (const [i, d] of ["2026-08-17", "2026-10-15", "2026-10-16", "2026-10-19"].entries()) {
    existantes.push({ id: "recD" + String(i).padStart(11, "0"), fields: { Date: d, "Créneau": "Matin (8h30 — 12h00)", Agence: "Agence 1", Statut: i === 1 ? "Pris" : "Libre" } });
  }
  db.Planning.push(...existantes);
  const avant = JSON.stringify(existantes);
  await P.creneauxLibres(ctx(), { demo: true }, { agence: "Agence 1", periode: "matin" });
  await P.creneauxLibres(ctx(), A, { agence: "Agence 1", periode: "matin" });
  assert.equal(JSON.stringify(existantes.map((e) => db.Planning.find((l) => l.id === e.id))), avant); // y compris la ligne libre passee
  const demo = db.Planning.filter((l) => !(l.fields["Compte client"] || []).length && l.fields.Date !== P.CLE_CONFIG);
  const parCle = {};
  demo.forEach((l) => { const k = l.fields.Date + l.fields["Créneau"] + l.fields.Agence; parCle[k] = (parCle[k] || 0) + 1; });
  assert.ok(Object.values(parCle).every((n) => n === 1), "capacite 1 : un creneau demo existant n'est pas duplique");
  const r = await P.creneauxLibres(ctx(), { demo: true }, { agence: "Agence 1", periode: "matin" });
  const idsClient = new Set(db.Planning.filter((l) => (l.fields["Compte client"] || []).length).map((l) => l.id));
  r.creneaux.forEach((c) => assert.equal(idsClient.has(c.id), false, "un creneau client dans la demo"));
});

test("interruption pendant la generation : reprise complete sans doublon", async () => {
  panne = 2; // la 2e creation de lot echoue
  await P.creneauxLibres(ctx(), A, { agence: "Agence 1" });
  const partiel = lignesCreneaux().length;
  assert.equal(partiel, 10);
  panne = false;
  await P.creneauxLibres(ctx(), A, { agence: "Agence 1" });
  const attendu = P.creneauxTheoriques(P.REGLAGES_DEFAUT, "2026-10-15", "2026-11-19").length;
  assert.equal(lignesCreneaux().length, attendu);
  const cles = lignesCreneaux().map((l) => l.fields.Date + l.fields["Créneau"]);
  assert.equal(new Set(cles).size, cles.length);
});

test("tranches courtes : maxCreations borne chaque passage, les passages suivants completent", async () => {
  const reglages = await P.reglagesPour(ctx(), A, "Agence 1");
  let passages = 0, partiel = true;
  while (partiel && passages < 20) {
    const g = await P.assurerCreneaux(ctx(), A, "Agence 1", reglages, "2026-10-15", "2026-11-19", { maxCreations: 20 });
    assert.ok(g.crees <= 30);
    partiel = g.partiel;
    passages++;
  }
  assert.ok(passages > 1);
  assert.equal(lignesCreneaux().length, P.creneauxTheoriques(reglages, "2026-10-15", "2026-11-19").length);
});

test("reglages : enregistrement idempotent (une ligne par portee), lignes CONFIG jamais proposees comme creneaux", async () => {
  assert.equal((await P.enregistrerReglages(ctx(), A, null, { capacite: 2 })).ok, true);
  assert.equal((await P.enregistrerReglages(ctx(), A, null, { capacite: 3 })).ok, true);
  assert.equal((await P.enregistrerReglages(ctx(), A, "Agence 2", { capacite: 4 })).ok, true);
  assert.equal((await P.enregistrerReglages(ctx(), A, null, { capacite: 99 })).ok, false);
  const cfg = db.Planning.filter((l) => l.fields.Date === P.CLE_CONFIG);
  assert.equal(cfg.length, 2);
  assert.ok(cfg.every((l) => l.fields["Compte client"][0] === A.clientId && !l.fields.Statut && !l.fields["Créneau"]));
  const bruts = await P.lireReglagesBruts(ctx(), A);
  assert.equal(bruts.client.capacite, 3);
  assert.equal(bruts.agences["Agence 2"].capacite, 4);
  const r = await P.creneauxLibres(ctx(), A, { agence: "Agence 1" });
  r.creneaux.forEach((c) => assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/));
});

// ---------- route serveur /api/airtable/creneaux ----------

let ip = 0;
function appel(handler, req) {
  const r = { method: "GET", headers: { origin: "https://iko-suite-demo.vercel.app" }, query: {}, body: {}, socket: { remoteAddress: "10.1." + (ip >> 8) + "." + (ip++ & 255) }, ...req };
  r.headers = { origin: "https://iko-suite-demo.vercel.app", ...(req && req.headers) };
  return new Promise((resolve) => {
    const res = { code: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b, h: this.h }); return this; } };
    handler(r, res);
  });
}
const route = (query, headers) => appel(proxy, { query: { path: "creneaux", ...query }, headers });
const session = (payload) => "iko_access=" + jwt.sign(payload, process.env.JWT_ACCESS_SECRET);

test("route creneaux : par slug, agence obligatoire, client inconnu, client bloque, origine", async () => {
  const ok = await route({ client: "roussel", agence: "Agence 1", periode: "matin" });
  assert.equal(ok.code, 200);
  assert.equal(ok.h["Cache-Control"], "no-store");
  assert.ok(ok.corps.creneaux.length > 0);
  const idsA = new Set(db.Planning.filter((l) => (l.fields["Compte client"] || [])[0] === A.clientId).map((l) => l.id));
  ok.corps.creneaux.forEach((c) => assert.ok(idsA.has(c.id)));
  assert.equal((await route({ client: "roussel" })).code, 400);
  assert.equal((await route({ client: "inconnu", agence: "Agence 1" })).code, 404);
  const bloque = await route({ client: "bloque", agence: "Agence 1" });
  assert.deepEqual(bloque.corps, { creneaux: [], bloque: true });
  assert.equal((await route({ client: "roussel", agence: "Agence 1" }, { origin: "https://evil.example" })).code, 403);
  assert.equal((await appel(proxy, { method: "POST", query: { path: "creneaux", agence: "Agence 1" } })).code, 405);
});

test("route creneaux : sans client = demo (Agence 1 a 4 seulement) ; une session impose SON client", async () => {
  const demo = await route({ agence: "Agence 3" });
  assert.equal(demo.code, 200);
  assert.ok(demo.corps.creneaux.length > 0);
  assert.equal(db.Planning.filter((l) => (l.fields["Compte client"] || []).length).length, 0); // aucune ligne client creee
  assert.deepEqual((await route({ agence: "Agence 9" })).corps, { creneaux: [] });
  // un admin du client B qui demande le client A obtient ... le client B
  const sB = session({ userId: "recU", tenantId: B.clientId, role: "TENANT_ADMIN" });
  const r = await route({ client: "roussel", agence: "Agence 1" }, { cookie: sB });
  const idsB = new Set(db.Planning.filter((l) => (l.fields["Compte client"] || [])[0] === B.clientId).map((l) => l.id));
  assert.ok(r.corps.creneaux.length > 0);
  r.corps.creneaux.forEach((c) => assert.ok(idsB.has(c.id)));
  // sans session, le mode admin (sans delai minimum) est ignore
  const pub = await route({ client: "roussel", agence: "Agence 1", admin: "1", date: "2026-10-09" });
  const minimum = P.ajouterJours(P.aujourdhuiParis(), 7);
  assert.ok(pub.corps.creneaux.every((c) => c.date >= minimum), "admin=1 sans session doit etre ignore");
});

// ---------- actions admin (reglages) ----------

const admin = { userId: "recADM", tenantId: null, role: "SUPER_ADMIN_IKO" };
const actionVerif = (corps, payload = admin) => appel(verif, { method: "POST", body: corps, headers: { cookie: session(payload) } });

test("actions admin : lire / enregistrer les reglages (super admin seulement)", async () => {
  const refus = await actionVerif({ action: "enregistrer_reglages_planning", clientId: A.clientId, reglages: { capacite: 2 } }, { ...admin, role: "TENANT_ADMIN", tenantId: A.clientId });
  assert.equal(refus.code, 403);
  const ok = await actionVerif({ action: "enregistrer_reglages_planning", clientId: A.clientId, reglages: { capacite: 2, joursTravailles: [1, 2, 3, 4] } });
  assert.equal(ok.code, 200);
  const lu = await actionVerif({ action: "lire_reglages_planning", clientId: A.clientId });
  assert.equal(lu.corps.client.capacite, 2);
  assert.deepEqual(lu.corps.client.joursTravailles, [1, 2, 3, 4]);
  assert.equal(lu.corps.defaut.capacite, 1);
  const agence = await actionVerif({ action: "enregistrer_reglages_planning", clientId: A.clientId, agence: "Agence 2", reglages: { capacite: 5 } });
  assert.equal(agence.code, 200);
  assert.equal((await actionVerif({ action: "enregistrer_reglages_planning", clientId: A.clientId, reglages: { capacite: 0 } })).code, 400);
  assert.equal((await actionVerif({ action: "enregistrer_reglages_planning", clientId: "pas-un-id", reglages: {} })).code, 400);
  assert.equal(db.Planning.filter((l) => l.fields.Date === P.CLE_CONFIG).length, 2);
});
