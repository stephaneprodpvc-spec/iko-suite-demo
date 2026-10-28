// api/_comptes.js — comptes des clients : creation en serie (une agence = un compte), nouveau mot de passe temporaire,
// et « Mes acces » du patron (il cree et gere LUI-MEME les acces de son equipe, jamais ceux d'un autre client).
// Appele depuis api/verif-securite.js (pas une fonction Vercel : fichier prefixe par "_"). Les dependances sont
// passees en parametre (ctx) pour eviter tout import circulaire. Aucun mot de passe n'est journalise.
//
// Champs Airtable OPTIONNELS de la table Utilisateurs : « Agence » et « Nom » (texte). S'ils n'existent pas encore,
// la creation retombe automatiquement sur les champs de base (reponse : champsAgence=false) : rien ne casse.

const ROLES = ["TENANT_ADMIN", "TECHNICIEN", "COMMERCIAL", "CLIENT"];
const ROLES_EQUIPE = ["TENANT_ADMIN", "TECHNICIEN"]; // ce qu'un patron peut creer : responsable d'agence ou technicien
const MAX_PAR_APPEL = 8; // bcrypt (12 tours) ~0,3 s par compte : reste sous la limite de 10 s de Vercel Hobby

const propre = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const memeNom = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const urlTable = (ctx, suite) => "https://api.airtable.com/v0/" + ctx.AIRTABLE_BASE + "/" + suite;

async function inconnuChamp(r) {
  if (r.status !== 422) return false;
  try { const j = await r.clone().json(); return /UNKNOWN_FIELD_NAME|Unknown field/i.test(JSON.stringify(j)); } catch (e) { return false; }
}

// Coeur commun : valide chaque demande, hache, ecrit par lot. Retourne { status, json }.
async function creer(ctx, clientId, comptes) {
  const crees = [], ignores = [], aEcrire = [];
  const vus = new Set();
  for (const c of comptes) {
    const identifiant = propre(c && c.identifiant, 120);
    const role = c && c.role;
    const agence = propre(c && c.agence, 80), nom = propre(c && c.nom, 80);
    if (identifiant.length < 3) { ignores.push({ identifiant, raison: "Identifiant trop court." }); continue; }
    if (!ROLES.includes(role)) { ignores.push({ identifiant, raison: "Rôle invalide." }); continue; }
    if (vus.has(identifiant.toLowerCase())) { ignores.push({ identifiant, raison: "Identifiant en double dans la liste." }); continue; }
    vus.add(identifiant.toLowerCase());
    let mdp, temporaire = false;
    if (c.aleatoire === true) { mdp = ctx.genererMotDePasseTemporaire(); temporaire = true; }
    else {
      mdp = String(c.motDePasse || "");
      const refus = ctx.evaluerMotDePasse(mdp, identifiant);
      if (refus) { ignores.push({ identifiant, raison: refus }); continue; }
    }
    if (await ctx.lireUtilisateurParIdentifiant(identifiant)) { ignores.push({ identifiant, raison: "Cet identifiant existe déjà." }); continue; }
    aEcrire.push({ identifiant, role, agence, nom, mdp, temporaire, hash: await ctx.bcrypt.hash(mdp, 12) });
  }

  let champsAgence = true;
  if (aEcrire.length) {
    const fabriquer = (avecAgence) => JSON.stringify({ records: aEcrire.map((a) => ({ fields: Object.assign({
      "Identifiant": a.identifiant, "Hash mot de passe": a.hash, "tenantId": [clientId], "Rôle": a.role, "Statut": "Actif", "Échecs de connexion": 0,
    }, avecAgence ? Object.assign(a.agence ? { "Agence": a.agence } : {}, a.nom ? { "Nom": a.nom } : {}) : {}) })) });
    const poster = (corps) => fetch(urlTable(ctx, encodeURIComponent(ctx.UTILISATEURS_TABLE)), { method: "POST", headers: ctx.airtableHeaders(), body: corps });
    try {
      let r = await poster(fabriquer(true));
      if (!r.ok && await inconnuChamp(r)) { champsAgence = false; r = await poster(fabriquer(false)); }
      if (!r.ok) { console.error("creer_comptes HTTP", r.status); return { status: 502, json: { erreur: "Création des comptes impossible. Rien n'a été créé ; relance possible.", ignores } }; }
    } catch (e) { console.error("creer_comptes erreur:", e && e.message); return { status: 502, json: { erreur: "Création des comptes impossible. Relance possible.", ignores } }; }
    for (const a of aEcrire) crees.push({ identifiant: a.identifiant, role: a.role, agence: a.agence, nom: a.nom, motDePasseTemporaire: a.temporaire ? a.mdp : null });
  }
  return { status: 200, json: { ok: true, crees, ignores, champsAgence } };
}

function formatClient(clientId, comptes) {
  if (typeof clientId !== "string" || !/^rec[A-Za-z0-9]{14}$/.test(clientId)) return "Client invalide.";
  if (!Array.isArray(comptes) || comptes.length < 1 || comptes.length > MAX_PAR_APPEL) return "Entre 1 et " + MAX_PAR_APPEL + " comptes par envoi.";
  return null;
}

// --- Super administrateur : tous les clients ---
export async function gererCreerComptes(req, res, ctx) {
  if (!ctx.exigerSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  const { clientId, comptes } = req.body || {};
  const erreur = formatClient(clientId, comptes);
  if (erreur) return res.status(400).json({ erreur });
  try {
    const rT = await fetch(urlTable(ctx, "Clients/" + clientId), { headers: ctx.airtableHeaders() });
    if (!rT.ok) return res.status(400).json({ erreur: "Client introuvable." });
  } catch (e) { return res.status(502).json({ erreur: "Lecture du client impossible." }); }
  const r = await creer(ctx, clientId, comptes);
  return res.status(r.status).json(r.json);
}

// Session d'un patron : TENANT_ADMIN sans agence, rattache a un client. Le client vient TOUJOURS de la session.
function sessionPatron(req, res, ctx) {
  const s = ctx.verifierSession(req);
  if (!s || s.mdpAChanger || s.role !== "TENANT_ADMIN" || s.agence || !s.tenantId || s.userId === "demo") {
    res.status(403).json({ erreur: "Réservé au responsable de l'entreprise (compte personnel, sans agence)." });
    return null;
  }
  return s;
}

async function agencesDuClient(ctx, tenantId) {
  const rc = await fetch(urlTable(ctx, "Clients/" + tenantId), { headers: ctx.airtableHeaders() });
  if (!rc.ok) return null;
  const nomClient = ((await rc.json()).fields || {})["Nom client"];
  if (!nomClient) return null;
  const formule = 'FIND("' + String(nomClient).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '", ARRAYJOIN({Client}))';
  const ra = await fetch(urlTable(ctx, "Agences?pageSize=50&filterByFormula=" + encodeURIComponent(formule)), { headers: ctx.airtableHeaders() });
  if (!ra.ok) return null;
  return ((await ra.json()).records || []).filter((a) => (a.fields || {})["Client"] ? [].concat(a.fields["Client"]).includes(tenantId) : true).map((a) => (a.fields || {})["Nom agence"]).filter(Boolean);
}

// --- Patron : « Mes acces » — creer les acces de SON equipe (mots de passe temporaires) ---
export async function gererCreerComptesEquipe(req, res, ctx) {
  const s = sessionPatron(req, res, ctx); if (!s) return;
  res.setHeader("Cache-Control", "no-store");
  if (!ctx.verifierDebit(req, { max: 15, fenetreMs: 10 * 60 * 1000, cle: "equipe-creer" })) return res.status(429).json({ erreur: "Trop de tentatives. Réessaie dans quelques minutes." });
  const { comptes } = req.body || {};
  const erreur = formatClient(s.tenantId, comptes);
  if (erreur) return res.status(400).json({ erreur });
  let noms;
  try { noms = await agencesDuClient(ctx, s.tenantId); } catch (e) { noms = null; }
  if (!noms) return res.status(502).json({ erreur: "Lecture des agences impossible." });
  const aCreer = [], ignores = [];
  for (const c of comptes) {
    const agence = propre(c && c.agence, 80);
    const ref = noms.find((n) => memeNom(n, agence));
    if (!ROLES_EQUIPE.includes(c && c.role)) { ignores.push({ identifiant: propre(c && c.identifiant, 120), raison: "Rôle non autorisé." }); continue; }
    if (!ref) { ignores.push({ identifiant: propre(c && c.identifiant, 120), raison: "Cette agence n'existe pas dans votre entreprise." }); continue; }
    aCreer.push({ identifiant: c.identifiant, role: c.role, agence: ref, nom: c.nom, aleatoire: true });
  }
  const r = aCreer.length ? await creer(ctx, s.tenantId, aCreer) : { status: 200, json: { ok: true, crees: [], ignores: [], champsAgence: true } };
  if (r.status === 200) r.json.ignores = ignores.concat(r.json.ignores || []);
  return res.status(r.status).json(r.json);
}

// --- Patron : liste de son equipe (sans aucun secret) ---
export async function gererListerEquipe(req, res, ctx) {
  const s = sessionPatron(req, res, ctx); if (!s) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    const rc = await fetch(urlTable(ctx, "Clients/" + s.tenantId), { headers: ctx.airtableHeaders() });
    const nomClient = rc.ok ? ((await rc.json()).fields || {})["Nom client"] : null;
    if (!nomClient) return res.status(502).json({ erreur: "Lecture impossible." });
    const formule = 'FIND("' + String(nomClient).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '", ARRAYJOIN({tenantId}))';
    const r = await fetch(urlTable(ctx, encodeURIComponent(ctx.UTILISATEURS_TABLE) + "?pageSize=100&filterByFormula=" + encodeURIComponent(formule)), { headers: ctx.airtableHeaders() });
    if (!r.ok) return res.status(502).json({ erreur: "Lecture impossible." });
    const equipe = ((await r.json()).records || [])
      .filter((u) => [].concat((u.fields || {})["tenantId"] || []).includes(s.tenantId))
      .map((u) => { const f = u.fields || {}; return { identifiant: f["Identifiant"] || "", role: f["Rôle"] || "", agence: f["Agence"] || "", nom: f["Nom"] || "", actif: (f["Statut"] || "Actif") === "Actif", derniereConnexion: f["Dernière connexion"] || null, moi: u.id === s.userId }; });
    return res.status(200).json({ ok: true, equipe });
  } catch (e) { return res.status(502).json({ erreur: "Lecture impossible." }); }
}

// Re-controle du mot de passe de la personne connectee (avant d'afficher un secret ou de couper un acces).
async function verifierMoi(session, saisi, ctx) {
  if (!saisi) return false;
  if (session.userId === "demo") return ctx.motDePasseUniqueValide(saisi);
  try {
    const r = await fetch(urlTable(ctx, encodeURIComponent(ctx.UTILISATEURS_TABLE) + "/" + encodeURIComponent(session.userId)), { headers: ctx.airtableHeaders() });
    if (!r.ok) return false;
    const hash = ((await r.json()).fields || {})["Hash mot de passe"] || "";
    return hash ? await ctx.bcrypt.compare(String(saisi), hash) : false;
  } catch (e) { return false; }
}

// Peut-on agir sur ce compte ? Super admin : tout sauf un autre super admin. Patron : seulement son equipe (technicien, responsable d'agence).
function cibleAutorisee(session, user) {
  if (!user) return "Utilisateur introuvable.";
  if (user.role === "SUPER_ADMIN_IKO") return "Un compte super administrateur ne se gère pas ici.";
  if (session.role === "SUPER_ADMIN_IKO") return null;
  if (session.role === "TENANT_ADMIN" && !session.agence && session.tenantId && user.tenantId === session.tenantId) {
    if (user.userId === session.userId) return "Pour ton propre mot de passe, utilise « changer le mot de passe ».";
    if (user.role === "TENANT_ADMIN" && !user.agence) return "Ce compte est celui d'un autre responsable d'entreprise : il ne se gère pas ici.";
    return null;
  }
  return "Utilisateur introuvable."; // jamais de detail sur l'existence d'un compte d'un autre client
}

function sessionGestion(req, res, ctx) {
  const s = ctx.verifierSession(req);
  const ok = s && !s.mdpAChanger && ((s.role === "SUPER_ADMIN_IKO") || (s.role === "TENANT_ADMIN" && !s.agence && s.tenantId && s.userId !== "demo"));
  if (!ok) { res.status(403).json({ erreur: "Accès refusé : droits administrateur requis." }); return null; }
  return s;
}

export async function gererRegenererMotDePasse(req, res, ctx) {
  const session = sessionGestion(req, res, ctx);
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  if (!ctx.verifierDebit(req, { max: 6, fenetreMs: 10 * 60 * 1000, cle: "regen-mdp" })) return res.status(429).json({ erreur: "Trop de tentatives. Réessaie dans quelques minutes." });
  const { identifiant, motDePasseAdmin } = req.body || {};
  if (!identifiant) return res.status(400).json({ erreur: "Identifiant requis." });
  if (!(await verifierMoi(session, motDePasseAdmin, ctx))) {
    ctx.signalerAbus(req, "connexion-echouee");
    return res.status(403).json({ erreur: "Ton mot de passe est incorrect." });
  }
  const user = await ctx.lireUtilisateurParIdentifiant(String(identifiant));
  const refus = cibleAutorisee(session, user);
  if (refus) return res.status(session.role === "SUPER_ADMIN_IKO" && user ? 400 : 404).json({ erreur: refus });
  const temporaire = ctx.genererMotDePasseTemporaire();
  await ctx.majUtilisateur(user.userId, {
    "Hash mot de passe": await ctx.bcrypt.hash(temporaire, 12), "Échecs de connexion": 0, "Bloqué jusqu'à": null, "Dernier tokenId refresh valide": null,
  });
  return res.status(200).json({ ok: true, identifiant: user.identifiant, motDePasseTemporaire: temporaire });
}

// Activer / couper l'acces d'un membre de l'equipe (le compte n'est pas supprime).
export async function gererStatutCompte(req, res, ctx) {
  const session = sessionGestion(req, res, ctx);
  if (!session) return;
  const { identifiant, actif } = req.body || {};
  if (!identifiant || typeof actif !== "boolean") return res.status(400).json({ erreur: "Identifiant et état requis." });
  const user = await ctx.lireUtilisateurParIdentifiant(String(identifiant));
  const refus = cibleAutorisee(session, user);
  if (refus) return res.status(404).json({ erreur: refus });
  await ctx.majUtilisateur(user.userId, actif ? { "Statut": "Actif" } : { "Statut": "Bloqué", "Dernier tokenId refresh valide": null });
  return res.status(200).json({ ok: true });
}
