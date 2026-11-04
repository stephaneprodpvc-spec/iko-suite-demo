// api/_mdp-oublie.js — « Mot de passe oublié » sans e-mail ni service payant.
// La personne bloquée demande depuis la page de connexion ; la demande est gardée dans la configuration (Planning > CONFIG,
// champ « Config JSON », clé demandesMdp : aucun enregistrement Airtable de plus). Le patron la voit dans « Mes accès »
// (api/_comptes.js) et renvoie un mot de passe temporaire en un clic ; la demande disparaît à ce moment-là.
// Appelé depuis api/verif-securite.js (pas une fonction Vercel : fichier préfixé par « _ »).
// Sécurité : réponse IDENTIQUE que le compte existe ou non (pas de liste d'identifiants), aucun secret échangé,
// un compte « super administrateur » n'est jamais concerné, liste plafonnée, demandes périmées au bout de 7 jours.

const CONFIG_RECORD_ID = "rec45X231n9dXnyaU";
const DUREE_DEMANDE_MS = 7 * 24 * 3600 * 1000;
const MAX_DEMANDES = 40;
export const MESSAGE_DEMANDE = "Si ce compte existe, ta demande est transmise à ton responsable. Il te donnera un nouveau mot de passe.";

const propre = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const urlConfig = (ctx) => "https://api.airtable.com/v0/" + ctx.AIRTABLE_BASE + "/Planning/" + CONFIG_RECORD_ID;

async function lireConfig(ctx) {
  const r = await fetch(urlConfig(ctx), { headers: ctx.airtableHeaders() });
  if (!r.ok) return null;
  const j = await r.json();
  try { const c = JSON.parse((j.fields && j.fields["Config JSON"]) || "{}"); return c && typeof c === "object" ? c : {}; } catch (e) { return {}; }
}
async function ecrireConfig(ctx, c) {
  const r = await fetch(urlConfig(ctx), { method: "PATCH", headers: ctx.airtableHeaders(), body: JSON.stringify({ fields: { "Config JSON": JSON.stringify(c) } }) });
  return r.ok;
}
function demandesValides(c, maintenant) {
  const liste = Array.isArray(c && c.demandesMdp) ? c.demandesMdp : [];
  return liste.filter((d) => d && typeof d.id === "string" && Number.isFinite(d.quand) && maintenant - d.quand < DUREE_DEMANDE_MS);
}

// Public : POST { action: "mdp_oublie", identifiant }. Répond toujours la même chose quand l'identifiant est bien formé.
export async function gererDemandeMotDePasse(req, res, ctx) {
  res.setHeader("Cache-Control", "no-store");
  const identifiant = propre(req.body && req.body.identifiant, 120);
  if (identifiant.length < 3) return res.status(400).json({ erreur: "Saisis ton identifiant." });
  try {
    const user = await ctx.lireUtilisateurParIdentifiant(identifiant);
    if (user && user.statut === "Actif" && user.role !== "SUPER_ADMIN_IKO") {
      const c = await lireConfig(ctx);
      if (c) {
        const maintenant = Date.now();
        const cle = String(user.identifiant || identifiant).toLowerCase();
        const autres = demandesValides(c, maintenant).filter((d) => d.id !== cle);
        c.demandesMdp = autres.concat([{ id: cle, quand: maintenant }]).slice(-MAX_DEMANDES);
        await ecrireConfig(ctx, c);
      }
    }
  } catch (e) { /* la réponse reste la même : rien n'est révélé */ }
  return res.status(200).json({ ok: true, message: MESSAGE_DEMANDE });
}

// Identifiants (en minuscules) qui ont une demande en attente. Ne lève jamais d'exception.
export async function demandesEnAttente(ctx) {
  try {
    const c = await lireConfig(ctx);
    return new Set(demandesValides(c, Date.now()).map((d) => d.id));
  } catch (e) { return new Set(); }
}

// Retire la demande d'un identifiant (appelé quand un nouveau mot de passe vient d'être remis). Ne lève jamais d'exception.
export async function effacerDemande(ctx, identifiant) {
  try {
    const cle = String(identifiant || "").toLowerCase();
    const c = await lireConfig(ctx);
    if (!c || !Array.isArray(c.demandesMdp)) return;
    const reste = demandesValides(c, Date.now()).filter((d) => d.id !== cle);
    if (reste.length === c.demandesMdp.length) return;
    c.demandesMdp = reste;
    await ecrireConfig(ctx, c);
  } catch (e) { /* sans gravité */ }
}
