// Sonde : un compte connecté de l'entreprise B essaie de lire / modifier les données de l'entreprise A (base factice).
import jwt from "jsonwebtoken";
import { creerFaux } from "./fake-airtable.mjs";
process.env.JWT_ACCESS_SECRET = "secret-isolation"; process.env.JWT_REFRESH_SECRET = "r"; process.env.AIRTABLE_TOKEN = "faux"; process.env.AIRTABLE_BASE_ID = "appTEST00000000A"; process.env.IKO_DEMO_OUVERT = "0";
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const A = "recCLIENTA0000001", B = "recCLIENTB0000002";
const db = {
  Clients: [
    { id: A, fields: { "Nom client": "VICTIME-A", Slug: "a", "Emails contact": "secret-a@x.fr", "Connaissance entreprise (JSON)": "REGLE-SECRETE-A", Notes: "NOTE-A" } },
    { id: B, fields: { "Nom client": "Entreprise B", Slug: "b" } },
  ],
  "Tickets SAV": [
    { id: "recTICKETA0000001", fields: { Name: "SAV-A1", Client: "VICTIME-A client", Email: "victime-a@x.fr", "Téléphone": "0611111111", Adresse: "1 rue A", "Compte client": [A], Statut: "Nouveau" } },
    { id: "recTICKETB0000002", fields: { Name: "SAV-B1", Client: "Client B", Email: "b@x.fr", "Compte client": [B], Statut: "Nouveau" } },
  ],
  Planning: [{ id: "recPLANA00000001", fields: { Date: "2026-12-01", Statut: "Libre", Agence: "Agence 1", "Compte client": [A] } }],
  Devis: [{ id: "recDEVISA0000001", fields: { "N° devis": "DEV-A", "Nom client": "VICTIME-A devis", "Montant TTC": 999, "Client Record ID": [A] } }],
  Agences: [{ id: "recAGENCEA000001", fields: { "Nom agence": "Agence A", Client: [A], "Email agence": "agence-a@x.fr" } }],
  Techniciens: [{ id: "recTECHA00000001", fields: { Nom: "TECH-A", Email: "tech-a@x.fr", "Compte client": [A] } }],
  "Contrats entretien": [{ id: "recCONTRATA00001", fields: { Client: "VICTIME-A contrat", Email: "c-a@x.fr", "Compte client": [A] } }],
  "Métrés": [{ id: "recMETREA0000001", fields: { Name: "MET-A", Client: "VICTIME-A metre", "Compte client": [A] } }],
  "RDV Commercial": [{ id: "recRDVA000000001", fields: { Name: "RDV-A", Client: "VICTIME-A rdv", "Compte client": [A] } }],
  "Interventions SAV": [{ id: "recINTERVA000001", fields: { Name: "INT-A", "Constat / Diagnostic": "VICTIME-A constat", "Compte client": [A] } }],
  "Catalogue Produits": [{ id: "recCATAA00000001", fields: { "Désignation": "VICTIME-A produit", Client: [A] } }],
  "Questionnaire SAV": [{ id: "recQUESTA0000001", fields: { Question: "VICTIME-A question", Client: [A] } }],
  Utilisateurs: [{ id: "recUSERA000000001", fields: { Identifiant: "VICTIME-A user", "Hash mot de passe": "HASH-A", tenantId: [A] } }],
  "Journal actions": [{ id: "recJOURNAL000001", fields: { Action: "VICTIME-A journal" } }],
};
const faux = creerFaux(db);
globalThis.fetch = async (url, opt) => { if (String(url).includes("hook.eu1.make.com")) return { ok: true, status: 200, json: async () => ({}) }; return faux(url, opt); };
const { default: proxy } = await import("../api/airtable-proxy.js");
const cookie = "iko_access=" + jwt.sign({ userId: "recPATRON0000002B", tenantId: B, role: "TENANT_ADMIN" }, process.env.JWT_ACCESS_SECRET);
let n = 0;
async function appeler(methode, chemin, corps, query = {}) {
  const req = { method: methode, query: { path: chemin, ...query }, body: corps, headers: { origin: "http://localhost:3000", cookie, "x-forwarded-for": "10.9.0." + (++n) }, socket: { remoteAddress: "10.9.0.1" } };
  return new Promise((resolve) => { const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b }); return this; }, end() { resolve({ code: this.code }); return this; }, send(b) { resolve({ code: this.code, corps: b }); return this; } }; const log = console.log; console.log = () => {}; proxy(req, res).then(() => { console.log = log; }).catch((e) => { console.log = log; resolve({ code: 500, corps: String(e) }); }); });
}
const sondes = [
  ["Tickets SAV : LISTE", "GET", "Tickets SAV", undefined, {}],
  ["Tickets SAV : LISTE filtrée", "GET", "Tickets SAV", undefined, { filterByFormula: '{Statut}="Nouveau"' }],
  ["Tickets SAV : lecture par id", "GET", "Tickets SAV/recTICKETA0000001"],
  ["Tickets SAV : modif par id (Email)", "PATCH", "Tickets SAV/recTICKETA0000001", { fields: { Email: "pirate@x.fr" } }],
  ["Tickets SAV : suppression par id", "DELETE", "Tickets SAV/recTICKETA0000001"],
  ["tenant/Tickets SAV : lecture par id", "GET", "tenant/Tickets SAV/recTICKETA0000001"],
  ["tenant/Tickets SAV : LISTE", "GET", "tenant/Tickets SAV"],
  ["Clients : LISTE", "GET", "Clients"],
  ["Clients : par slug", "GET", "Clients", undefined, { filterByFormula: '{Slug}="a"', maxRecords: "1" }],
  ["Clients : lecture par id", "GET", "Clients/" + A],
  ["Clients : modif par id", "PATCH", "Clients/" + A, { fields: { "Emails contact": "pirate@x.fr" } }],
  ["Planning : LISTE", "GET", "Planning"],
  ["Planning : lecture par id", "GET", "Planning/recPLANA00000001"],
  ["Planning : modif par id", "PATCH", "Planning/recPLANA00000001", { fields: { Statut: "Bloqué" } }],
  ["Devis : LISTE", "GET", "Devis"],
  ["Devis : lecture par id", "GET", "Devis/recDEVISA0000001"],
  ["Devis : modif par id", "PATCH", "Devis/recDEVISA0000001", { fields: { "Montant TTC": 1 } }],
  ["Agences : LISTE", "GET", "Agences"],
  ["Agences : lecture par id", "GET", "Agences/recAGENCEA000001"],
  ["Agences : modif par id", "PATCH", "Agences/recAGENCEA000001", { fields: { "Email agence": "pirate@x.fr" } }],
  ["Techniciens : LISTE", "GET", "Techniciens"],
  ["Techniciens : lecture par id", "GET", "Techniciens/recTECHA00000001"],
  ["Contrats entretien : LISTE", "GET", "Contrats entretien"],
  ["Contrats entretien : lecture par id", "GET", "Contrats entretien/recCONTRATA00001"],
  ["Métrés : LISTE", "GET", "Métrés"],
  ["Métrés : lecture par id", "GET", "Métrés/recMETREA0000001"],
  ["RDV Commercial : LISTE", "GET", "RDV Commercial"],
  ["tenant/RDV Commercial : LISTE", "GET", "tenant/RDV Commercial"],
  ["Interventions SAV : LISTE", "GET", "Interventions SAV"],
  ["Interventions SAV : lecture par id", "GET", "Interventions SAV/recINTERVA000001"],
  ["tenant/Interventions SAV : LISTE", "GET", "tenant/Interventions SAV"],
  ["Catalogue Produits : LISTE", "GET", "Catalogue Produits"],
  ["Catalogue Produits : lecture par id", "GET", "Catalogue Produits/recCATAA00000001"],
  ["Questionnaire SAV : LISTE", "GET", "Questionnaire SAV"],
  ["Questionnaire SAV : lecture par id", "GET", "Questionnaire SAV/recQUESTA0000001"],
  ["Utilisateurs : LISTE", "GET", "Utilisateurs"],
  ["Utilisateurs : lecture par id", "GET", "Utilisateurs/recUSERA000000001"],
  ["Journal actions : LISTE", "GET", "Journal actions"],
];
let fuites = 0;
for (const [nom, m, ch, corps, q] of sondes) {
  const r = await appeler(m, ch, corps, q || {});
  const txt = JSON.stringify(r.corps || "");
  const fuite = /VICTIME-A|victime-a|secret-a|REGLE-SECRETE|NOTE-A|agence-a|tech-a|c-a@|HASH-A|0611111111|1 rue A/.test(txt);
  const modifie = m !== "GET" && r.code >= 200 && r.code < 300;
  if (fuite || modifie) fuites++;
  console.log((fuite || modifie ? "!!! " : "ok  ") + String(r.code).padEnd(4) + nom + (fuite ? "  [DONNÉES DE A VISIBLES]" : "") + (modifie ? "  [ÉCRITURE ACCEPTÉE SUR A]" : ""));
}
console.log("\nProblèmes :", fuites);
