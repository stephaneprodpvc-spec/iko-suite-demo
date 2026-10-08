// Tests de "Creer son IKO" et de la politique de mot de passe (api/verif-securite.js).
// Lancer : npm install && node --test
// AUCUN appel reseau reel : fetch est remplace par un faux Airtable en memoire.
// Aucun secret reel : les secrets JWT ci-dessous sont des valeurs de test.

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.AIRTABLE_TOKEN = "test-token";

const { default: handler } = await import("../api/verif-securite.js");

// ---------- faux Airtable en memoire ----------
let db;
let echecPostUtilisateurs;
let journal; // tout ce qui passe par console.* (pour verifier l'absence de mot de passe)
let compteurIp = 0;

const CLIENT_OK = "recCLIENT0000001A";
const AUTRE_CLIENT = "recCLIENT0000002B";

function reinitialiser() {
  echecPostUtilisateurs = false;
  journal = [];
  db = {
    Clients: [
      { id: CLIENT_OK, fields: { "Nom client": "Test Menuiserie", "Slug": "test-menuiserie", "Métier": "Menuiserie", "Modules actifs": ["Dashboard", "SAV"], "Nombre agences": 3, "Emails contact": "patron@test.fr\nsav@test.fr", "Couleur principale": "#0066CC", "Logo": [{ url: "https://exemple.fr/logo.png" }], "Statut client": "Actif" } },
      { id: AUTRE_CLIENT, fields: { "Nom client": "Autre Societe", "Slug": "autre", "Métier": "Menuiserie", "Modules actifs": ["SAV"], "Nombre agences": 1 } },
    ],
    Agences: [],
    Utilisateurs: [],
  };
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const parties = decodeURIComponent(u.pathname).split("/").filter(Boolean).slice(2); // apres /v0/<base>
    const table = parties[0];
    const id = parties[1];
    const methode = init.method || "GET";
    const filtre = u.searchParams.get("filterByFormula") || "";
    const reponse = (corps, ok = true, status = 200) => ({ ok, status, json: async () => corps, text: async () => JSON.stringify(corps) });
    if (!db[table]) return reponse({ error: "table inconnue" }, false, 404);

    if (methode === "GET" && id) {
      const rec = db[table].find((r) => r.id === id);
      return rec ? reponse(rec) : reponse({ error: "introuvable" }, false, 404);
    }
    if (methode === "GET") {
      let recs = db[table];
      if (table === "Clients") {
        const m = filtre.match(/LOWER\(\{Slug\}\)="([^"]*)"/);
        const ex = filtre.match(/RECORD_ID\(\)!="([^"]*)"/);
        recs = recs.filter((r) => String(r.fields["Slug"] || "").toLowerCase() === m[1] && (!ex || r.id !== ex[1]));
      } else if (table === "Agences") {
        const m = filtre.match(/FIND\("((?:[^"\\]|\\.)*)"/);
        const nom = m[1].replace(/\\"/g, '"');
        recs = recs.filter((r) => (r._clientNom || "") === nom);
      } else if (table === "Utilisateurs") {
        const m = filtre.match(/LOWER\(\{Identifiant\}\)="([^"]*)"/);
        recs = recs.filter((r) => String(r.fields["Identifiant"] || "").toLowerCase() === m[1]);
      }
      return reponse({ records: recs });
    }
    if (methode === "POST") {
      if (table === "Utilisateurs" && echecPostUtilisateurs) return reponse({ error: "panne" }, false, 500);
      const corps = JSON.parse(init.body);
      const crees = corps.records.map((r) => {
        const rec = { id: "rec" + String(++n).padStart(14, "0"), fields: r.fields };
        if (table === "Agences") rec._clientNom = db.Clients.find((c) => c.id === r.fields["Client"][0]).fields["Nom client"];
        db[table].push(rec);
        return rec;
      });
      return reponse({ records: crees });
    }
    if (methode === "PATCH") {
      const rec = db[table].find((r) => r.id === id);
      Object.assign(rec.fields, JSON.parse(init.body).fields);
      return reponse(rec);
    }
    return reponse({ error: "methode non geree" }, false, 400);
  };
}

// journal : capture console.* pour verifier qu'aucun mot de passe n'y apparait
for (const m of ["log", "error", "warn", "info"]) {
  const origine = console[m];
  console[m] = (...a) => { if (journal) journal.push(a.map(String).join(" ")); if (!process.env.TEST_VERBEUX) return; origine(...a); };
}

function appeler(corps, { role = "SUPER_ADMIN_IKO", extraSession = {}, cookie } = {}) {
  const jeton = jwt.sign(Object.assign({ userId: "recADMIN", tenantId: null, role }, extraSession), process.env.JWT_ACCESS_SECRET);
  const req = {
    method: "POST",
    headers: { cookie: cookie === undefined ? "iko_access=" + jeton : cookie },
    body: corps,
    query: {},
    socket: { remoteAddress: "10.0." + (compteurIp++ >> 8) + "." + (compteurIp & 255) }, // IP distincte : pas de limite de debit
  };
  return new Promise((resolve) => {
    const res = { code: 200, entetes: {}, setHeader(k, v) { this.entetes[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b, entetes: this.entetes }); return this; } };
    handler(req, res);
  });
}

const preparer = (extra = {}, opts) => appeler({ action: "preparer_iko", clientId: CLIENT_OK, ...extra }, opts);
const creer = (extra = {}, opts) => appeler({ action: "creer_iko", clientId: CLIENT_OK, ...extra }, opts);
const connexion = (identifiant, motDePasse) => appeler({ action: "login", identifiant, motDePasse }, { cookie: "" });

beforeEach(reinitialiser);
before(reinitialiser);

test("seul un super admin peut preparer ou creer", async () => {
  assert.equal((await preparer({}, { cookie: "" })).code, 403);
  assert.equal((await preparer({}, { role: "TENANT_ADMIN" })).code, 403);
  assert.equal((await creer({}, { role: "TECHNICIEN" })).code, 403);
  assert.equal((await preparer({}, { extraSession: { mdpAChanger: true } })).code, 403);
  assert.equal((await appeler({ action: "preparer_iko", clientId: "pas-un-id" })).code, 400);
});

test("controle : bloquants (nom, slug unique, nombre 1-10, module, metier)", async () => {
  db.Clients[0].fields = { "Nom client": "", "Slug": "autre", "Nombre agences": 11, "Modules actifs": [] };
  const r = await preparer();
  assert.equal(r.code, 200);
  assert.equal(r.corps.pret, false);
  const texte = r.corps.bloquants.join(" | ");
  for (const attendu of ["Nom du client", "déjà utilisé", "Nombre d'agences", "Aucun module", "Métier"]) assert.match(texte, new RegExp(attendu));
});

test("controle : le reste est un avertissement non bloquant", async () => {
  db.Clients[0].fields = { "Nom client": "Test Menuiserie", "Slug": "test-menuiserie", "Métier": "Menuiserie", "Modules actifs": ["SAV"], "Nombre agences": 2 };
  const r = await preparer();
  assert.equal(r.corps.pret, true);
  const w = r.corps.avertissements.join(" | ");
  assert.match(w, /logo/i);
  assert.match(w, /Couleur principale/);
  assert.match(w, /e-mail de contact/);
});

test("agences : crees jusqu'a Nombre agences, comparaison par nom, jamais de doublon", async () => {
  db.Agences.push({ id: "recAG1", _clientNom: "Test Menuiserie", fields: { "Client": [CLIENT_OK], "Nom agence": "agence 2", "Actif": true, "Email agence": "a@t.fr" } });
  const r = await preparer();
  assert.deepEqual(r.corps.agences.aCreer, ["Agence 1", "Agence 3"]); // « agence 2 » existe deja (casse ignoree)
  const c = await creer();
  assert.equal(c.code, 200);
  assert.equal(db.Agences.length, 3);
  assert.deepEqual(db.Agences.map((a) => a.fields["Nom agence"].toLowerCase()).sort(), ["agence 1", "agence 2", "agence 3"]);
  db.Agences.filter((a) => a.id !== "recAG1").forEach((a) => assert.equal(a.fields["Actif"], true));
});

test("agences d'un autre client ignorees (lien verifie par identifiant)", async () => {
  db.Agences.push({ id: "recAGX", _clientNom: "Test Menuiserie", fields: { "Client": [AUTRE_CLIENT], "Nom agence": "Agence 1" } });
  const r = await preparer();
  assert.equal(r.corps.agences.existantes.length, 0);
  assert.equal(r.corps.agences.aCreer.length, 3);
});

test("agences en trop : rien n'est supprime, simple avertissement", async () => {
  for (let i = 1; i <= 5; i++) db.Agences.push({ id: "recAG" + i, _clientNom: "Test Menuiserie", fields: { "Client": [CLIENT_OK], "Nom agence": "Site " + i } });
  const r = await preparer();
  assert.equal(r.corps.agences.aCreer.length, 0);
  assert.match(r.corps.avertissements.join(" "), /au-delà/);
  await creer();
  assert.equal(db.Agences.length, 5);
});

test("compte : identifiant par defaut = premier e-mail, mot de passe temporaire fort, hache, jamais journalise", async () => {
  const c = await creer();
  assert.equal(c.code, 200);
  assert.equal(c.entetes["Cache-Control"], "no-store");
  const mdp = c.corps.compte.motDePasseTemporaire;
  assert.match(mdp, /^Tmp-[A-HJ-NP-Za-km-np-z2-9]{16}$/);
  assert.equal(c.corps.compte.identifiant, "patron@test.fr");
  assert.equal(db.Utilisateurs.length, 1);
  const u = db.Utilisateurs[0].fields;
  assert.equal(u["Rôle"], "TENANT_ADMIN");
  assert.deepEqual(u["tenantId"], [CLIENT_OK]);
  assert.notEqual(u["Hash mot de passe"], mdp);
  assert.ok(await bcrypt.compare(mdp, u["Hash mot de passe"]));
  assert.equal(JSON.stringify(db).includes(mdp), false, "mot de passe en clair dans Airtable");
  assert.equal(journal.join("\n").includes(mdp), false, "mot de passe dans les journaux");
});

test("identifiant modifiable ; identifiant pris / manquant / invalide = avertissement, agences creees, compte ignore", async () => {
  const c = await creer({ identifiant: "directeur@test.fr" });
  assert.equal(c.corps.compte.identifiant, "directeur@test.fr");
  assert.equal(db.Utilisateurs.length, 1);

  reinitialiser();
  db.Utilisateurs.push({ id: "recU9", fields: { "Identifiant": "pris@autre.fr", "tenantId": [AUTRE_CLIENT], "Hash mot de passe": "x" } });
  const r = await preparer({ identifiant: "pris@autre.fr" });
  assert.equal(r.corps.compte.etat, "conflit");
  assert.equal(r.corps.pret, true); // non bloquant
  assert.match(r.corps.avertissements.join(" "), /déjà utilisé par un autre client/);
  const c2 = await creer({ identifiant: "pris@autre.fr" });
  assert.equal(c2.code, 200);
  assert.equal(c2.corps.compte.motDePasseTemporaire, null);
  assert.equal(db.Utilisateurs.length, 1); // seul le compte de l'autre client
  assert.equal(db.Agences.length, 3);       // les agences sont bien creees

  reinitialiser();
  db.Clients[0].fields["Emails contact"] = "";
  assert.equal((await preparer()).corps.compte.etat, "inconnu");
  assert.equal((await preparer({ identifiant: "pas-un-mail" })).corps.compte.etat, "invalide");
});

test("idempotence : relancer ne cree ni agence ni compte en double", async () => {
  await creer();
  const apres1 = { ag: db.Agences.length, us: db.Utilisateurs.length, hash: db.Utilisateurs[0].fields["Hash mot de passe"] };
  const c2 = await creer();
  assert.equal(c2.code, 200);
  assert.equal(c2.corps.compte.motDePasseTemporaire, null); // jamais re-affiche
  assert.equal(c2.corps.compte.cree, false);
  assert.equal(db.Agences.length, apres1.ag);
  assert.equal(db.Utilisateurs.length, apres1.us);
  assert.equal(db.Utilisateurs[0].fields["Hash mot de passe"], apres1.hash);
});

test("interruption : compte en panne -> agences deja creees, relance complete sans doublon", async () => {
  echecPostUtilisateurs = true;
  const c1 = await creer();
  assert.equal(c1.code, 502);
  assert.equal(c1.corps.etape, "compte");
  assert.equal(db.Agences.length, 3);
  assert.equal(db.Utilisateurs.length, 0);
  echecPostUtilisateurs = false;
  const c2 = await creer();
  assert.equal(c2.code, 200);
  assert.equal(db.Agences.length, 3);
  assert.equal(db.Utilisateurs.length, 1);
  assert.match(c2.corps.compte.motDePasseTemporaire, /^Tmp-/);
});

test("regeneration : nouveau temporaire, l'ancien ne fonctionne plus", async () => {
  const c1 = await creer();
  const ancien = c1.corps.compte.motDePasseTemporaire;
  const c2 = await creer({ regenererMotDePasse: true });
  const nouveau = c2.corps.compte.motDePasseTemporaire;
  assert.notEqual(nouveau, ancien);
  assert.equal(db.Utilisateurs.length, 1);
  const h = db.Utilisateurs[0].fields["Hash mot de passe"];
  assert.equal(await bcrypt.compare(ancien, h), false);
  assert.equal(await bcrypt.compare(nouveau, h), true);
});

test("changement force : le temporaire ouvre une session a changer ; le nouveau choisi ne peut pas avoir le prefixe", async () => {
  const c = await creer();
  const temporaire = c.corps.compte.motDePasseTemporaire;
  const l1 = await connexion("patron@test.fr", temporaire);
  assert.equal(l1.code, 200);
  assert.equal(l1.corps.mdpAChanger, true);

  // prefixe reserve refuse (casse ignoree) pour un mot de passe choisi
  for (const candidat of ["Tmp-MonNouveauMdp-2026", "tmp-monnouveaumdp-2026"]) {
    const r = await appeler({ action: "changer_mot_de_passe", identifiant: "patron@test.fr", motDePasse: temporaire, nouveauMotDePasse: candidat }, { cookie: "" });
    assert.equal(r.code, 400);
    assert.match(r.corps.erreur, /préfixe réservé/);
  }
  // un bon mot de passe est accepte
  const ok = await appeler({ action: "changer_mot_de_passe", identifiant: "patron@test.fr", motDePasse: temporaire, nouveauMotDePasse: "Cheval-Bleu-Lune-7x" }, { cookie: "" });
  assert.equal(ok.code, 200);
  // le temporaire est invalide des le changement ; le nouveau ne force plus rien
  assert.equal((await connexion("patron@test.fr", temporaire)).code, 401);
  const l2 = await connexion("patron@test.fr", "Cheval-Bleu-Lune-7x");
  assert.equal(l2.code, 200);
  assert.equal(l2.corps.mdpAChanger, undefined);
});

test("le prefixe reserve est refuse a la creation de compte et a la reinitialisation", async () => {
  const cu = await appeler({ action: "creer_utilisateur", identifiant: "x@y.fr", motDePasse: "Tmp-AbCdEfGhJkMnPqRs", tenantId: CLIENT_OK, role: "TENANT_ADMIN" });
  assert.equal(cu.code, 400);
  assert.match(cu.corps.erreur, /préfixe réservé/);
  db.Utilisateurs.push({ id: "recU1", fields: { "Identifiant": "x@y.fr", "Hash mot de passe": "h", "tenantId": [CLIENT_OK], "Statut": "Actif" } });
  const ri = await appeler({ action: "reinitialiser_mot_de_passe", identifiant: "x@y.fr", nouveauMotDePasse: "Tmp-AbCdEfGhJkMnPqRs" });
  assert.equal(ri.code, 400);
});

test("politique : 12 caracteres minimum et mots interdits", async () => {
  const essai = (mdp) => appeler({ action: "creer_utilisateur", identifiant: "n@t.fr", motDePasse: mdp, tenantId: CLIENT_OK, role: "TENANT_ADMIN" });
  assert.equal((await essai("123")).code, 400);
  assert.equal((await essai("password1234")).code, 400);
  assert.equal((await essai("Cheval-Bleu-Lune-7x")).code, 200);
});
