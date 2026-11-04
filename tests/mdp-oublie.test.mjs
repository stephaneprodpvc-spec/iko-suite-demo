// Tests : « mot de passe oublié » (demande publique -> visible dans « Mes accès » du patron -> effacée après le nouveau mot de passe).
// Lancer : node --test tests/mdp-oublie.test.mjs   — AUCUN appel reseau (faux Airtable en memoire), secrets de test.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { creerFaux } from "./fake-airtable.mjs";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.IKO_DEMO_OUVERT = "0";
delete process.env.IKO_MDP_UNIQUE;
const { default: handler } = await import("../api/verif-securite.js");

const CLIENT = "recCLIENT0000001A", AUTRE = "recCLIENT0000002B";
const CONFIG = "rec45X231n9dXnyaU";
const MDP_PATRON = "Phrase-Patron-Test-2026";
let db, ip = 0;

function reinitialiser() {
  db = {
    Clients: [{ id: CLIENT, fields: { "Nom client": "Test Menuiserie" } }, { id: AUTRE, fields: { "Nom client": "Autre Entreprise" } }],
    Utilisateurs: [
      { id: "recPATRON00000001", fields: { "Identifiant": "patron@test.fr", "Hash mot de passe": bcrypt.hashSync(MDP_PATRON, 4), "Rôle": "TENANT_ADMIN", "Statut": "Actif", "tenantId": [CLIENT] } },
      { id: "recTECH000000001A", fields: { "Identifiant": "Marc@Test.fr", "Hash mot de passe": bcrypt.hashSync("Ancien-Mdp-2026-xx", 4), "Rôle": "TECHNICIEN", "Statut": "Actif", "tenantId": [CLIENT], "Agence": "Agence 1" } },
      { id: "recTECH000000002B", fields: { "Identifiant": "luc@autre.fr", "Hash mot de passe": bcrypt.hashSync("Autre-Mdp-2026-xx", 4), "Rôle": "TECHNICIEN", "Statut": "Actif", "tenantId": [AUTRE] } },
      { id: "recADMIN00000001", fields: { "Identifiant": "chef@test.fr", "Hash mot de passe": bcrypt.hashSync("Phrase-Admin-Test-2026", 4), "Rôle": "SUPER_ADMIN_IKO", "Statut": "Actif" } },
    ],
    Agences: [], Planning: [{ id: CONFIG, fields: { "Date": "CONFIG", "Config JSON": "{}" } }],
  };
  globalThis.fetch = creerFaux(db);
}
beforeEach(reinitialiser);

function appeler(corps, { session = null, adresse } = {}) {
  const cookie = session ? "iko_access=" + jwt.sign(session, process.env.JWT_ACCESS_SECRET) : "";
  const a = adresse || "10.7." + (ip >> 8) + "." + (ip++ & 255);
  const req = { method: "POST", headers: { host: "localhost:3000", cookie }, body: corps, query: {}, socket: { remoteAddress: a } };
  return new Promise((resolve) => {
    const res = { code: 200, entetes: {}, setHeader(k, v) { this.entetes[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b }); return this; } };
    handler(req, res);
  });
}
const patron = (tenantId = CLIENT, userId = "recPATRON00000001") => ({ session: { userId, tenantId, role: "TENANT_ADMIN" } });
const demandes = () => JSON.parse(db.Planning[0].fields["Config JSON"]).demandesMdp || [];

test("une demande d'un technicien est enregistrée et la réponse est neutre", async () => {
  const r = await appeler({ action: "mdp_oublie", identifiant: "marc@test.fr" });
  assert.equal(r.code, 200);
  assert.equal(r.corps.ok, true);
  assert.deepEqual(demandes().map((d) => d.id), ["marc@test.fr"]);
});

test("même réponse pour un compte inconnu ou un super administrateur : rien n'est révélé, rien n'est enregistré", async () => {
  const connu = await appeler({ action: "mdp_oublie", identifiant: "marc@test.fr" });
  const inconnu = await appeler({ action: "mdp_oublie", identifiant: "personne@nulle-part.fr" });
  const chef = await appeler({ action: "mdp_oublie", identifiant: "chef@test.fr" });
  assert.deepEqual(inconnu, connu);
  assert.deepEqual(chef, connu);
  assert.deepEqual(demandes().map((d) => d.id), ["marc@test.fr"]);
});

test("un compte coupé ne peut pas faire de demande", async () => {
  db.Utilisateurs[1].fields["Statut"] = "Bloqué";
  const r = await appeler({ action: "mdp_oublie", identifiant: "marc@test.fr" });
  assert.equal(r.code, 200);
  assert.equal(demandes().length, 0);
});

test("identifiant vide ou trop court : refusé", async () => {
  assert.equal((await appeler({ action: "mdp_oublie", identifiant: "" })).code, 400);
  assert.equal((await appeler({ action: "mdp_oublie", identifiant: "ab" })).code, 400);
});

test("une même personne qui redemande ne crée qu'une seule ligne", async () => {
  await appeler({ action: "mdp_oublie", identifiant: "marc@test.fr" });
  await appeler({ action: "mdp_oublie", identifiant: "MARC@test.fr" });
  assert.equal(demandes().length, 1);
});

test("limite : au plus 5 demandes par adresse en 10 minutes", async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await appeler({ action: "mdp_oublie", identifiant: "marc@test.fr" }, { adresse: "10.9.9.9" })).code);
  assert.equal(codes.slice(0, 5).every((c) => c === 200), true);
  assert.equal(codes.slice(5).every((c) => c !== 200), true);
});

test("le patron voit la demande (en premier) dans son équipe, pas celle d'un autre client", async () => {
  await appeler({ action: "mdp_oublie", identifiant: "marc@test.fr" });
  await appeler({ action: "mdp_oublie", identifiant: "luc@autre.fr" });
  const r = await appeler({ action: "lister_equipe" }, patron());
  assert.equal(r.code, 200);
  const equipe = r.corps.equipe;
  assert.equal(equipe.some((m) => m.identifiant === "luc@autre.fr"), false);
  assert.equal(equipe[0].identifiant, "Marc@Test.fr");
  assert.equal(equipe[0].demandeMdp, true);
  assert.equal(equipe.find((m) => m.identifiant === "patron@test.fr").demandeMdp, false);
});

test("la demande disparaît quand le patron remet un nouveau mot de passe", async () => {
  await appeler({ action: "mdp_oublie", identifiant: "marc@test.fr" });
  const g = await appeler({ action: "regenerer_mot_de_passe", identifiant: "Marc@Test.fr", motDePasseAdmin: MDP_PATRON }, patron());
  assert.equal(g.code, 200);
  assert.ok(g.corps.motDePasseTemporaire);
  assert.equal(demandes().length, 0);
  const r = await appeler({ action: "lister_equipe" }, patron());
  assert.equal(r.corps.equipe.every((m) => m.demandeMdp === false), true);
  const l = await appeler({ action: "login", identifiant: "marc@test.fr", motDePasse: g.corps.motDePasseTemporaire });
  assert.equal(l.code, 200);
});

test("une demande de plus de 7 jours est ignorée", async () => {
  db.Planning[0].fields["Config JSON"] = JSON.stringify({ demandesMdp: [{ id: "marc@test.fr", quand: Date.now() - 8 * 24 * 3600 * 1000 }] });
  const r = await appeler({ action: "lister_equipe" }, patron());
  assert.equal(r.corps.equipe.every((m) => m.demandeMdp === false), true);
});

test("la liste des demandes est plafonnée et la configuration existante est conservée", async () => {
  db.Planning[0].fields["Config JSON"] = JSON.stringify({ alertes: { actif: true, email: "x@y.fr" }, demandesMdp: Array.from({ length: 40 }, (_, i) => ({ id: "ancien" + i + "@x.fr", quand: Date.now() })) });
  await appeler({ action: "mdp_oublie", identifiant: "marc@test.fr" });
  const c = JSON.parse(db.Planning[0].fields["Config JSON"]);
  assert.equal(c.demandesMdp.length, 40);
  assert.equal(c.demandesMdp[39].id, "marc@test.fr");
  assert.equal(c.alertes.email, "x@y.fr");
});
