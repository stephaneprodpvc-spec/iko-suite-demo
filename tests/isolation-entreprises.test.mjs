// Audit sécurité n°3 : un compte connecté de l'entreprise B (ou un visiteur) ne lit ni ne modifie rien chez l'entreprise A.
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { creerFaux } from "./fake-airtable.mjs";

process.env.JWT_ACCESS_SECRET = "secret-isolation"; process.env.JWT_REFRESH_SECRET = "r"; process.env.AIRTABLE_TOKEN = "faux"; process.env.AIRTABLE_BASE_ID = "appTEST00000000A"; process.env.IKO_DEMO_OUVERT = "0";
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const A = "recCLIENTA0000001", B = "recCLIENTB0000002";
const db = {
  Clients: [
    { id: A, fields: { "Nom client": "Entreprise Alpha", Slug: "a", "Emails contact": "secret-a@x.fr", "Connaissance entreprise (JSON)": "REGLE-SECRETE-A", Notes: "NOTE-A" } },
    { id: B, fields: { "Nom client": "Entreprise B", Slug: "b", "Emails contact": "contact-b@x.fr" } },
  ],
  "Tickets SAV": [
    { id: "recTICKETA0000001", fields: { Name: "SAV-A1", Client: "Client Alpha", Email: "victime-a@x.fr", "Téléphone": "0611111111", Adresse: "1 rue A", "Compte client": [A], Statut: "Nouveau" } },
    { id: "recTICKETB0000002", fields: { Name: "SAV-B1", Client: "Client B", Email: "b@x.fr", "Compte client": [B], Statut: "Nouveau" } },
  ],
  Planning: [{ id: "recPLANA00000001", fields: { Date: "2026-12-01", Statut: "Libre", Agence: "Agence 1", "Compte client": [A] } }],
  Devis: [{ id: "recDEVISA0000001", fields: { "N° devis": "DEV-A", "Nom client": "Client Alpha devis", "Montant TTC": 999, "Client Record ID": [A] } }],
  Agences: [{ id: "recAGENCEA000001", fields: { "Nom agence": "Agence A", Client: [A], "Email agence": "agence-a@x.fr" } }],
  Techniciens: [{ id: "recTECHA00000001", fields: { Nom: "TECH-A", Email: "tech-a@x.fr", "Compte client": [A] } }],
  "Contrats entretien": [{ id: "recCONTRATA00001", fields: { Client: "Contrat Alpha", Email: "c-a@x.fr", "Compte client": [A] } }],
  "Métrés": [{ id: "recMETREA0000001", fields: { Name: "MET-A", Client: "Metre Alpha", "Compte client": [A] } }],
  "RDV Commercial": [{ id: "recRDVA000000001", fields: { Name: "RDV-A", Client: "Rdv Alpha", "Compte client": [A] } }],
  "Interventions SAV": [{ id: "recINTERVA000001", fields: { Name: "INT-A", "Constat / Diagnostic": "Constat Alpha", "Compte client": [A] } }],
  "Catalogue Produits": [{ id: "recCATAA00000001", fields: { "Désignation": "Produit Alpha", Client: [A] } }],
  "Questionnaire SAV": [{ id: "recQUESTA0000001", fields: { Question: "Question Alpha", Client: [A] } }],
  Utilisateurs: [{ id: "recUSERA000000001", fields: { Identifiant: "user-alpha", "Hash mot de passe": "HASH-A", tenantId: [A] } }],
  "Journal actions": [{ id: "recJOURNAL000001", fields: { Action: "journal alpha" } }],
};
const faux = creerFaux(db);
globalThis.fetch = async (url, opt) => { if (String(url).includes("hook.eu1.make.com")) return { ok: true, status: 200, json: async () => ({}) }; return faux(url, opt); };
const { default: proxy } = await import("../api/airtable-proxy.js");
const cookieDe = (s) => "iko_access=" + jwt.sign(s, process.env.JWT_ACCESS_SECRET);
const PATRON_B = { userId: "recPATRON0000002B", tenantId: B, role: "TENANT_ADMIN" };
const TECH_B = { userId: "recTECHNIC000002B", tenantId: B, role: "TECHNICIEN", agence: "Agence B" };
const SUPER = { userId: "recSUPER000000001", role: "SUPER_ADMIN_IKO" };
const SECRETS = /victime-a|0611111111|1 rue A|secret-a|REGLE-SECRETE|NOTE-A|agence-a@|tech-a@|c-a@|HASH-A|Client Alpha|Contrat Alpha|Metre Alpha|Rdv Alpha|Constat Alpha|Produit Alpha|Question Alpha|user-alpha|journal alpha/;
let n = 0;
async function appeler(session, methode, chemin, corps, query = {}) {
  const req = { method: methode, query: { path: chemin, ...query }, body: corps, headers: { origin: "http://localhost:3000", cookie: session ? cookieDe(session) : "", "x-forwarded-for": "10.8.0." + (++n) }, socket: { remoteAddress: "10.8.0.1" } };
  const log = console.log; console.log = () => {};
  try {
    return await new Promise((resolve) => { const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b }); return this; }, end() { resolve({ code: this.code }); return this; }, send(b) { resolve({ code: this.code, corps: b }); return this; } }; proxy(req, res).catch((e) => resolve({ code: 500, corps: String(e) })); });
  } finally { console.log = log; }
}
const LECTURES = [
  ["Tickets SAV", {}], ["Tickets SAV", { filterByFormula: '{Statut}="Nouveau"' }], ["Tickets SAV/recTICKETA0000001", {}], ["tenant/Tickets SAV/recTICKETA0000001", {}],
  ["Clients", {}], ["Clients/" + A, {}], ["Planning/recPLANA00000001", {}], ["Devis", {}], ["Devis/recDEVISA0000001", {}], ["Agences", {}], ["Agences/recAGENCEA000001", {}],
  ["Techniciens", {}], ["Techniciens/recTECHA00000001", {}], ["Contrats entretien", {}], ["Contrats entretien/recCONTRATA00001", {}], ["Métrés", {}], ["Métrés/recMETREA0000001", {}],
  ["RDV Commercial", {}], ["tenant/RDV Commercial", {}], ["Interventions SAV", {}], ["Interventions SAV/recINTERVA000001", {}], ["tenant/Interventions SAV", {}],
  ["Catalogue Produits", {}], ["Catalogue Produits/recCATAA00000001", {}], ["Questionnaire SAV", {}], ["Questionnaire SAV/recQUESTA0000001", {}],
  ["Utilisateurs", {}], ["Utilisateurs/recUSERA000000001", {}], ["Journal actions", {}],
];
const ECRITURES = [
  ["PATCH", "Tickets SAV/recTICKETA0000001", { fields: { Email: "pirate@x.fr" } }], ["DELETE", "Tickets SAV/recTICKETA0000001"], ["DELETE", "tenant/Tickets SAV/recTICKETA0000001"],
  ["PATCH", "tenant/Tickets SAV/recTICKETA0000001", { fields: { Email: "pirate@x.fr" } }],
  ["PATCH", "Clients/" + A, { fields: { "Emails contact": "pirate@x.fr" } }], ["PATCH", "Planning/recPLANA00000001", { fields: { Statut: "Bloqué" } }],
  ["PATCH", "Devis/recDEVISA0000001", { fields: { "Montant TTC": 1 } }], ["PATCH", "Agences/recAGENCEA000001", { fields: { "Email agence": "pirate@x.fr" } }],
  ["PATCH", "Techniciens/recTECHA00000001", { fields: { Email: "pirate@x.fr" } }], ["PATCH", "Contrats entretien/recCONTRATA00001", { fields: { Email: "pirate@x.fr" } }],
  ["PATCH", "Catalogue Produits/recCATAA00000001", { fields: { "Désignation": "x" } }], ["PATCH", "Questionnaire SAV/recQUESTA0000001", { fields: { Question: "x" } }],
  ["POST", "Clients", { fields: { "Nom client": "Faux" } }], ["POST", "Tickets SAV", { fields: { Name: "X" } }],
];

for (const [nom, session] of [["compte de l'entreprise B (patron)", PATRON_B], ["compte de l'entreprise B (technicien)", TECH_B], ["visiteur sans compte", null]]) {
  test("lectures : " + nom + " ne voit aucune donnée de l'entreprise A", async () => {
    for (const [chemin, query] of LECTURES) {
      // Un devis se lit par son identifiant SANS compte : c'est le lien reçu par e-mail (identifiant secret, non listable).
      if (!session && chemin === "Devis/recDEVISA0000001") continue;
      const r = await appeler(session, "GET", chemin, undefined, query);
      assert.ok(!SECRETS.test(JSON.stringify(r.corps || "")), "FUITE sur GET " + chemin + " (" + r.code + ") : " + JSON.stringify(r.corps).slice(0, 200));
    }
  });
  test("écritures : " + nom + " ne modifie rien chez l'entreprise A", async () => {
    const avant = JSON.stringify(db);
    for (const [methode, chemin, corps] of ECRITURES) {
      const r = await appeler(session, methode, chemin, corps);
      assert.ok(!(r.code >= 200 && r.code < 300), "ÉCRITURE ACCEPTÉE : " + methode + " " + chemin + " (" + r.code + ")");
    }
    assert.equal(JSON.stringify(db), avant, "la base a changé");
  });
}

test("le patron de B garde l'accès à SES données", async () => {
  assert.equal((await appeler(PATRON_B, "GET", "tenant/Tickets SAV/recTICKETB0000002")).code, 200);
  assert.equal((await appeler(PATRON_B, "GET", "Clients/" + B)).code, 200);
  const liste = await appeler(PATRON_B, "GET", "tenant/Tickets SAV");
  assert.equal(liste.code, 200);
  assert.deepEqual(liste.corps.records.map((r) => r.fields.Name), ["SAV-B1"]);
});

test("le super administrateur garde l'accès complet", async () => {
  const r = await appeler(SUPER, "GET", "Clients");
  assert.equal(r.code, 200);
  assert.ok(r.corps.records.length >= 2 && r.corps.records.some((c) => c.fields["Emails contact"]));
  assert.equal((await appeler(SUPER, "GET", "Tickets SAV")).code, 200);
  assert.equal((await appeler(SUPER, "GET", "Questionnaire SAV")).code, 200);
});

test("recherche d'une fiche entreprise par son identifiant public : nom et couleurs seulement", async () => {
  const r = await appeler(PATRON_B, "GET", "Clients", undefined, { filterByFormula: '{Slug}="a"', maxRecords: "1" });
  assert.equal(r.code, 200);
  assert.equal(r.corps.records[0].fields["Nom client"], "Entreprise Alpha");
  assert.ok(!("Emails contact" in r.corps.records[0].fields));
});

test("devis : liste jamais accessible sans compte (seul le lien secret d'un devis s'ouvre)", async () => {
  assert.equal((await appeler(null, "GET", "Devis")).code, 401);
  assert.equal((await appeler(null, "GET", "Devis", undefined, { filterByFormula: '{Statut}!=""' })).code, 401);
});

test("un patron ne change que les couleurs et le logo de sa fiche, ne supprime ni sa fiche ni ses agences", async () => {
  assert.equal((await appeler(PATRON_B, "PATCH", "Clients/" + B, { fields: { "Couleur principale": "#FF6B00" } })).code, 200);
  for (const champ of ["Accès bloqué", "Modules actifs", "Statut client", "Statut commercial", "Slug", "Nom client", "Emails contact", "Qui paie mode", "Montant diagnostic HT", "Nombre agences", "Lien de paiement"]) {
    assert.equal((await appeler(PATRON_B, "PATCH", "Clients/" + B, { fields: { [champ]: "x" } })).code, 403, champ);
  }
  assert.equal((await appeler(PATRON_B, "PATCH", "Clients/" + B, { fields: { "Couleur principale": "#000000", "Accès bloqué": false } })).code, 403);
  assert.equal((await appeler(PATRON_B, "DELETE", "Clients/" + B)).code, 403);
  assert.equal((await appeler(TECH_B, "PATCH", "Clients/" + B, { fields: { "Couleur principale": "#111111" } })).code, 403);
  assert.equal((await appeler(PATRON_B, "POST", "Clients", { fields: { "Nom client": "Faux" } })).code, 403);
});

test("le super administrateur peut toujours créer, modifier et supprimer une fiche entreprise", async () => {
  const cree = await appeler(SUPER, "POST", "Clients", { fields: { "Nom client": "Nouvelle entreprise" } });
  assert.equal(cree.code, 200);
  assert.equal((await appeler(SUPER, "PATCH", "Clients/" + cree.corps.id, { fields: { "Accès bloqué": true } })).code, 200);
  assert.equal((await appeler(SUPER, "DELETE", "Clients/" + cree.corps.id)).code, 200);
});
