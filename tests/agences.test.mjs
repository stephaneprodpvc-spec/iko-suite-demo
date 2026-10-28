// Tests : isolation PAR AGENCE (airtable-proxy + comptes « Mes acces » du patron). Aucun appel reseau (faux Airtable en memoire).
// Lancer : node --test tests/agences.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { creerFaux } from "./fake-airtable.mjs";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.AIRTABLE_BASE_ID = "appTEST00000000A";
process.env.IKO_DEMO_OUVERT = "0";
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const { default: proxy } = await import("../api/airtable-proxy.js");
const { default: securite } = await import("../api/verif-securite.js");

const A = "recCLIENTA0000001", B = "recCLIENTB0000002";
const AG = { a1: "recAGENCEA1000001", a2: "recAGENCEA2000002", b1: "recAGENCEB1000003" };
const T = { t1: "recTICKET10000001", t2: "recTICKET20000002", t3: "recTICKET30000003" };
const MDP_PATRON = "Phrase-Patron-Test-2026";
let db, compteur = 0;

function reinitialiser() {
  db = {
    Clients: [{ id: A, fields: { "Nom client": "Entreprise A", Slug: "a", "Modules actifs": ["Dashboard", "Technicien", "SAV"] } }, { id: B, fields: { "Nom client": "Entreprise B", Slug: "b" } }],
    Agences: [{ id: AG.a1, fields: { "Nom agence": "Agence 1", Client: [A] } }, { id: AG.a2, fields: { "Nom agence": "Agence 2", Client: [A] } }, { id: AG.b1, fields: { "Nom agence": "Agence 1", Client: [B] } }],
    "Tickets SAV": [
      { id: T.t1, fields: { Name: "SAV-1", Agence: "Agence 1", "Compte client": [A], Statut: "Nouveau" } },
      { id: T.t2, fields: { Name: "SAV-2", Agence: "Agence 2", "Compte client": [A], Statut: "Nouveau" } },
      { id: T.t3, fields: { Name: "SAV-3", Agence: "Agence 1", "Compte client": [B], Statut: "Nouveau" } },
    ],
    Planning: [
      { id: "recPLAN100000001", fields: { Date: "2026-11-02", Agence: "Agence 1", "Compte client": [A], Statut: "Libre" } },
      { id: "recPLAN200000002", fields: { Date: "2026-11-02", Agence: "Agence 2", "Compte client": [A], Statut: "Libre" } },
      { id: "recPLAN300000003", fields: { Date: "CONFIG", "Compte client": [A] } },
    ],
    Techniciens: [
      { id: "recTECH100000001", fields: { Nom: "Marc", Agence: "Agence 1", "Compte client": [A] } },
      { id: "recTECH200000002", fields: { Nom: "Paul", Agence: "Agence 2", "Compte client": [A] } },
    ],
    Devis: [
      { id: "recDEVIS10000001", fields: { "N° devis": "D1", Agence: [AG.a1], Client: [A], "Client Record ID": [A] } },
      { id: "recDEVIS20000002", fields: { "N° devis": "D2", Agence: [AG.a2], Client: [A], "Client Record ID": [A] } },
    ],
    "Interventions SAV": [
      { id: "recINTER10000001", fields: { Name: "I1", "Ticket SAV": [T.t1], "Compte client": [A] } },
      { id: "recINTER20000002", fields: { Name: "I2", "Ticket SAV": [T.t2], "Compte client": [A] } },
    ],
    "Contrats entretien": [], "Catalogue Produits": [{ id: "recCATA100000001", fields: { "Désignation": "Fenêtre", Client: [A] } }],
    Utilisateurs: [], "Journal actions": [], "Planning Commercial": [], "RDV Commercial": [], "Métrés": [],
  };
  globalThis.fetch = creerFaux(db);
  db.Utilisateurs.push({ id: "recPATRON0000001A", fields: { Identifiant: "patron@a.fr", "Hash mot de passe": bcrypt.hashSync(MDP_PATRON, 4), tenantId: [A], "Rôle": "TENANT_ADMIN", Statut: "Actif" } });
  db.Utilisateurs.push({ id: "recAUTRECLIENT001", fields: { Identifiant: "chef@b.fr", "Hash mot de passe": bcrypt.hashSync("Phrase-Autre-Test-9", 4), tenantId: [B], "Rôle": "TENANT_ADMIN", Statut: "Actif" } });
}
beforeEach(reinitialiser);

const cookieDe = (s) => "iko_access=" + jwt.sign(s, process.env.JWT_ACCESS_SECRET);
const SUPER = { userId: "recSUPER000000001", role: "SUPER_ADMIN_IKO" };
const PATRON = { userId: "recPATRON0000001A", tenantId: A, role: "TENANT_ADMIN" };
const AGENCE1 = { userId: "recRESP1000000001", tenantId: A, role: "TENANT_ADMIN", agence: "Agence 1" };
const TECH1 = { userId: "recTECHN1000000001", tenantId: A, role: "TECHNICIEN", agence: "Agence 1" };

function http(handler, { methode = "GET", chemin, query = {}, corps, session }) {
  const req = { method: methode, query: chemin ? { path: chemin, ...query } : query, body: corps, headers: { origin: "http://localhost:3000", cookie: session ? cookieDe(session) : "" }, socket: { remoteAddress: "10.2." + (compteur >> 8) + "." + (compteur++ & 255) } };
  return new Promise((resolve) => {
    const res = { code: 200, entetes: {}, setHeader(k, v) { this.entetes[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b, entetes: this.entetes }); return this; }, end() { resolve({ code: this.code }); return this; } };
    handler(req, res).catch((e) => resolve({ code: 500, corps: String(e && e.stack || e) }));
  });
}
const lire = (chemin, session, query = {}) => http(proxy, { chemin, session, query });
const noms = (r, champ = "Name") => (r.corps.records || []).map((x) => x.fields[champ]).sort();

test("le patron voit toutes les agences de SON client, jamais un autre client", async () => {
  const r = await lire("tenant/Tickets SAV", PATRON);
  assert.equal(r.code, 200, JSON.stringify(r.corps));
  assert.deepEqual(noms(r), ["SAV-1", "SAV-2"]);
});

test("une agence ne voit que ses tickets, ses techniciens, son planning, ses devis et ses interventions", async () => {
  assert.deepEqual(noms(await lire("tenant/Tickets SAV", AGENCE1)), ["SAV-1"]);
  assert.deepEqual(noms(await lire("Techniciens", AGENCE1), "Nom"), ["Marc"]);
  const plan = await lire("Planning", AGENCE1);
  assert.deepEqual(plan.corps.records.map((x) => x.fields.Agence || "(config)").sort(), ["(config)", "Agence 1"]);
  assert.deepEqual(noms(await lire("Devis", AGENCE1), "N° devis"), ["D1"]);
  assert.deepEqual(noms(await lire("tenant/Interventions SAV", AGENCE1)), ["I1"]);
  assert.deepEqual(noms(await lire("tenant/Tickets SAV", TECH1)), ["SAV-1"]);
  // Un filtre du navigateur ne peut pas elargir : il s'ajoute, il ne remplace pas.
  const malin = await lire("tenant/Tickets SAV", AGENCE1, { filterByFormula: '{Agence}="Agence 2"' });
  assert.equal((malin.corps.records || []).length, 0);
  const encoreMalin = await lire("tenant/Tickets SAV", AGENCE1, { filterByFormula: 'OR({Agence}="Agence 2", {Agence}="Agence 1")' });
  assert.deepEqual(noms(encoreMalin), ["SAV-1"]);
});

test("une agence ne peut ni lire, ni modifier, ni supprimer une donnee d'une autre agence", async () => {
  assert.equal((await lire("tenant/Tickets SAV/" + T.t1, AGENCE1)).code, 200);
  assert.equal((await lire("tenant/Tickets SAV/" + T.t2, AGENCE1)).code, 403);
  assert.equal((await lire("Techniciens/recTECH200000002", AGENCE1)).code, 403);
  assert.equal((await lire("Devis/recDEVIS20000002", AGENCE1)).code, 403);
  assert.equal((await lire("tenant/Interventions SAV/recINTER20000002", AGENCE1)).code, 403);
  assert.equal((await http(proxy, { methode: "PATCH", chemin: "tenant/Tickets SAV/" + T.t2, corps: { fields: { Statut: "Terminé" } }, session: AGENCE1 })).code, 403);
  assert.equal(db["Tickets SAV"].find((t) => t.id === T.t2).fields.Statut, "Nouveau");
  assert.equal((await http(proxy, { methode: "DELETE", chemin: "tenant/Tickets SAV/" + T.t2, session: AGENCE1 })).code, 403);
  assert.equal((await http(proxy, { methode: "PATCH", chemin: "tenant/Tickets SAV/" + T.t1, corps: { fields: { Statut: "En cours" } }, session: AGENCE1 })).code, 200);
  // Deplacer son propre ticket vers une autre agence : refuse.
  assert.equal((await http(proxy, { methode: "PATCH", chemin: "tenant/Tickets SAV/" + T.t1, corps: { fields: { Agence: "Agence 2" } }, session: AGENCE1 })).code, 403);
  assert.equal(db["Tickets SAV"].find((t) => t.id === T.t1).fields.Agence, "Agence 1");
});

test("a la creation, l'agence est imposee par le serveur", async () => {
  const r = await http(proxy, { methode: "POST", chemin: "Techniciens", corps: { fields: { Nom: "Luc", Agence: "Agence 2", "Compte client": [A] } }, session: AGENCE1 });
  assert.equal(r.code, 200, JSON.stringify(r.corps));
  assert.equal(db.Techniciens.find((t) => t.fields.Nom === "Luc").fields.Agence, "Agence 1");
  const i = await http(proxy, { methode: "POST", chemin: "tenant/Interventions SAV", corps: { fields: { Name: "X", "Ticket SAV": [T.t2] } }, session: AGENCE1 });
  assert.equal(i.code, 403);
});

test("ressources hors perimetre : table par identifiant, reglages, comptes", async () => {
  assert.equal((await lire("tblXXXXXXXXXXXXXX", AGENCE1)).code, 403);
  assert.equal((await lire("Utilisateurs", AGENCE1)).code, 403);
  assert.equal((await lire("Journal actions", AGENCE1)).code, 403);
  assert.equal((await http(proxy, { methode: "PATCH", chemin: "Catalogue Produits/recCATA100000001", corps: { fields: { "Désignation": "Piraté" } }, session: AGENCE1 })).code, 403);
  assert.equal((await lire("Catalogue Produits", AGENCE1)).code, 200);
  assert.equal((await http(proxy, { methode: "POST", chemin: "Agences", corps: { fields: { "Nom agence": "Agence 9" } }, session: AGENCE1 })).code, 403);
});

test("le super administrateur n'est pas limite", async () => {
  assert.equal((await lire("Tickets SAV/" + T.t3, SUPER)).code, 200);
  assert.equal((await lire("Techniciens", SUPER)).code, 200);
});

// ---------- comptes : jeton, session, « Mes acces » ----------
const secu = (corps, session, extra = {}) => http(securite, { methode: "POST", corps, session, ...extra });

test("un compte rattache a une agence porte l'agence dans sa session", async () => {
  db.Utilisateurs.push({ id: "recRESP2000000001", fields: { Identifiant: "resp@a.fr", "Hash mot de passe": bcrypt.hashSync("Phrase-Resp-Test-2026", 4), tenantId: [A], "Rôle": "TENANT_ADMIN", Agence: "Agence 2", Statut: "Actif" } });
  const l = await secu({ action: "login", identifiant: "resp@a.fr", motDePasse: "Phrase-Resp-Test-2026" }, null);
  assert.equal(l.code, 200);
  const jeton = decodeURIComponent(/iko_access=([^;]+)/.exec(String(l.entetes["Set-Cookie"]))[1]);
  assert.equal(jwt.verify(jeton, process.env.JWT_ACCESS_SECRET).agence, "Agence 2");
  const patron = await secu({ action: "login", identifiant: "patron@a.fr", motDePasse: MDP_PATRON }, null);
  const jp = decodeURIComponent(/iko_access=([^;]+)/.exec(String(patron.entetes["Set-Cookie"]))[1]);
  assert.equal(jwt.verify(jp, process.env.JWT_ACCESS_SECRET).agence, undefined, "le patron n'a pas d'agence");
  // « Toutes » = pas de restriction
  db.Utilisateurs.find((u) => u.id === "recRESP2000000001").fields.Agence = "Toutes";
  const l2 = await secu({ action: "login", identifiant: "resp@a.fr", motDePasse: "Phrase-Resp-Test-2026" }, null);
  assert.equal(jwt.verify(decodeURIComponent(/iko_access=([^;]+)/.exec(String(l2.entetes["Set-Cookie"]))[1]), process.env.JWT_ACCESS_SECRET).agence, undefined);
});

test("Mes acces : le patron cree l'equipe de SON entreprise (mots de passe temporaires)", async () => {
  const r = await secu({ action: "creer_comptes_equipe", comptes: [
    { identifiant: "tech1@a.fr", role: "TECHNICIEN", agence: "Agence 1", nom: "Marc" },
    { identifiant: "resp2@a.fr", role: "TENANT_ADMIN", agence: "agence 2", nom: "Resp 2" },
  ] }, PATRON);
  assert.equal(r.code, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.crees.length, 2);
  assert.ok(r.corps.crees.every((c) => /^Tmp-/.test(c.motDePasseTemporaire)));
  const u = db.Utilisateurs.find((x) => x.fields.Identifiant === "resp2@a.fr");
  assert.equal(u.fields.tenantId[0], A, "rattache au client de la SESSION");
  assert.equal(u.fields.Agence, "Agence 2", "nom de l'agence normalise");
  assert.ok(!JSON.stringify(db.Utilisateurs).includes(r.corps.crees[0].motDePasseTemporaire), "le mot de passe n'est stocke que haché");
});

test("Mes acces : refus (autre client, autre agence, role non autorise, compte d'agence, super admin sans entreprise)", async () => {
  const demande = (c, s = PATRON) => secu({ action: "creer_comptes_equipe", comptes: [c] }, s);
  assert.match((await demande({ identifiant: "x@a.fr", role: "TECHNICIEN", agence: "Agence 9" })).corps.ignores[0].raison, /n'existe pas/);
  assert.match((await demande({ identifiant: "y@a.fr", role: "SUPER_ADMIN_IKO", agence: "Agence 1" })).corps.ignores[0].raison, /non autorisé/);
  assert.match((await demande({ identifiant: "z@a.fr", role: "COMMERCIAL", agence: "Agence 1" })).corps.ignores[0].raison, /non autorisé/);
  assert.equal((await demande({ identifiant: "w@a.fr", role: "TECHNICIEN", agence: "Agence 1" }, AGENCE1)).code, 403);
  assert.equal((await demande({ identifiant: "w@a.fr", role: "TECHNICIEN", agence: "Agence 1" }, TECH1)).code, 403);
  assert.equal((await demande({ identifiant: "w@a.fr", role: "TECHNICIEN", agence: "Agence 1" }, null)).code, 403);
  // Le client est TOUJOURS celui de la session : un clientId envoye est ignore.
  const r = await secu({ action: "creer_comptes_equipe", clientId: B, comptes: [{ identifiant: "v@a.fr", role: "TECHNICIEN", agence: "Agence 1" }] }, PATRON);
  assert.equal(db.Utilisateurs.find((x) => x.fields.Identifiant === "v@a.fr").fields.tenantId[0], A);
  assert.equal(r.code, 200);
});

test("Mes acces : liste, nouveau mot de passe et coupure d'acces limites a l'equipe du patron", async () => {
  await secu({ action: "creer_comptes_equipe", comptes: [{ identifiant: "tech1@a.fr", role: "TECHNICIEN", agence: "Agence 1" }] }, PATRON);
  const liste = await secu({ action: "lister_equipe" }, PATRON);
  assert.equal(liste.code, 200);
  assert.deepEqual(liste.corps.equipe.map((e) => e.identifiant).sort(), ["patron@a.fr", "tech1@a.fr"], "pas les comptes d'un autre client");
  assert.ok(!JSON.stringify(liste.corps).includes("Hash"), "aucun secret dans la liste");
  assert.equal((await secu({ action: "lister_equipe" }, AGENCE1)).code, 403);

  // nouveau mot de passe : exige le mot de passe du patron
  assert.equal((await secu({ action: "regenerer_mot_de_passe", identifiant: "tech1@a.fr", motDePasseAdmin: "faux" }, PATRON)).code, 403);
  const ok = await secu({ action: "regenerer_mot_de_passe", identifiant: "tech1@a.fr", motDePasseAdmin: MDP_PATRON }, PATRON);
  assert.equal(ok.code, 200); assert.match(ok.corps.motDePasseTemporaire, /^Tmp-/);
  // un compte d'un AUTRE client, ou le patron lui-meme : refuse
  assert.equal((await secu({ action: "regenerer_mot_de_passe", identifiant: "chef@b.fr", motDePasseAdmin: MDP_PATRON }, PATRON)).code, 404);
  assert.equal((await secu({ action: "regenerer_mot_de_passe", identifiant: "patron@a.fr", motDePasseAdmin: MDP_PATRON }, PATRON)).code, 404);
  assert.equal((await secu({ action: "regenerer_mot_de_passe", identifiant: "tech1@a.fr", motDePasseAdmin: MDP_PATRON }, AGENCE1)).code, 403);

  // couper / rouvrir l'acces
  assert.equal((await secu({ action: "statut_compte", identifiant: "tech1@a.fr", actif: false }, PATRON)).code, 200);
  assert.equal(db.Utilisateurs.find((x) => x.fields.Identifiant === "tech1@a.fr").fields.Statut, "Bloqué");
  assert.equal((await secu({ action: "login", identifiant: "tech1@a.fr", motDePasse: ok.corps.motDePasseTemporaire }, null)).code, 401, "un compte coupé ne se connecte plus");
  assert.equal((await secu({ action: "statut_compte", identifiant: "chef@b.fr", actif: false }, PATRON)).code, 404);
  assert.equal(db.Utilisateurs.find((x) => x.fields.Identifiant === "chef@b.fr").fields.Statut, "Actif");
});
