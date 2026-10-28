// Tests : creation de comptes en serie, nouveau mot de passe temporaire, connexion par empreinte / visage (WebAuthn).
// Lancer : node --test tests/comptes-cles.test.mjs   — AUCUN appel reseau (faux Airtable en memoire), secrets de test.
// Le « telephone » est simule : une vraie paire de cles ECDSA P-256 signe comme le ferait Face ID / Touch ID.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { creerFaux } from "./fake-airtable.mjs";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.IKO_DEMO_OUVERT = "0";
delete process.env.IKO_MDP_UNIQUE;
const { default: handler } = await import("../api/verif-securite.js");

const CLIENT = "recCLIENT0000001A";
const MDP_ADMIN = "Phrase-Admin-Test-2026";
let db, fauxBase, champsInconnus, compteurIp = 0, adminId;

function reinitialiser() {
  champsInconnus = [];
  db = {
    Clients: [{ id: CLIENT, fields: { "Nom client": "Test Menuiserie", "Slug": "test-menuiserie" } }],
    Utilisateurs: [],
    Agences: [], Planning: [],
  };
  fauxBase = creerFaux(db);
  globalThis.fetch = async (url, init = {}) => {
    // Simule Airtable qui refuse un champ inexistant (422) pour tester le repli.
    if (init.method === "POST" && champsInconnus.length && String(url).includes("/Utilisateurs")) {
      const corps = JSON.parse(init.body);
      if (corps.records.some((r) => champsInconnus.some((c) => c in r.fields))) {
        const rep = { error: { type: "UNKNOWN_FIELD_NAME" } };
        return { ok: false, status: 422, json: async () => rep, text: async () => JSON.stringify(rep), clone() { return this; } };
      }
    }
    return fauxBase(url, init);
  };
  adminId = "recADMIN00000001";
  db.Utilisateurs.push({ id: adminId, fields: { "Identifiant": "chef@test.fr", "Hash mot de passe": bcrypt.hashSync(MDP_ADMIN, 4), "Rôle": "SUPER_ADMIN_IKO", "Statut": "Actif" } });
}
beforeEach(reinitialiser);

function appeler(corps, { role = "SUPER_ADMIN_IKO", userId = adminId, cookie, host = "localhost:3000" } = {}) {
  const jeton = jwt.sign({ userId, tenantId: null, role }, process.env.JWT_ACCESS_SECRET);
  const req = { method: "POST", headers: { host, cookie: cookie === undefined ? "iko_access=" + jeton : cookie }, body: corps, query: {}, socket: { remoteAddress: "10.1." + (compteurIp >> 8) + "." + (compteurIp++ & 255) } };
  return new Promise((resolve) => {
    const res = { code: 200, entetes: {}, setHeader(k, v) { this.entetes[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b, entetes: this.entetes }); return this; } };
    handler(req, res);
  });
}
const sansSession = { cookie: "" };

// ---------- comptes en serie ----------
test("creation en serie : un compte par agence, mots de passe base+numero", async () => {
  const base = "Base-Longue-Stef-";
  const r = await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: [1, 2, 3].map((n) => ({ identifiant: "agence" + n + "@test.fr", nom: "Chef agence " + n, agence: "Agence " + n, role: "TENANT_ADMIN", motDePasse: base + n })) });
  assert.equal(r.code, 200);
  assert.equal(r.corps.crees.length, 3);
  assert.equal(r.corps.champsAgence, true);
  const u2 = db.Utilisateurs.find((u) => u.fields["Identifiant"] === "agence2@test.fr");
  assert.equal(u2.fields["Agence"], "Agence 2");
  assert.equal(u2.fields["tenantId"][0], CLIENT);
  assert.ok(bcrypt.compareSync(base + "2", u2.fields["Hash mot de passe"]), "le mot de passe est bien haché et vérifiable");
  assert.ok(!JSON.stringify(r.corps).includes(base), "le mot de passe saisi n'est pas renvoyé");
  const l = await appeler({ action: "login", identifiant: "agence3@test.fr", motDePasse: base + "3" }, sansSession);
  assert.equal(l.code, 200);
});

test("creation en serie : refus des mots de passe faibles, doublons, role invalide, trop de comptes, non-admin", async () => {
  const ok = { identifiant: "a@test.fr", role: "TECHNICIEN", motDePasse: "Base-Longue-Stef-1" };
  const r = await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: [ok, { ...ok, identifiant: "b@test.fr", motDePasse: "court" }, { ...ok, identifiant: "c@test.fr", motDePasse: "motdepasse-longtemps-1" }, { ...ok, identifiant: "A@test.fr" }, { ...ok, identifiant: "d@test.fr", role: "PIRATE" }] });
  assert.equal(r.code, 200);
  assert.deepEqual(r.corps.crees.map((c) => c.identifiant), ["a@test.fr"]);
  assert.equal(r.corps.ignores.length, 4);
  const encore = await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: [ok] });
  assert.match(encore.corps.ignores[0].raison, /existe déjà/);
  const trop = await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: Array.from({ length: 9 }, (_, i) => ({ ...ok, identifiant: "x" + i + "@t.fr" })) });
  assert.equal(trop.code, 400);
  assert.equal((await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: [ok] }, { role: "TENANT_ADMIN" })).code, 403);
  assert.equal((await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: [ok] }, sansSession)).code, 403);
  assert.equal((await appeler({ action: "creer_comptes", clientId: "recINEXISTANT0000", comptes: [ok] })).code, 400);
});

test("creation en serie : repli si les champs Agence/Nom n'existent pas encore dans Airtable", async () => {
  champsInconnus = ["Agence", "Nom"];
  const r = await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: [{ identifiant: "z@test.fr", agence: "Agence 1", nom: "Z", role: "TENANT_ADMIN", motDePasse: "Base-Longue-Stef-9" }] });
  assert.equal(r.code, 200);
  assert.equal(r.corps.champsAgence, false);
  assert.equal(r.corps.crees.length, 1);
  assert.equal(db.Utilisateurs.find((u) => u.fields["Identifiant"] === "z@test.fr").fields["Agence"], undefined);
});

test("creation aleatoire : mot de passe temporaire renvoye une fois, changement impose a la connexion", async () => {
  const r = await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: [{ identifiant: "t@test.fr", role: "TECHNICIEN", aleatoire: true }] });
  const mdp = r.corps.crees[0].motDePasseTemporaire;
  assert.match(mdp, /^Tmp-[A-Za-z0-9]{16}$/);
  const l = await appeler({ action: "login", identifiant: "t@test.fr", motDePasse: mdp }, sansSession);
  assert.equal(l.code, 200);
  assert.equal(l.corps.mdpAChanger, true);
});

// ---------- nouveau mot de passe ----------
test("nouveau mot de passe temporaire : exige le mot de passe du super admin", async () => {
  await appeler({ action: "creer_comptes", clientId: CLIENT, comptes: [{ identifiant: "m@test.fr", role: "TECHNICIEN", motDePasse: "Base-Longue-Stef-4" }] });
  const faux = await appeler({ action: "regenerer_mot_de_passe", identifiant: "m@test.fr", motDePasseAdmin: "mauvais" });
  assert.equal(faux.code, 403);
  assert.equal((await appeler({ action: "regenerer_mot_de_passe", identifiant: "m@test.fr" })).code, 403);
  const bon = await appeler({ action: "regenerer_mot_de_passe", identifiant: "m@test.fr", motDePasseAdmin: MDP_ADMIN });
  assert.equal(bon.code, 200);
  assert.match(bon.corps.motDePasseTemporaire, /^Tmp-/);
  assert.equal((await appeler({ action: "login", identifiant: "m@test.fr", motDePasse: "Base-Longue-Stef-4" }, sansSession)).code, 401, "l'ancien mot de passe ne marche plus");
  assert.equal((await appeler({ action: "login", identifiant: "m@test.fr", motDePasse: bon.corps.motDePasseTemporaire }, sansSession)).code, 200);
  assert.equal((await appeler({ action: "regenerer_mot_de_passe", identifiant: "chef@test.fr", motDePasseAdmin: MDP_ADMIN })).code, 400, "pas de reinitialisation d'un super admin");
  assert.equal((await appeler({ action: "regenerer_mot_de_passe", identifiant: "m@test.fr", motDePasseAdmin: MDP_ADMIN }, { role: "TENANT_ADMIN" })).code, 403);
});

// ---------- empreinte / visage (telephone simule) ----------
const b64u = (b) => Buffer.from(b).toString("base64url");
function cborBytes(b) { return Buffer.concat([Buffer.from([0x40 + b.length < 0x58 ? 0x40 + b.length : 0x58]), ...(b.length >= 24 ? [Buffer.from([b.length])] : []), b]); }
function cborText(s) { const b = Buffer.from(s); return Buffer.concat([Buffer.from([0x60 + b.length]), b]); }
const cborInt = (n) => (n >= 0 ? Buffer.from([n]) : Buffer.from([0x20 + (-1 - n)]));
function cborBytesLong(b) { return Buffer.concat([Buffer.from([0x58, b.length]), b]); }

function telephone(host = "localhost") {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const idCle = crypto.randomBytes(32);
  const rpHash = crypto.createHash("sha256").update(host).digest();
  const cose = Buffer.concat([Buffer.from([0xa5]), cborInt(1), cborInt(2), cborInt(3), cborInt(-7), cborInt(-1), cborInt(1), cborInt(-2), cborBytesLong(Buffer.from(jwk.x, "base64url")), cborInt(-3), cborBytesLong(Buffer.from(jwk.y, "base64url"))]);
  const compteur = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  return {
    idCle,
    creer(defi, origine, { flags = 0x45 } = {}) {
      const longId = Buffer.alloc(2); longId.writeUInt16BE(idCle.length);
      const authData = Buffer.concat([rpHash, Buffer.from([flags]), compteur(0), Buffer.alloc(16), longId, idCle, cose]);
      const att = Buffer.concat([Buffer.from([0xa3]), cborText("fmt"), cborText("none"), cborText("attStmt"), Buffer.from([0xa0]), cborText("authData"), cborBytesLong(authData).length ? Buffer.concat([Buffer.from([0x59]), Buffer.from([authData.length >> 8, authData.length & 255]), authData]) : Buffer.alloc(0)]);
      return { clientDataJSON: b64u(JSON.stringify({ type: "webauthn.create", challenge: defi, origin: origine })), attestationObject: b64u(att) };
    },
    signer(defi, origine, n, { flags = 0x05, type = "webauthn.get", cle = privateKey } = {}) {
      const authData = Buffer.concat([rpHash, Buffer.from([flags]), compteur(n)]);
      const cd = Buffer.from(JSON.stringify({ type, challenge: defi, origin: origine }));
      const signature = crypto.sign("sha256", Buffer.concat([authData, crypto.createHash("sha256").update(cd).digest()]), cle);
      return { id: b64u(idCle), clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature) };
    },
  };
}

async function activerCle(tel, origine = "http://localhost:3000") {
  const o = await appeler({ action: "cle_options_enregistrement" });
  assert.equal(o.code, 200);
  assert.equal(o.corps.options.rp.id, "localhost");
  assert.equal(o.corps.options.authenticatorSelection.userVerification, "required");
  const rep = tel.creer(o.corps.options.challenge, origine);
  return appeler({ action: "cle_enregistrer", jeton: o.corps.jeton, appareil: "iPhone de test", ...rep });
}

test("empreinte / visage : enregistrement puis connexion", async () => {
  const tel = telephone();
  const e = await activerCle(tel);
  assert.equal(e.code, 200, JSON.stringify(e.corps));
  const fiche = db.Utilisateurs.find((u) => u.id === adminId).fields;
  assert.equal(fiche["Clé d'accès ID"], b64u(tel.idCle));
  assert.ok(fiche["Clé d'accès publique"]);
  assert.equal((await appeler({ action: "cle_etat" })).corps.active, true);

  const o = await appeler({ action: "cle_options_connexion" }, sansSession);
  assert.equal(o.code, 200);
  const c = await appeler({ action: "cle_connexion", jeton: o.corps.jeton, ...tel.signer(o.corps.options.challenge, "http://localhost:3000", 1) }, sansSession);
  assert.equal(c.code, 200, JSON.stringify(c.corps));
  assert.equal(c.corps.role, "SUPER_ADMIN_IKO");
  assert.match(String(c.entetes["Set-Cookie"]), /iko_access=/);
  assert.equal(db.Utilisateurs.find((u) => u.id === adminId).fields["Clé d'accès compteur"], 1);
});

test("empreinte / visage : refus (mauvaise signature, rejeu, mauvais site, mauvais defi, sans verification, cle inconnue)", async () => {
  const tel = telephone();
  await activerCle(tel);
  const essai = async (fabrique) => { const o = await appeler({ action: "cle_options_connexion" }, sansSession); return appeler({ action: "cle_connexion", jeton: o.corps.jeton, ...fabrique(o.corps.options.challenge) }, sansSession); };
  const autre = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  assert.equal((await essai((d) => tel.signer(d, "http://localhost:3000", 1, { cle: autre }))).code, 401, "mauvaise cle");
  assert.equal((await essai((d) => tel.signer(d, "http://pirate.example", 1))).code, 401, "mauvais site");
  assert.equal((await essai((d) => tel.signer("autre-defi", "http://localhost:3000", 1))).code, 401, "mauvais defi");
  assert.equal((await essai((d) => tel.signer(d, "http://localhost:3000", 1, { flags: 0x01 }))).code, 401, "sans Face ID / empreinte");
  assert.equal((await essai((d) => tel.signer(d, "http://localhost:3000", 1, { type: "webauthn.create" }))).code, 401, "mauvais type");
  assert.equal((await essai((d) => ({ ...tel.signer(d, "http://localhost:3000", 1), id: b64u(crypto.randomBytes(32)) }))).code, 401, "cle inconnue");
  assert.equal((await essai((d) => tel.signer(d, "http://localhost:3000", 5))).code, 200, "bon appel");
  assert.equal((await essai((d) => tel.signer(d, "http://localhost:3000", 5))).code, 401, "rejeu / compteur qui ne monte pas");
  const o = await appeler({ action: "cle_options_connexion" }, sansSession);
  const jetonPerime = jwt.sign({ k: "conn", c: o.corps.options.challenge }, crypto.createHash("sha256").update("webauthn|" + process.env.JWT_ACCESS_SECRET).digest("hex"), { expiresIn: -10 });
  assert.equal((await appeler({ action: "cle_connexion", jeton: jetonPerime, ...tel.signer(o.corps.options.challenge, "http://localhost:3000", 9) }, sansSession)).code, 401, "defi expire");
});

test("empreinte / visage : enregistrement refuse sans compte personnel, sans verification biometrique, ou pour un autre site", async () => {
  assert.equal((await appeler({ action: "cle_options_enregistrement" }, sansSession)).code, 403);
  assert.equal((await appeler({ action: "cle_options_enregistrement" }, { userId: "demo" })).code, 403);
  const tel = telephone();
  const o = await appeler({ action: "cle_options_enregistrement" });
  const sansUv = tel.creer(o.corps.options.challenge, "http://localhost:3000", { flags: 0x41 });
  assert.equal((await appeler({ action: "cle_enregistrer", jeton: o.corps.jeton, ...sansUv })).code, 400);
  const autreSite = tel.creer(o.corps.options.challenge, "http://pirate.example");
  assert.equal((await appeler({ action: "cle_enregistrer", jeton: o.corps.jeton, ...autreSite })).code, 400);
  const autreCompte = (await appeler({ action: "cle_enregistrer", jeton: o.corps.jeton, ...tel.creer(o.corps.options.challenge, "http://localhost:3000") }, { userId: "recAUTRE000000001" }));
  assert.equal(autreCompte.code, 400, "le defi est lie au compte connecte");
});

test("empreinte / visage : on peut la retirer", async () => {
  const tel = telephone();
  await activerCle(tel);
  assert.equal((await appeler({ action: "cle_supprimer" })).code, 200);
  assert.equal((await appeler({ action: "cle_etat" })).corps.active, false);
  const o = await appeler({ action: "cle_options_connexion" }, sansSession);
  assert.equal((await appeler({ action: "cle_connexion", jeton: o.corps.jeton, ...tel.signer(o.corps.options.challenge, "http://localhost:3000", 1) }, sansSession)).code, 401);
});
