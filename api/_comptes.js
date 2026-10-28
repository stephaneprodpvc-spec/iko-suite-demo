// api/_comptes.js — comptes des clients : creation en serie (une agence = un compte) et nouveau mot de passe temporaire.
// Appele depuis api/verif-securite.js (pas une fonction Vercel : fichier prefixe par "_"). Les dependances sont
// passees en parametre (ctx) pour eviter tout import circulaire. Aucun mot de passe n'est journalise.
//
// Champs Airtable OPTIONNELS de la table Utilisateurs : « Agence » et « Nom » (texte). S'ils n'existent pas encore,
// la creation retombe automatiquement sur les champs de base (reponse : champsAgence=false) : rien ne casse.

const ROLES = ["TENANT_ADMIN", "TECHNICIEN", "COMMERCIAL", "CLIENT"];
const MAX_PAR_APPEL = 8; // bcrypt (12 tours) ~0,3 s par compte : reste sous la limite de 10 s de Vercel Hobby

const propre = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);

async function inconnuChamp(r) {
  if (r.status !== 422) return false;
  try { const j = await r.clone().json(); return /UNKNOWN_FIELD_NAME|Unknown field/i.test(JSON.stringify(j)); } catch (e) { return false; }
}

export async function gererCreerComptes(req, res, ctx) {
  if (!ctx.exigerSuperAdmin(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  const { clientId, comptes } = req.body || {};
  if (typeof clientId !== "string" || !/^rec[A-Za-z0-9]{14}$/.test(clientId)) return res.status(400).json({ erreur: "Client invalide." });
  if (!Array.isArray(comptes) || comptes.length < 1 || comptes.length > MAX_PAR_APPEL) {
    return res.status(400).json({ erreur: "Entre 1 et " + MAX_PAR_APPEL + " comptes par envoi." });
  }
  const base = "https://api.airtable.com/v0/" + ctx.AIRTABLE_BASE + "/";
  try {
    const rT = await fetch(base + "Clients/" + clientId, { headers: ctx.airtableHeaders() });
    if (!rT.ok) return res.status(400).json({ erreur: "Client introuvable." });
  } catch (e) { return res.status(502).json({ erreur: "Lecture du client impossible." }); }

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
    const poster = (corps) => fetch(base + encodeURIComponent(ctx.UTILISATEURS_TABLE), { method: "POST", headers: ctx.airtableHeaders(), body: corps });
    try {
      let r = await poster(fabriquer(true));
      if (!r.ok && await inconnuChamp(r)) { champsAgence = false; r = await poster(fabriquer(false)); }
      if (!r.ok) { console.error("creer_comptes HTTP", r.status); return res.status(502).json({ erreur: "Création des comptes impossible. Rien n'a été créé ; relance possible.", ignores }); }
    } catch (e) { console.error("creer_comptes erreur:", e && e.message); return res.status(502).json({ erreur: "Création des comptes impossible. Relance possible.", ignores }); }
    for (const a of aEcrire) crees.push({ identifiant: a.identifiant, role: a.role, agence: a.agence, nom: a.nom, motDePasseTemporaire: a.temporaire ? a.mdp : null });
  }
  return res.status(200).json({ ok: true, crees, ignores, champsAgence });
}

// Re-controle du mot de passe du super administrateur connecte (avant d'afficher un secret).
async function verifierAdmin(session, saisi, ctx) {
  if (!saisi) return false;
  if (session.userId === "demo") return ctx.motDePasseUniqueValide(saisi);
  try {
    const r = await fetch("https://api.airtable.com/v0/" + ctx.AIRTABLE_BASE + "/" + encodeURIComponent(ctx.UTILISATEURS_TABLE) + "/" + encodeURIComponent(session.userId), { headers: ctx.airtableHeaders() });
    if (!r.ok) return false;
    const hash = ((await r.json()).fields || {})["Hash mot de passe"] || "";
    return hash ? await ctx.bcrypt.compare(String(saisi), hash) : false;
  } catch (e) { return false; }
}

export async function gererRegenererMotDePasse(req, res, ctx) {
  const session = ctx.exigerSuperAdmin(req, res);
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  if (!ctx.verifierDebit(req, { max: 6, fenetreMs: 10 * 60 * 1000, cle: "regen-mdp" })) return res.status(429).json({ erreur: "Trop de tentatives. Réessaie dans quelques minutes." });
  const { identifiant, motDePasseAdmin } = req.body || {};
  if (!identifiant) return res.status(400).json({ erreur: "Identifiant requis." });
  if (!(await verifierAdmin(session, motDePasseAdmin, ctx))) {
    ctx.signalerAbus(req, "connexion-echouee");
    return res.status(403).json({ erreur: "Ton mot de passe de super administrateur est incorrect." });
  }
  const user = await ctx.lireUtilisateurParIdentifiant(String(identifiant));
  if (!user) return res.status(404).json({ erreur: "Utilisateur introuvable." });
  if (user.role === "SUPER_ADMIN_IKO") return res.status(400).json({ erreur: "Un compte super administrateur ne se réinitialise pas ici : utilise « changer le mot de passe »." });
  const temporaire = ctx.genererMotDePasseTemporaire();
  await ctx.majUtilisateur(user.userId, {
    "Hash mot de passe": await ctx.bcrypt.hash(temporaire, 12), "Échecs de connexion": 0, "Bloqué jusqu'à": null, "Dernier tokenId refresh valide": null,
  });
  return res.status(200).json({ ok: true, identifiant: user.identifiant, motDePasseTemporaire: temporaire });
}
