// api/_planning.js
// Planning configurable par client ET par agence (Bloc 3, phase 1).
// Fichier prefixe "_" : helper partage, PAS une fonction Vercel (plafond 12).
//
// Principes :
//  - Creneaux PRE-GENERES dans la table Planning (1 ligne = 1 place ; capacite N =
//    N lignes "Libre" identiques sur le meme creneau). Aucun changement de schema.
//  - Reglages stockes dans des lignes Planning Date="CONFIG-PLANNING" :
//    client (Agence vide) puis agence (qui REMPLACE champ par champ le client).
//  - Un creneau appartient a un client via "Compte client" (lien verifie par
//    IDENTIFIANT sur chaque enregistrement recu, jamais par le seul nom).
//    Sans client = DEMO : lignes sans "Compte client", jamais supprimees ici.
//  - Renouvellement A LA DEMANDE (pas de cron) par tranches courtes : lots de 10
//    enregistrements, budget de temps, reprise a l'appel suivant.
//
// Toutes les fonctions Airtable utilisent le fetch global (remplacable en test).

const TABLE = "Planning";
export const CLE_CONFIG = "CONFIG-PLANNING";

// Phase 1 : demi-journees aux libelles historiques (les ecrans les connaissent).
// Les libelles contiennent un tiret cadratin (U+2014).
export const PERIODES = {
  matin: { id: "matin", label: "Matin (8h30 — 12h00)", debut: "08:30", fin: "12:00" },
  apres_midi: { id: "apres_midi", label: "Après-midi (13h00 — 17h00)", debut: "13:00", fin: "17:00" },
};

// Phase 2 (heures precises) : decoupage.mode = "heures" avec des plages horaires
// (ex. 08:30-12:00 et 13:00-17:00) decoupees en creneaux de dureeMinutes.
// Libelles generes : "9h00 — 10h00" (tiret cadratin U+2014).
const HEURES_ACTIVEES = true;
const MAX_PLAGES = 4;
const MAX_CRENEAUX_PAR_JOUR = 24;

export const REGLAGES_DEFAUT = Object.freeze({
  version: 1,
  joursTravailles: [1, 2, 3, 4, 5], // 0 = dimanche ... 6 = samedi
  decoupage: { mode: "demi-journees", periodes: ["matin", "apres_midi"], plages: [], dureeMinutes: 60 },
  capacite: 1,
  fermetures: [], // [{ du: "AAAA-MM-JJ", au: "AAAA-MM-JJ", motif: "Conges" }]
  joursFeries: true,
  delaiMinJours: 7,
  horizonSemaines: 6,
});
// Reglages propres de la demo (Agences 1 a 4, matin / apres-midi, capacite 1).
export const REGLAGES_DEMO = Object.freeze({ ...REGLAGES_DEFAUT, capacite: 1 });
export const AGENCES_DEMO = ["Agence 1", "Agence 2", "Agence 3", "Agence 4"];

// ---------------------------------------------------------------- dates (pures)

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function enUtc(date) {
  const [a, m, j] = date.split("-").map(Number);
  return Date.UTC(a, m - 1, j);
}
function depuisUtc(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
export function ajouterJours(date, n) {
  return depuisUtc(enUtc(date) + n * 86400000);
}
export function jourSemaine(date) {
  return new Date(enUtc(date)).getUTCDay();
}
export function dateValide(date) {
  if (typeof date !== "string" || !RE_DATE.test(date)) return false;
  return depuisUtc(enUtc(date)) === date;
}
// Date du jour a Paris, au format AAAA-MM-JJ.
export function aujourdhuiParis(maintenant = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(maintenant);
}

function paques(an) {
  const a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a +11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(an, mois - 1, jour);
}

// Jours feries de France metropolitaine (hors Alsace-Moselle).
export function joursFeriesFR(an) {
  const set = new Set();
  [[1, 1], [5, 1], [5, 8], [7, 14], [8, 15], [11, 1], [11, 11], [12, 25]].forEach(([m, j]) => {
    set.add(an + "-" + String(m).padStart(2, "0") + "-" + String(j).padStart(2, "0"));
  });
  const p = paques(an);
  [1, 39, 50].forEach((n) => set.add(depuisUtc(p + n * 86400000))); // lundi de Paques, Ascension, lundi de Pentecote
  return set;
}

// ------------------------------------------------------------ reglages (purs)

function heureValide(v) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(v || ""));
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function entierBorne(v, min, max, defaut) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : defaut;
}

// Normalise un objet de reglages (partiel autorise). Retourne { ok, reglages } ou { ok:false, erreur }.
export function validerReglages(brut, { partiel = true } = {}) {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return { ok: false, erreur: "Réglages invalides." };
  const out = {};
  if ("joursTravailles" in brut) {
    if (!Array.isArray(brut.joursTravailles)) return { ok: false, erreur: "Jours travaillés invalides." };
    const jours = Array.from(new Set(brut.joursTravailles.map(Number))).filter((j) => Number.isInteger(j) && j >= 0 && j <= 6).sort();
    if (!jours.length) return { ok: false, erreur: "Au moins un jour travaillé est requis." };
    out.joursTravailles = jours;
  }
  if ("decoupage" in brut) {
    const d = brut.decoupage || {};
    const mode = d.mode || "demi-journees";
    if (mode === "heures" && !HEURES_ACTIVEES) return { ok: false, erreur: "Le découpage par heures précises n'est pas encore disponible." };
    if (mode !== "demi-journees" && mode !== "heures") return { ok: false, erreur: "Mode de découpage inconnu." };
    const dec = { mode };
    if (mode === "demi-journees") {
      const periodes = (Array.isArray(d.periodes) ? d.periodes : ["matin", "apres_midi"]).filter((p) => PERIODES[p]);
      if (!periodes.length) return { ok: false, erreur: "Au moins une demi-journée (matin ou après-midi) est requise." };
      dec.periodes = Array.from(new Set(periodes));
    } else {
      const brutes = Array.isArray(d.plages) ? d.plages : [];
      if (brutes.length > MAX_PLAGES) return { ok: false, erreur: "4 plages horaires maximum par jour." };
      const plages = brutes.filter((p) => heureValide(p && p.debut) && heureValide(p && p.fin) && p.debut < p.fin);
      if (!plages.length || plages.length !== brutes.length) return { ok: false, erreur: "Plage horaire invalide : heures HH:MM, début avant fin." };
      plages.sort((a, b) => (a.debut < b.debut ? -1 : 1));
      for (let i = 1; i < plages.length; i++) {
        if (plages[i].debut < plages[i - 1].fin) return { ok: false, erreur: "Les plages horaires ne doivent pas se chevaucher." };
      }
      const duree = Number(d.dureeMinutes);
      if (!Number.isInteger(duree) || duree < 15 || duree > 480) return { ok: false, erreur: "Durée de créneau invalide (15 à 480 minutes)." };
      dec.plages = plages.map((p) => ({ debut: p.debut, fin: p.fin }));
      dec.dureeMinutes = duree;
      const nb = decouper({ decoupage: dec }).length;
      if (nb < 1) return { ok: false, erreur: "La durée choisie ne rentre dans aucune plage horaire." };
      if (nb > MAX_CRENEAUX_PAR_JOUR) return { ok: false, erreur: "Trop de créneaux par jour (" + nb + ", 24 maximum) : allongez la durée." };
    }
    out.decoupage = dec;
  }
  if ("capacite" in brut) {
    const c = Number(brut.capacite);
    if (!Number.isInteger(c) || c < 1 || c > 20) return { ok: false, erreur: "Capacité invalide (entier de 1 à 20)." };
    out.capacite = c;
  }
  if ("fermetures" in brut) {
    if (!Array.isArray(brut.fermetures) || brut.fermetures.length > 100) return { ok: false, erreur: "Fermetures invalides (100 maximum)." };
    const ferm = [];
    for (const f of brut.fermetures) {
      if (!f || !dateValide(f.du) || !dateValide(f.au) || f.du > f.au) return { ok: false, erreur: "Fermeture invalide : dates AAAA-MM-JJ, début avant fin." };
      ferm.push({ du: f.du, au: f.au, motif: String(f.motif || "").slice(0, 60) });
    }
    out.fermetures = ferm;
  }
  if ("joursFeries" in brut) out.joursFeries = brut.joursFeries === true;
  if ("delaiMinJours" in brut) {
    const n = Number(brut.delaiMinJours);
    if (!Number.isInteger(n) || n < 0 || n > 60) return { ok: false, erreur: "Délai minimum invalide (0 à 60 jours)." };
    out.delaiMinJours = n;
  }
  if ("horizonSemaines" in brut) {
    const n = Number(brut.horizonSemaines);
    if (!Number.isInteger(n) || n < 1 || n > 12) return { ok: false, erreur: "Horizon invalide (1 à 12 semaines)." };
    out.horizonSemaines = n;
  }
  if (!partiel) return { ok: true, reglages: fusionnerReglages(REGLAGES_DEFAUT, out) };
  return { ok: true, reglages: out };
}

// defaut <- client <- agence : l'agence REMPLACE champ par champ (decoupage fusionne cle par cle).
export function fusionnerReglages(defaut, client, agence) {
  const r = { ...defaut, ...(client || {}), ...(agence || {}) };
  r.decoupage = { ...(defaut.decoupage || {}), ...((client || {}).decoupage || {}), ...((agence || {}).decoupage || {}) };
  return r;
}

// Jour ouvert : travaille, ni ferie (si active), ni dans une fermeture.
export function jourOuvert(reglages, date) {
  if (!reglages.joursTravailles.includes(jourSemaine(date))) return false;
  if (reglages.joursFeries && joursFeriesFR(Number(date.slice(0, 4))).has(date)) return false;
  return !(reglages.fermetures || []).some((f) => date >= f.du && date <= f.au);
}

function formatHeure(hhmm) {
  const [h, m] = hhmm.split(":");
  return String(Number(h)) + "h" + m;
}
function minutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function hhmm(min) {
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}

// Decoupage d'une journee : [{ id, label }]. Phase 2 : mode "heures" -> libelles "9h00 - 10h00".
export function decouper(reglages) {
  const d = reglages.decoupage || {};
  if (d.mode === "heures") {
    const out = [];
    const duree = d.dureeMinutes || 60;
    (d.plages || []).forEach((p) => {
      for (let t = minutes(p.debut); t + duree <= minutes(p.fin); t += duree) {
        const debut = hhmm(t), fin = hhmm(t + duree);
        out.push({ id: debut + "-" + fin, label: formatHeure(debut) + " — " + formatHeure(fin) });
      }
    });
    return out;
  }
  return (d.periodes || ["matin", "apres_midi"]).filter((p) => PERIODES[p]).map((p) => ({ id: p, label: PERIODES[p].label }));
}

// Creneaux theoriques entre deux dates incluses : [{ date, id, label }].
export function creneauxTheoriques(reglages, du, au) {
  const out = [];
  const jour = decouper(reglages);
  for (let d = du; d <= au; d = ajouterJours(d, 1)) {
    if (!jourOuvert(reglages, d)) continue;
    jour.forEach((c) => out.push({ date: d, id: c.id, label: c.label }));
  }
  return out;
}

// Heure de debut (en minutes) d'un libelle "9h00 — 10h00", sinon null.
export function heureDebutLabel(label) {
  const m = /^\s*(\d{1,2})h(\d{2})/.exec(String(label || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function periodeDepuisLabel(label) {
  const t = String(label || "");
  if (t.indexOf("Après-midi") === 0 || t.indexOf("Apres-midi") === 0) return "apres_midi";
  if (t.indexOf("Matin") === 0) return "matin";
  const h = heureDebutLabel(t);
  if (h !== null) return h < 13 * 60 ? "matin" : "apres_midi";
  return null;
}

// ------------------------------------------------------------- acces Airtable

const verrous = new Set();
const couvertures = new Map(); // cle -> horodatage de la derniere verification complete
const cacheReglages = new Map(); // cle -> { t, valeur } (60 s) : evite une lecture de config a chaque appel
const DUREE_CACHE_REGLAGES_MS = 60 * 1000;
const DUREE_COUVERTURE_MS = 10 * 60 * 1000;

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function url(ctx, table, suite = "") {
  return "https://api.airtable.com/v0/" + ctx.baseId + "/" + encodeURIComponent(table) + suite;
}
function entetes(ctx, json = false) {
  return json ? { ...ctx.headers, "Content-Type": "application/json" } : { ...ctx.headers };
}
function maintenant(ctx) {
  return ctx.maintenant ? ctx.maintenant() : new Date();
}
function tempsRestant(ctx) {
  return ctx.finAt ? ctx.finAt - Date.now() : Infinity;
}
function clauseClient(ident) {
  return ident.demo ? 'ARRAYJOIN({Compte client})=""' : 'FIND("' + esc(ident.clientNom) + '", ARRAYJOIN({Compte client}))';
}
// L'enregistrement appartient-il bien a cette identite ? (lien verifie par ID)
function appartient(ident, rec) {
  const liens = (rec.fields && rec.fields["Compte client"]) || [];
  if (ident.demo) return liens.length === 0;
  return Array.isArray(liens) && liens.includes(ident.clientId);
}

async function lister(ctx, formule, { max = 1000 } = {}) {
  const out = [];
  let offset = null;
  do {
    let u = url(ctx, TABLE, "?filterByFormula=" + encodeURIComponent(formule) + "&pageSize=100&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=asc");
    if (offset) u += "&offset=" + encodeURIComponent(offset);
    const r = await fetch(u, { headers: entetes(ctx) });
    if (!r.ok) throw new Error("airtable " + r.status);
    const j = await r.json();
    (j.records || []).forEach((rec) => out.push(rec));
    offset = j.offset || null;
  } while (offset && out.length < max && tempsRestant(ctx) > 500);
  return out.slice(0, max);
}

// Identite depuis un identifiant client (rec...) : lit la fiche pour obtenir le nom.
export async function identDepuisClientId(ctx, clientId) {
  if (!clientId) return { demo: true };
  const r = await fetch(url(ctx, "Clients", "/" + encodeURIComponent(clientId)), { headers: entetes(ctx) });
  if (!r.ok) return null;
  const rec = await r.json();
  const nom = rec.fields && rec.fields["Nom client"];
  if (!nom) return null;
  return { clientId: rec.id, clientNom: String(nom).trim(), bloque: rec.fields["Accès bloqué"] === true };
}

// ---------------------------------------------------------------- reglages

function lireJson(texte) {
  try { return JSON.parse(texte || "{}"); } catch (e) { return {}; }
}

async function lignesConfig(ctx, ident) {
  const formule = 'AND({Date}="' + CLE_CONFIG + '",' + clauseClient(ident) + ")";
  const recs = await lister(ctx, formule, { max: 100 });
  return recs.filter((r) => appartient(ident, r));
}

// Reglages effectifs d'une agence : defaut (ou demo) <- client <- agence.
export async function reglagesPour(ctx, ident, agence) {
  const cleCache = (ident.demo ? "demo" : ident.clientId) + "|" + (agence || "");
  const enCache = cacheReglages.get(cleCache);
  if (!ctx.sansCache && enCache && Date.now() - enCache.t < DUREE_CACHE_REGLAGES_MS) return enCache.valeur;
  const base = ident.demo ? REGLAGES_DEMO : REGLAGES_DEFAUT;
  let lignes = [];
  try { lignes = await lignesConfig(ctx, ident); } catch (e) { lignes = []; }
  let client = {}, ag = {};
  lignes.forEach((l) => {
    const nom = l.fields && l.fields["Agence"];
    const v = validerReglages(lireJson(l.fields["Config JSON"]));
    if (!v.ok) return;
    if (!nom) client = v.reglages;
    else if (agence && nom === agence) ag = v.reglages;
  });
  const valeur = fusionnerReglages(base, client, ag);
  if (!ctx.sansCache) cacheReglages.set(cleCache, { t: Date.now(), valeur });
  return valeur;
}

// Lecture brute (pour l'editeur admin) : { client, agences: { nom: reglagesBruts } }.
export async function lireReglagesBruts(ctx, ident) {
  const lignes = await lignesConfig(ctx, ident);
  const out = { client: null, agences: {} };
  lignes.forEach((l) => {
    const nom = l.fields && l.fields["Agence"];
    const v = validerReglages(lireJson(l.fields["Config JSON"]));
    if (!v.ok) return;
    if (!nom) out.client = v.reglages; else out.agences[nom] = v.reglages;
  });
  return out;
}

// Enregistre (ou remplace) les reglages du client (agence = null) ou d'une agence.
export async function enregistrerReglages(ctx, ident, agence, brut) {
  const v = validerReglages(brut);
  if (!v.ok) return v;
  const lignes = await lignesConfig(ctx, ident);
  const existante = lignes.find((l) => ((l.fields && l.fields["Agence"]) || null) === (agence || null));
  const json = JSON.stringify(v.reglages);
  let r;
  if (existante) {
    r = await fetch(url(ctx, TABLE, "/" + existante.id), { method: "PATCH", headers: entetes(ctx, true), body: JSON.stringify({ fields: { "Config JSON": json } }) });
  } else {
    const fields = { "Date": CLE_CONFIG, "Config JSON": json };
    if (!ident.demo) fields["Compte client"] = [ident.clientId];
    if (agence) fields["Agence"] = agence;
    r = await fetch(url(ctx, TABLE), { method: "POST", headers: entetes(ctx, true), body: JSON.stringify({ records: [{ fields }], typecast: true }) });
  }
  if (!r.ok) return { ok: false, erreur: "Enregistrement impossible (Airtable " + r.status + ")." };
  cacheReglages.clear();
  couvertures.clear(); // de nouveaux reglages (jours, capacite...) imposent de reverifier la couverture
  return { ok: true, reglages: v.reglages };
}

// ---------------------------------------------------------------- generation

// Cree les creneaux manquants entre du et au pour une agence. Idempotent : compare a
// l'existant par (date, creneau) ; la capacite fixe le nombre de lignes par creneau.
// Retourne { crees, partiel, occupe }.
export async function assurerCreneaux(ctx, ident, agence, reglages, du, au, { maxCreations = 80 } = {}) {
  const cle = (ident.demo ? "demo" : ident.clientId) + "|" + agence;
  if (verrous.has(cle)) return { crees: 0, partiel: false, occupe: true };
  verrous.add(cle);
  try {
    const formule = 'AND({Agence}="' + esc(agence) + '",{Date}>="' + du + '",{Date}<="' + au + '",' + clauseClient(ident) + ")";
    const existants = (await lister(ctx, formule)).filter((r) => appartient(ident, r));
    const compte = new Map();
    existants.forEach((r) => {
      const k = r.fields["Date"] + "|" + r.fields["Créneau"];
      compte.set(k, (compte.get(k) || 0) + 1);
    });
    const aCreer = [];
    for (const c of creneauxTheoriques(reglages, du, au)) {
      const manque = reglages.capacite - (compte.get(c.date + "|" + c.label) || 0);
      for (let i = 0; i < manque; i++) aCreer.push(c);
    }
    let crees = 0;
    let partiel = false;
    for (let i = 0; i < aCreer.length; i += 10) {
      if (crees >= maxCreations || tempsRestant(ctx) < 1500) { partiel = true; break; }
      const lot = aCreer.slice(i, i + 10).map((c) => {
        const fields = { "Date": c.date, "Créneau": c.label, "Agence": agence, "Statut": "Libre" };
        if (!ident.demo) fields["Compte client"] = [ident.clientId];
        return { fields };
      });
      const r = await fetch(url(ctx, TABLE), { method: "POST", headers: entetes(ctx, true), body: JSON.stringify({ records: lot, typecast: true }) });
      if (!r.ok) throw new Error("airtable creation " + r.status);
      crees += lot.length;
    }
    return { crees, partiel, occupe: false };
  } finally {
    verrous.delete(cle);
  }
}

// Supprime des creneaux LIBRES PASSES du client (jamais Pris ni Bloques, jamais la demo).
export async function purgerPasses(ctx, ident, aujourdhui, { max = 20 } = {}) {
  if (ident.demo) return 0;
  const formule = 'AND({Statut}="Libre",{Date}<"' + aujourdhui + '",{Date}>="2000-01-01",' + clauseClient(ident) + ")";
  const anciens = (await lister(ctx, formule, { max })).filter((r) => appartient(ident, r) && r.fields["Statut"] === "Libre" && r.fields["Date"] < aujourdhui);
  let supprimes = 0;
  for (let i = 0; i < anciens.length; i += 10) {
    if (tempsRestant(ctx) < 1500) break;
    const lot = anciens.slice(i, i + 10);
    const q = lot.map((r) => "records%5B%5D=" + encodeURIComponent(r.id)).join("&");
    const r = await fetch(url(ctx, TABLE, "?" + q), { method: "DELETE", headers: entetes(ctx) });
    if (!r.ok) break;
    supprimes += lot.length;
  }
  return supprimes;
}

// Fenetre a couvrir selon la demande (mois / date / horizon par defaut).
function fenetre(reglages, aujourdhui, { mois, date, du, au, admin }) {
  if (date && dateValide(date)) return { du: date, au: date };
  if (admin && du && au && dateValide(du) && dateValide(au) && du <= au) return { du, au: au > ajouterJours(aujourdhui, 366) ? ajouterJours(aujourdhui, 366) : au };
  const debutMin = admin ? aujourdhui : ajouterJours(aujourdhui, reglages.delaiMinJours);
  if (mois && /^\d{4}-\d{2}$/.test(mois)) {
    const debutMois = mois + "-01";
    const finMois = ajouterJours(depuisUtc(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 1)), -1);
    const limite = ajouterJours(aujourdhui, 366);
    return { du: debutMois > debutMin ? debutMois : debutMin, au: finMois > limite ? limite : finMois };
  }
  return { du: debutMin, au: ajouterJours(aujourdhui, reglages.horizonSemaines * 7) };
}

// Point d'entree des lecteurs : genere si besoin, puis renvoie les creneaux LIBRES
// [{ id, date, creneau }] tries par date. options : agence, periode (matin|apres_midi),
// creneau (libelle), mois, date, du/au + admin (sans delai minimum, pour le tableau de bord).
export async function creneauxLibres(ctx, ident, options) {
  const { agence } = options;
  if (!agence) return { creneaux: [], partiel: false };
  const reglages = await reglagesPour(ctx, ident, agence);
  const aujourdhui = aujourdhuiParis(maintenant(ctx));
  const f = fenetre(reglages, aujourdhui, options);
  // Delai minimum du client : jamais contourne par un parametre (date, mois...), sauf mode admin
  // (tableau de bord) qui n'est jamais anterieur a aujourd'hui.
  const minimum = options.admin ? aujourdhui : ajouterJours(aujourdhui, reglages.delaiMinJours);
  if (f.du < minimum) f.du = minimum;
  if (f.du > f.au) return { creneaux: [], partiel: false, delaiMinJours: reglages.delaiMinJours };
  const modeHeures = (reglages.decoupage || {}).mode === "heures";
  const labelsJour = decouper(reglages).map((c) => c.label);
  // En mode heures, un libelle exact demande ("9h00 — 10h00") filtre ce creneau precis ;
  // sinon matin / apres-midi se deduisent de l'heure de debut.
  const labelExact = modeHeures && options.creneau && labelsJour.includes(String(options.creneau)) ? String(options.creneau) : null;
  const periode = options.periode || (labelExact ? null : periodeDepuisLabel(options.creneau));
  let partiel = false;

  const cleCouv = (ident.demo ? "demo" : ident.clientId) + "|" + agence + "|" + f.du + "|" + f.au;
  const recent = !ctx.sansCache && couvertures.get(cleCouv) && Date.now() - couvertures.get(cleCouv) < DUREE_COUVERTURE_MS;
  if (!recent && f.du <= f.au) {
    try {
      if (!ident.demo) await purgerPasses(ctx, ident, aujourdhui);
      const g = await assurerCreneaux(ctx, ident, agence, reglages, f.du, f.au);
      partiel = g.partiel || g.occupe;
      if (!partiel) couvertures.set(cleCouv, Date.now());
    } catch (e) {
      console.error("planning generation:", e && e.message);
    }
  }

  let formule = 'AND({Statut}="Libre",{Agence}="' + esc(agence) + '",{Date}>="' + f.du + '",{Date}<="' + f.au + '"';
  if (labelExact) formule += ',{Créneau}="' + esc(labelExact) + '"';
  else if (periode && PERIODES[periode] && !modeHeures) formule += ',{Créneau}="' + esc(PERIODES[periode].label) + '"';
  formule += "," + clauseClient(ident) + ")";
  let recs = (await lister(ctx, formule, { max: options.max || 600 })).filter((r) => appartient(ident, r) && r.fields["Statut"] === "Libre");
  if (modeHeures) {
    // Seuls les creneaux du decoupage ACTUEL sont proposes (d'anciennes lignes "Matin" /
    // "Apres-midi" ou d'une autre duree restent en base mais ne sont plus offertes).
    const valides = new Set(labelsJour);
    recs = recs.filter((r) => valides.has(r.fields["Créneau"]));
    if (periode && !labelExact) {
      recs = recs.filter((r) => {
        const h = heureDebutLabel(r.fields["Créneau"]);
        return h !== null && (periode === "matin" ? h < 13 * 60 : h >= 13 * 60);
      });
    }
  }
  // Un jour ferme / ferie / non travaille apres coup n'est jamais propose, meme si la ligne existe.
  const creneaux = recs
    .filter((r) => r.fields["Date"] && dateValide(r.fields["Date"]) && jourOuvert(reglages, r.fields["Date"]))
    .map((r) => ({ id: r.id, date: r.fields["Date"], creneau: r.fields["Créneau"] || "" }));
  return { creneaux, partiel, delaiMinJours: reglages.delaiMinJours };
}

// "Creer son IKO" : enregistre les reglages par defaut du client s'ils n'existent pas,
// puis genere un premier horizon COURT (le reste se genere a la demande).
export async function initialiserPlanning(ctx, ident, agences, { jours = 14 } = {}) {
  const resultat = { reglagesCrees: false, creneauxCrees: 0, partiel: false };
  const lignes = await lignesConfig(ctx, ident);
  if (!lignes.some((l) => !(l.fields && l.fields["Agence"]))) {
    const r = await enregistrerReglages(ctx, ident, null, { ...REGLAGES_DEFAUT });
    resultat.reglagesCrees = r.ok === true;
  }
  const aujourdhui = aujourdhuiParis(maintenant(ctx));
  for (const agence of agences) {
    const reglages = await reglagesPour(ctx, ident, agence);
    const du = ajouterJours(aujourdhui, reglages.delaiMinJours);
    const g = await assurerCreneaux(ctx, ident, agence, reglages, du, ajouterJours(du, jours), { maxCreations: 120 });
    resultat.creneauxCrees += g.crees;
    if (g.partiel || g.occupe) resultat.partiel = true;
  }
  return resultat;
}
