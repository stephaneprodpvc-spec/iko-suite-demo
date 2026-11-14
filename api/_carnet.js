// api/_carnet.js
// Carnet d'un produit posé : le QR code collé sur la menuiserie contient un jeton chiffré (AES-256-GCM) qui porte
// le produit, la date de pose, le poseur et la durée de garantie. Aucune écriture Airtable (le quota gratuit est limité),
// jeton infalsifiable : personne ne peut rallonger sa garantie en modifiant le lien.
// Fichier préfixé « _ » : helper partagé, PAS une fonction Vercel (plafond 12).

import crypto from "crypto";
import { verifierDebit, verifierOrigine } from "./_securite.js";
import { signalerAbus } from "./_abus.js";
import { baseLien } from "./_suivi.js";

const DUREE_VALIDITE_MS = 25 * 365 * 24 * 3600 * 1000; // la vie d'une menuiserie

function cle() {
  const secret = process.env.CARNET_TOKEN_SECRET || process.env.SUIVI_TOKEN_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret) return null;
  return crypto.createHash("sha256").update("iko-carnet-v1:" + secret).digest();
}

// Texte libre : sans caractères de contrôle ni balises, longueur limitée.
function propre(v, max) {
  return String(v === undefined || v === null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function dateIsoValide(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1) return "";
  if (+m[1] < 1990 || d.getTime() > Date.now() + 2 * 24 * 3600 * 1000) return ""; // pas de pose dans le futur
  return String(v);
}

// Entrée : { produit, reference, datePose, poseur, garantieAns, slug, entreprise }. Retourne { jeton } ou { erreur }.
export function creerCarnet(entree) {
  const k = cle();
  if (!k) return { erreur: "Configuration serveur incomplète." };
  const produit = propre(entree.produit, 80);
  const datePose = dateIsoValide(entree.datePose);
  const slug = /^[A-Za-z0-9_-]{1,80}$/.test(String(entree.slug || "")) ? String(entree.slug) : "";
  const garantie = Math.round(Number(entree.garantieAns === undefined || entree.garantieAns === "" ? 2 : entree.garantieAns));
  if (!produit) return { erreur: "Indiquez le produit posé." };
  if (!datePose) return { erreur: "Date de pose invalide (elle ne peut pas être dans le futur)." };
  if (!slug) return { erreur: "Entreprise non identifiée." };
  if (!(garantie >= 0 && garantie <= 30)) return { erreur: "Durée de garantie invalide (0 à 30 ans)." };
  const charge = { p: produit, r: propre(entree.reference, 40), d: datePose, o: propre(entree.poseur, 80), g: garantie, s: slug, e: propre(entree.entreprise, 80), x: Date.now() + DUREE_VALIDITE_MS };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const chiffre = Buffer.concat([c.update(JSON.stringify(charge), "utf8"), c.final()]);
  return { jeton: Buffer.concat([iv, c.getAuthTag(), chiffre]).toString("base64url") };
}

// Ajoute n années à une date AAAA-MM-JJ (29 février -> 28 février des années non bissextiles).
function ajouterAnnees(iso, n) {
  const [a, m, j] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(a + n, m - 1, j));
  if (d.getUTCMonth() !== m - 1) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

// Retourne les données du carnet + l'état de la garantie calculé MAINTENANT, ou null (jeton faux, falsifié ou expiré).
export function lireCarnet(jeton, maintenant) {
  const k = cle();
  if (!k || typeof jeton !== "string" || jeton.length < 40 || jeton.length > 900) return null;
  try {
    const buf = Buffer.from(jeton, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const p = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
    if (!p || !p.p || !p.d || !p.s || (p.x && p.x < Date.now())) return null;
    const garantieJusqu = ajouterAnnees(p.d, p.g || 0);
    const aujourdhui = (maintenant ? new Date(maintenant) : new Date()).toISOString().slice(0, 10);
    return { produit: p.p, reference: p.r || "", datePose: p.d, poseur: p.o || "", garantieAns: p.g || 0, slug: p.s, entreprise: p.e || "", garantieJusqu, sousGarantie: aujourdhui <= garantieJusqu };
  } catch (e) {
    return null;
  }
}

// ---- Route /api/airtable/carnet (POST), branchée dans airtable-proxy.js ----
//   { action: "creer", produit, reference, datePose, poseur, garantieAns } : session connectée obligatoire ; l'entreprise
//        (slug) vient de la session, jamais du navigateur -> { jeton, url }
//   { action: "lire", c } : publique (le client scanne le QR), limitée en débit -> données du carnet + état de la garantie
export async function handlerCarnet(req, res, { baseId, headers, session }) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!verifierOrigine(req)) return res.status(403).json({ error: "Origine non autorisée." });
  const body = req.body || {};
  if (body.action === "creer") {
    if (!session || !session.userId) return res.status(401).json({ error: "Connexion requise." });
    if (!verifierDebit(req, { max: 120, fenetreMs: 3600 * 1000, cle: "carnet-creer" })) return res.status(429).json({ error: "Trop de demandes. Réessayez plus tard." });
    let slug = "", entreprise = "";
    try {
      if (session.tenantId) {
        const r = await fetch("https://api.airtable.com/v0/" + baseId + "/Clients/" + encodeURIComponent(session.tenantId), { headers });
        if (r.ok) { const f = (await r.json()).fields || {}; slug = String(f.Slug || ""); entreprise = String(f["Nom client"] || ""); }
      } else if (session.role === "SUPER_ADMIN_IKO") {
        slug = String(body.slug || ""); entreprise = String(body.entreprise || "");
      }
    } catch (e) { /* slug vide -> erreur claire ci-dessous */ }
    const r = creerCarnet(Object.assign({}, body, { slug, entreprise }));
    if (r.erreur) return res.status(400).json({ error: r.erreur });
    return res.status(200).json({ jeton: r.jeton, url: baseLien(req) + "/produit.html?c=" + r.jeton });
  }
  if (body.action === "lire") {
    if (!verifierDebit(req, { max: 40, fenetreMs: 10 * 60 * 1000, cle: "carnet-lire" })) return res.status(429).json({ error: "Trop de tentatives. Réessayez dans quelques minutes." });
    const carnet = lireCarnet(body.c);
    if (!carnet) { signalerAbus(req, "jeton-invalide"); return res.status(404).json({ error: "Ce code n'est pas reconnu." }); }
    return res.status(200).json({ ok: true, carnet });
  }
  return res.status(400).json({ error: "Action non reconnue." });
}
