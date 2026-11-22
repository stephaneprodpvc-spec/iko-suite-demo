// Audit sécurité n°3 (4e passe) : test d'attaque AUTOMATIQUE du proxy Airtable.
// On envoie des milliers de requêtes déformées (chemins piégés, variantes de noms de tables, méthodes rares, filtres piégés, corps étranges)
// avec 3 profils (visiteur, patron de B, technicien de B) contre une base factice qui contient des données secrètes de l'entreprise A.
// Règles qui doivent TOUJOURS tenir, quelle que soit la requête :
//   1. aucune donnée secrète de A (ni empreinte de mot de passe) n'apparaît dans une réponse ;
//   2. aucun enregistrement existant d'une autre entreprise n'est modifié ou supprimé ;
//   3. un visiteur ne crée rien ; B ne crée que chez lui ;
//   4. le serveur ne plante pas (pas d'erreur interne affichée).
// Reproductible : FUZZ_SEED=123 FUZZ_N=3000 node --test tests/fuzz-proxy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { creerFaux } from "./fake-airtable.mjs";

process.env.JWT_ACCESS_SECRET = "secret-fuzz"; process.env.JWT_REFRESH_SECRET = "r"; process.env.AIRTABLE_TOKEN = "faux"; process.env.AIRTABLE_BASE_ID = "appTEST00000000A"; process.env.IKO_DEMO_OUVERT = "0";
delete process.env.IKO_MDP_UNIQUE; delete process.env.APP_PROXY_SECRET;
const A = "recCLIENTA0000001", B = "recCLIENTB0000002";
const creerBase = () => ({
  Clients: [
    { id: A, fields: { "Nom client": "Entreprise Alpha", Slug: "a", "Emails contact": "secret-a@x.fr", "Connaissance entreprise (JSON)": "REGLE-SECRETE-A", Notes: "NOTE-A", "Lien de paiement": "https://buy.stripe.com/secretA" } },
    { id: B, fields: { "Nom client": "Entreprise B", Slug: "b", "Emails contact": "contact-b@x.fr" } },
  ],
  "Tickets SAV": [
    { id: "recTICKETA0000001", fields: { Name: "SAV-A1", Client: "Client Alpha", Email: "victime-a@x.fr", "Téléphone": "0611111111", Adresse: "1 rue A", "Compte client": [A], Statut: "Nouveau", Photos: "https://res.cloudinary.com/x/a.jpg" } },
    { id: "recTICKETB0000002", fields: { Name: "SAV-B1", Client: "Client B", Email: "b@x.fr", "Compte client": [B], Statut: "Nouveau" } },
  ],
  Planning: [{ id: "recPLANA00000001", fields: { Date: "2026-12-01", Statut: "Libre", Agence: "Agence 1", "Compte client": [A] } }, { id: "rec45X231n9dXnyaU", fields: { Date: "CONFIG-PLANNING", "Config JSON": "{}" } }],
  Devis: [{ id: "recDEVISA0000001", fields: { "N° devis": "DEV-A", "Nom client": "Devis Alpha", "Montant TTC": 999, "Client Record ID": [A], Client: [A], "Ticket lié": ["recTICKETA0000001"] } }],
  Agences: [{ id: "recAGENCEA000001", fields: { "Nom agence": "Agence A", Client: [A], "Email agence": "agence-a@x.fr" } }],
  Techniciens: [{ id: "recTECHA00000001", fields: { Nom: "TECH-A", Email: "tech-a@x.fr", "Compte client": [A] } }],
  "Contrats entretien": [{ id: "recCONTRATA00001", fields: { Client: "Contrat Alpha", Email: "c-a@x.fr", "Compte client": [A] } }],
  "Métrés": [{ id: "recMETREA0000001", fields: { Name: "MET-A", Client: "Metre Alpha", "Compte client": [A] } }],
  "RDV Commercial": [{ id: "recRDVA000000001", fields: { Name: "RDV-A", Client: "Rdv Alpha", "Compte client": [A] } }],
  "Interventions SAV": [{ id: "recINTERVA000001", fields: { Name: "INT-A", "Constat / Diagnostic": "Constat Alpha", "Compte client": [A] } }],
  "Catalogue Produits": [{ id: "recCATAA00000001", fields: { "Désignation": "Produit Alpha", Client: [A] } }],
  "Questionnaire SAV": [{ id: "recQUESTA0000001", fields: { Question: "Question Alpha", Client: [A] } }],
  Utilisateurs: [{ id: "recUSERA000000001", fields: { Identifiant: "user-alpha", "Hash mot de passe": "HASH-A", tenantId: [A], "Rôle": "TENANT_ADMIN" } }, { id: "recSUPER000000001", fields: { Identifiant: "super-root", "Hash mot de passe": "HASH-SUPER", "Rôle": "SUPER_ADMIN_IKO" } }],
  "Journal actions": [{ id: "recJOURNAL000001", fields: { Action: "journal alpha" } }],
  "Contrôles Chantier": [{ id: "recCHANTIERA0001", fields: { Chantier: "Chantier Alpha", "Compte client": [A] } }],
  "Planning Commercial": [{ id: "recPLCOMA0000001", fields: { Date: "2026-12-02", "Créneau": "Matin Alpha", "Compte client": [A] } }],
  "Ouvertures Métré": [{ id: "recOUVERTA000001", fields: { "Repère": "Ouverture Alpha", "Métré": ["recMETREA0000001"] } }],
  "Grille Main d'œuvre": [{ id: "recGRILLEA000001", fields: { "Type d'action": "Grille Alpha", Client: [A] } }],
  "Mise en page Devis": [{ id: "recMISEPAGEA0001", fields: { Name: "Mise en page Alpha", Client: [A] } }],
  Audience: [{ id: "recAUDIENCE00001", fields: { Jour: "2026-11-01", Donnees: "audience alpha" } }],
});
const db = creerBase();
const initial = JSON.parse(JSON.stringify(db));
const faux = creerFaux(db);
// Airtable renvoie toujours une COPIE : le faux aussi (sinon un filtre du proxy modifierait la base factice elle-même).
globalThis.fetch = async (url, opt) => {
  if (String(url).includes("hook.eu1.make.com")) return { ok: true, status: 200, json: async () => ({}) };
  const r = await faux(url, opt);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, headers: r.headers, json: async () => JSON.parse(JSON.stringify(j)), text: async () => JSON.stringify(j) };
};
const { default: proxy } = await import("../api/airtable-proxy.js");
const cookieDe = (s) => "iko_access=" + jwt.sign(s, process.env.JWT_ACCESS_SECRET);
const PROFILS = [
  ["visiteur", null],
  ["patron B", { userId: "recPATRON0000002B", tenantId: B, role: "TENANT_ADMIN" }],
  ["technicien B", { userId: "recTECHNIC000002B", tenantId: B, role: "TECHNICIEN", agence: "Agence B" }],
];
const SECRETS_COMMUNS = /victime-a|0611111111|1 rue A|secret-a|REGLE-SECRETE|NOTE-A|secretA|agence-a@|tech-a@|c-a@|HASH-A|HASH-SUPER|super-root|user-alpha|Client Alpha|Contrat Alpha|Metre Alpha|Rdv Alpha|Constat Alpha|Produit Alpha|Question Alpha|journal alpha|Chantier Alpha|Matin Alpha|Ouverture Alpha|Grille Alpha|Mise en page Alpha|audience alpha/;
const ERREUR_INTERNE = /TypeError|ReferenceError|RangeError|Cannot read|is not a function|undefined is not|at async|node_modules/;

// ---- générateur pseudo-aléatoire reproductible ----
let graine = parseInt(process.env.FUZZ_SEED || "20261122", 10) >>> 0;
const alea = () => { graine |= 0; graine = (graine + 0x6D2B79F5) | 0; let t = Math.imul(graine ^ (graine >>> 15), 1 | graine); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const choix = (l) => l[Math.floor(alea() * l.length)];
const NOMS = ["Planning", "Tickets SAV", "Métrés", "RDV Commercial", "Planning Commercial", "Contrôles Chantier", "Ouvertures Métré", "Clients", "Questionnaire SAV", "Agences", "Catalogue Produits", "Grille Main d'œuvre", "Mise en page Devis", "Devis", "Interventions SAV", "Contrats entretien", "Techniciens", "Utilisateurs", "Audience", "Journal actions"];
const IDS = ["recTICKETA0000001", "recTICKETB0000002", "recPLANA00000001", "recDEVISA0000001", "recAGENCEA000001", "recTECHA00000001", "recCONTRATA00001", "recMETREA0000001", "recRDVA000000001", "recINTERVA000001", "recCATAA00000001", "recQUESTA0000001", "recUSERA000000001", "recSUPER000000001", "recJOURNAL000001", "recCHANTIERA0001", "recPLCOMA0000001", "recOUVERTA000001", "recGRILLEA000001", "recMISEPAGEA0001", "recAUDIENCE00001", A, B, "rec45X231n9dXnyaU", "recINCONNU0000001"];
const ROUTES = ["tenant", "content", "creneaux", "push", "webhook", "webhook-metreur", "suivi", "entretien", "carnet"];
const PIEGES = ["..", ".", "", "%2e%2e", "%2E%2E", "..%2F", "%2F", "\\", "\u0000", "?x=1", "#", " ", "  ", "a".repeat(500), "tblNtYcMBBYRVjEKw", "tbllRTCTqb0auqK6a", "tblh1s7X6yXJlsTGW", "fldABCDEFGHIJKLMN", "appAUTREBASE0001", "meta", "bases", "v0", "uploadAttachment", "Logo", "*", "$ref", "__proto__", "constructor", "Utilisateurs​", "Utilisatеurs", "UTILISATEURS", "utilisateurs", "Métres", "Tickets%20SAV", "Tickets+SAV"];
const VARIANTES = (n) => [n, n, n, n.toLowerCase(), n.toUpperCase(), n + " ", " " + n, n.replace(/ /g, "%20"), n.replace(/ /g, "+"), encodeURIComponent(n), n.normalize("NFD")];
const segment = () => { const t = alea(); if (t < 0.4) return choix(VARIANTES(choix(NOMS))); if (t < 0.65) return choix(IDS); if (t < 0.75) return choix(ROUTES); return choix(PIEGES); };
// Cas « grammaire » : une table autorisée, puis une ruse de remontée, puis la vraie cible (table interne, identifiant, route propre).
const RUSES = ["..", "../..", "./..", "%2e%2e", "%2e%2e%2f", "..%2f", "..%5c", "..\\", "....", "..;", "..%00", "%252e%252e", "....//", ".%2e", "%2e."];
const CIBLES = ["Utilisateurs", "Journal actions", "Audience", "Clients", "Tickets SAV", "Devis", "tblNtYcMBBYRVjEKw", "tbllRTCTqb0auqK6a", "recUSERA000000001", "recSUPER000000001", "content", "meta/bases", "appAUTREBASE0001/Tickets SAV"];
const cheminGrammaire = () => [choix(["Planning", "Tickets SAV", "Clients", "Agences", "Devis", "creneaux", "tenant", "Techniciens"]), choix(RUSES), choix(CIBLES), ...(alea() < 0.3 ? [choix(IDS)] : [])].join("/");
const chemin = () => alea() < 0.2 ? cheminGrammaire() : Array.from({ length: 1 + Math.floor(alea() * 4) }, segment).join(choix(["/", "/", "/", "//", "/./"]));
const METHODES = ["GET", "GET", "GET", "POST", "PATCH", "PATCH", "DELETE", "PUT", "HEAD", "OPTIONS", "TRACE"];
const FORMULES = ['{Statut}!=""', 'TRUE()', '1=1', 'OR(1=1)', '{Compte client}!=""', 'FIND("Alpha",ARRAYJOIN({Compte client}))', '{Slug}="a"', '{Slug}="a" OR TRUE()', '{Devis Token}="abcdefghijklmnop"', '{Note Token}="x"=""', 'RECORD_ID()!=""', '{Email}!=""', 'LEN({Hash mot de passe})>0', '{Slug}="a\\" OR TRUE() OR \\""', 'FIND("SAV-2026-1002",ARRAYJOIN({Ticket lié}))', 'AND({Actif}=1)', 'NOT({Nom client}="")', '"' , '\\', '{Slug}="' + "x".repeat(300) + '"'];
const CHAMPS = ["Email", "Téléphone", "Statut", "Compte client", "Client", "Rôle", "Hash mot de passe", "Accès bloqué", "Modules actifs", "Message client", "Qui paie détail", "Notes", "Slug", "Nom client", "Montant TTC", "Yousign Signer Link", "Photos", "Note", "Date", "Config JSON", "__proto__", "constructor"];
const VALEURS = () => choix(["pirate@x.fr", "Bloqué", "Pris", "Libre", "Annulé", "Nouveau", "Validé", true, false, 1, 99, null, [], [A], [B], [A, B], ["recINCONNU0000001"], { a: 1 }, "x".repeat(9000), "https://pirate.example/x", "SUPER_ADMIN_IKO", "<script>alert(1)</script>"]);
const champsAlea = () => { const f = {}; for (let i = 0; i < 1 + Math.floor(alea() * 3); i++) f[choix(CHAMPS)] = VALEURS(); return f; };
const corps = () => { const t = alea(); if (t < 0.15) return undefined; if (t < 0.5) return { fields: champsAlea() }; if (t < 0.65) return { fields: champsAlea(), typecast: true }; if (t < 0.8) return { records: [{ id: choix(IDS), fields: champsAlea() }, { fields: champsAlea() }] }; if (t < 0.85) return [1, 2]; if (t < 0.9) return "texte"; if (t < 0.95) return JSON.parse('{"__proto__":{"role":"SUPER_ADMIN_IKO"},"fields":{"Statut":"Pris"}}'); return { action: choix(["send", "subscribe", "creer", "lire", "qui_paie_client"]), ticket: "SAV-A1", c: "x", subscription: { endpoint: "https://pirate.example/x" }, agence: "Agence 1" }; };
const requete = () => {
  const q = {};
  if (alea() < 0.4) q.filterByFormula = choix(FORMULES);
  if (alea() < 0.2) q["fields[]"] = choix(CHAMPS);
  if (alea() < 0.1) q.offset = choix(["itrXXX", "../Utilisateurs", ""]);
  if (alea() < 0.1) q.maxRecords = choix(["1", "1000", "-1", "abc"]);
  if (alea() < 0.1) q.view = choix(["Grid view", "../x"]);
  if (alea() < 0.1) q.returnFieldsByFieldId = "true";
  if (alea() < 0.08) q["sort[0][field]"] = choix(CHAMPS);
  return q;
};

let ip = 0;
async function appeler(session, methode, path, body, query) {
  const q = { ...query, path: alea() < 0.1 ? [path, choix(PIEGES.concat(NOMS))] : path }; // « ?path= » ajouté à l'adresse : Vercel le transmet sous forme de liste
  const req = { method: methode, query: q, body, headers: { origin: choix(["http://localhost:3000", "http://localhost:3000", "http://localhost:3000", undefined]), ...(session ? { cookie: cookieDe(session) } : {}), "x-forwarded-for": "10.77." + Math.floor(++ip / 250) + "." + (ip % 250) }, socket: { remoteAddress: "10.77.0.1" } };
  const log = console.log; console.log = () => {};
  const err = console.error; console.error = () => {};
  try {
    return await Promise.race([
      new Promise((resolve) => { const res = { code: 200, setHeader() {}, getHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, corps: b }); return this; }, end() { resolve({ code: this.code }); return this; }, send(b) { resolve({ code: this.code, corps: b }); return this; } }; Promise.resolve(proxy(req, res)).then(() => setTimeout(() => resolve({ code: res.code, corps: "(sans réponse)" }), 5)).catch((e) => resolve({ code: 500, corps: "EXCEPTION " + String(e && e.stack || e) })); }),
      new Promise((resolve) => setTimeout(() => resolve({ code: 599, corps: "DÉLAI DÉPASSÉ" }), 5000)),
    ]);
  } finally { console.log = log; console.error = err; }
}
const proprietaire = (rec) => Object.values(rec.fields || {}).some((v) => Array.isArray(v) && v.includes(B)) || rec.id === B;
const etatDesAutres = () => JSON.stringify(Object.keys(initial).map((t) => initial[t].filter((x) => !proprietaire(x)).map((x) => (db[t] || []).find((y) => y.id === x.id) || "SUPPRIMÉ:" + x.id)));
const SECRETS_VISITEUR = SECRETS_COMMUNS; // « Devis Alpha » (lecture d'un devis par son lien secret) n'est pas dans la liste : volontaire

for (const [nom, session] of PROFILS) {
  test("attaque automatique : " + nom, { timeout: 600000 }, async () => {
    const N = parseInt(process.env.FUZZ_N || "1500", 10);
    const problemes = [];
    let reference = etatDesAutres();
    for (let i = 0; i < N; i++) {
      const m = choix(METHODES), p = chemin(), b = corps(), q = requete();
      const r = await appeler(session, m, p, b, q);
      const txt = JSON.stringify(r.corps === undefined ? "" : r.corps);
      const cas = nom + " " + m + " /" + p + " " + JSON.stringify(q) + " " + (JSON.stringify(b) || "").slice(0, 160);
      if (SECRETS_VISITEUR.test(txt)) problemes.push("FUITE : " + cas + " -> " + r.code + " " + txt.slice(0, 120));
      if (ERREUR_INTERNE.test(txt) || r.code === 599 || (r.code === 500 && /EXCEPTION/.test(txt))) problemes.push("PLANTAGE : " + cas + " -> " + r.code + " " + txt.slice(0, 160));
      const apres = etatDesAutres();
      if (apres !== reference) { problemes.push("MODIFIE PAR LA REQUÊTE : " + cas + " -> " + r.code + " " + txt.slice(0, 100)); reference = apres; }
      if (problemes.length >= 8) break;
    }
    // intégrité : rien d'existant chez A n'a changé ou disparu ; B n'a créé que chez lui ; le visiteur n'a rien créé
    for (const table of Object.keys(initial)) {
      for (const rec of initial[table]) {
        if (proprietaire(rec)) continue;
        const actuel = (db[table] || []).find((x) => x.id === rec.id);
        if (!actuel) problemes.push("SUPPRIMÉ : " + table + "/" + rec.id);
        else if (JSON.stringify(actuel.fields) !== JSON.stringify(rec.fields)) problemes.push("MODIFIÉ : " + table + "/" + rec.id + " -> " + JSON.stringify(actuel.fields).slice(0, 140));
      }
      for (const rec of db[table] || []) {
        if (initial[table].some((x) => x.id === rec.id) || table === "Journal actions") continue; // le journal d'audit est écrit par le serveur lui-même
        if (nom === "visiteur" || !proprietaire(rec)) problemes.push("CRÉÉ (" + nom + ") : " + table + "/" + rec.id + " " + JSON.stringify(rec.fields).slice(0, 120));
      }
    }
    assert.deepEqual(problemes.slice(0, 8), []);
  });
}
