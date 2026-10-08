// api/_suivi.js
// Jeton de suivi client (module Amandine : declaration + suivi).
// Fichier prefixe "_" : helper partage, PAS une fonction Vercel (plafond 12).
//
// Le jeton est sans etat : il chiffre (AES-256-GCM, IV aleatoire) l'identite
// du client {email, tel} + une date d'expiration. Il est donc long, different
// a chaque emission, infalsifiable et impossible a deviner, et ne demande
// AUCUNE ecriture Airtable. Cle derivee d'une variable d'environnement Vercel
// (SUIVI_TOKEN_SECRET, a defaut JWT_ACCESS_SECRET) : jamais dans le code.

import crypto from "crypto";

const DUREE_JETON_MS = 365 * 24 * 3600 * 1000; // 1 an
const BASE_PROD = "https://iko-suite-demo.vercel.app";

function cle() {
  const secret = process.env.SUIVI_TOKEN_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret) return null;
  return crypto.createHash("sha256").update("iko-suivi-v1:" + secret).digest();
}

export function normaliserEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  return /^[^\s"'\\<>@]+@[^\s"'\\<>@]+\.[^\s"'\\<>@]+$/.test(e) ? e : "";
}

// Telephone : on compare les 9 derniers chiffres (06 12 34 56 78, +33 6 12...).
export function normaliserTel(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length >= 9 ? d.slice(-9) : "";
}

export function creerJeton({ email, tel }) {
  const k = cle();
  const e = normaliserEmail(email);
  const t = normaliserTel(tel);
  if (!k || (!e && !t)) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const clair = JSON.stringify({ e, t, x: Date.now() + DUREE_JETON_MS });
  const chiffre = Buffer.concat([c.update(clair, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), chiffre]).toString("base64url");
}

// Retourne { email, tel } ou null (jeton invalide, falsifie ou expire).
export function lireJeton(jeton) {
  const k = cle();
  if (!k || typeof jeton !== "string" || jeton.length < 40 || jeton.length > 600) return null;
  try {
    const buf = Buffer.from(jeton, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const clair = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    const p = JSON.parse(clair);
    if (!p.x || p.x < Date.now()) return null;
    if (!p.e && !p.t) return null;
    return { email: p.e || "", tel: p.t || "" };
  } catch (err) {
    return null;
  }
}

// Base du lien : jamais issue d'un en-tete libre (un tiers pourrait faire
// pointer le lien du mail vers un site pirate). Seuls les domaines du projet
// sont acceptes ; sinon repli sur la production.
function baseLien(req) {
  const h = String((req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim();
  if (/^iko-suite-demo[a-z0-9-]*\.vercel\.app$/.test(h)) return "https://" + h;
  return process.env.SUIVI_BASE_URL || BASE_PROD;
}

// Lien direct vers le suivi (a envoyer UNIQUEMENT par e-mail au client, jamais
// renvoye au navigateur de l'auteur de la demande : sinon n'importe qui
// saisissant l'e-mail d'un tiers obtiendrait l'acces a son suivi).
export function lienSuivi(req, { email, tel, ticket }) {
  const j = creerJeton({ email, tel });
  if (!j) return "";
  return baseLien(req) + "/suivi.html?t=" + j + (ticket ? "&ticket=" + encodeURIComponent(ticket) : "");
}
