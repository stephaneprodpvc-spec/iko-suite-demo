// api/_securite.js
// Protection partagee pour les endpoints /api/chat-* et pour la
// verification de session utilisee par api/airtable-proxy.js (AUTH #004).
// Deux mecanismes volontairement simples (adaptes a une demo, pas a un
// systeme haute securite) :
//
// 1. Controle d'origine : rejette les requetes qui ne viennent pas du
//    site lui-meme (empeche un tiers d'appeler directement l'API depuis
//    un autre site et de consommer ton credit Anthropic).
// 2. Limite de debit en memoire : throttling basique par IP. Comme les
//    fonctions serverless Vercel peuvent redemarrer a froid, ce n'est
//    PAS une garantie absolue (la memoire est parfois remise a zero),
//    mais ca bloque deja l'abus evident (spam rapide et repete) tant que
//    l'instance reste "chaude", ce qui est le cas la majorite du temps
//    en usage normal.

import jwt from "jsonwebtoken";

const ORIGINES_AUTORISEES = [
  "iko-suite-demo.vercel.app",
  "iko-suite-demo-git-main-akial.vercel.app",
];

const compteurs = new Map(); // "cle:ip" -> { debut: timestamp, nb: compte }
const FENETRE_MS = 60_000; // 1 minute
const MAX_REQUETES_PAR_FENETRE = 12;

export function verifierOrigine(req) {
  const origine = req.headers.origin || req.headers.referer || "";
  if (!origine) return true; // certains clients (curl direct, tests) n'envoient rien : on laisse passer, le rate-limit prend le relais
  return ORIGINES_AUTORISEES.some(d => origine.includes(d)) || origine.includes("localhost");
}

// Options optionnelles { max, fenetreMs, cle } : permet de réutiliser ce
// même mécanisme (Map en mémoire, clé par IP) avec un seuil différent pour
// un usage distinct, sans dupliquer la logique ni affecter le compteur
// historique des appels /api/chat-* (clé "" par défaut, comportement
// strictement inchangé pour tout appel existant sans options).
export function verifierDebit(req, options = {}) {
  const { max = MAX_REQUETES_PAR_FENETRE, fenetreMs = FENETRE_MS, cle = "" } = options;
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "inconnu").split(",")[0].trim();
  const cleComplete = (cle ? cle + ":" : "") + ip;
  const maintenant = Date.now();
  const entree = compteurs.get(cleComplete);

  if (!entree || maintenant - entree.debut > fenetreMs) {
    compteurs.set(cleComplete, { debut: maintenant, nb: 1 });
    return true;
  }
  entree.nb += 1;
  if (entree.nb > max) return false;
  return true;
}

export function reponseBloquee(res, raison) {
  return res.status(429).json({ erreur: raison === "origine" ? "Origine non autorisée." : "Trop de requêtes, réessayez dans une minute." });
}

// Verification de session (AUTH #004) — extraite pour etre reutilisable par
// airtable-proxy.js SANS dupliquer la logique complete de verif-securite.js.
//
// Volontairement minimale et SANS EFFET DE BORD : lit uniquement le cookie
// iko_access, verifie sa signature/expiration, et retourne les infos qu'il
// contient. Ne touche JAMAIS au cookie iko_refresh, ne fait AUCUN appel
// Airtable, ne fait AUCUNE rotation de token. La logique complete de
// rotation/anti-reutilisation du refresh token reste exclusivement dans
// verif-securite.js (non modifie par AUTH #004), qui reste le SEUL endroit
// ou un utilisateur obtient un nouvel access token.
//
// Consequence assumee : un access token expire (duree de vie 15 minutes)
// est traite ici comme "pas de session", meme si un refresh token valide
// existe encore. C'est un choix delibere pour ce proxy (voir AUTH #004,
// mode de coexistence) - la page appelante est responsable de rafraichir
// sa session via /api/verif-securite?action=session avant d'appeler ce
// proxy si necessaire ; ce n'est pas le role du proxy Airtable de le faire.
//
// Retourne { userId, tenantId, role } si une session valide existe,
// sinon null (ne leve jamais d'exception).
export function verifierSession(req) {
  const brut = req.headers.cookie || "";
  const m = brut.match(/(?:^|; )iko_access=([^;]*)/);
  if (!m) return null;
  try {
    const payload = jwt.verify(decodeURIComponent(m[1]), process.env.JWT_ACCESS_SECRET);
    return { userId: payload.userId, tenantId: payload.tenantId, role: payload.role };
  } catch (e) {
    return null;
  }
}
