// api/_securite.js
// Protection partagee pour les endpoints /api/chat-*.
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

const ORIGINES_AUTORISEES = [
  "iko-suite-demo.vercel.app",
  "iko-suite-demo-git-main-akial.vercel.app",
];

const compteurs = new Map(); // ip -> { debut: timestamp, nb: compte }
const FENETRE_MS = 60_000; // 1 minute
const MAX_REQUETES_PAR_FENETRE = 12;

export function verifierOrigine(req) {
  const origine = req.headers.origin || req.headers.referer || "";
  if (!origine) return true; // certains clients (curl direct, tests) n'envoient rien : on laisse passer, le rate-limit prend le relais
  return ORIGINES_AUTORISEES.some(d => origine.includes(d)) || origine.includes("localhost");
}

export function verifierDebit(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "inconnu").split(",")[0].trim();
  const maintenant = Date.now();
  const entree = compteurs.get(ip);

  if (!entree || maintenant - entree.debut > FENETRE_MS) {
    compteurs.set(ip, { debut: maintenant, nb: 1 });
    return true;
  }
  entree.nb += 1;
  if (entree.nb > MAX_REQUETES_PAR_FENETRE) return false;
  return true;
}

export function reponseBloquee(res, raison) {
  return res.status(429).json({ erreur: raison === "origine" ? "Origine non autorisée." : "Trop de requêtes, réessayez dans une minute." });
}
