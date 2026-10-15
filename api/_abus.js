// api/_abus.js
// Surveillance anti-piratage : repère les comportements anormaux (origine interdite, trop de requêtes, mots de passe faux,
// liens de suivi inventés, robots qui remplissent le champ piège) et :
//   1. prévient le responsable (journal d'alertes IKO + notification téléphone) — une seule alerte par adresse et par heure ;
//   2. bloque temporairement l'adresse qui insiste (15 minutes).
// Limites assumées : mémoire de l'instance serveur (comme les autres limiteurs d'IKO) — freine l'abus évident, n'est pas un pare-feu.
// Aucune donnée personnelle conservée : l'adresse IP est masquée (dernier bloc caché) et rien n'est écrit en base ici.

const evenements = new Map(); // ip -> [{ t, type }]
const bloques = new Map();    // ip -> timestamp de fin de blocage
const alertes = new Map();    // ip -> timestamp de la dernière alerte
const FENETRE_MS = 10 * 60 * 1000;
const SEUIL_ALERTE = 12;      // événements suspects en 10 min => alerte
const SEUIL_BLOCAGE = 40;     // événements suspects en 10 min => blocage 15 min
const DUREE_BLOCAGE_MS = 15 * 60 * 1000;
const ANTI_REPETITION_MS = 60 * 60 * 1000;

function ipDe(req) {
  try { return String((req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || 'inconnue').split(',')[0].trim(); } catch (e) { return 'inconnue'; }
}
function masquer(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/\.\d+$/, '.xxx');
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + ':xxxx';
  return ip;
}
const LIBELLES = {
  'origine-refusee': "appels depuis un site non autorisé", 'debit-depasse': "trop de requêtes en peu de temps", 'connexion-echouee': "mots de passe incorrects",
  'suivi-introuvable': "liens ou numéros de suivi inventés", 'robot': "robot détecté sur un formulaire", 'jeton-invalide': "lien de suivi falsifié", 'acces-refuse': "accès interdit tenté",
};

// À appeler quand quelque chose de suspect se produit. Ne lève jamais d'exception, ne bloque jamais la réponse.
export function signalerAbus(req, type) {
  try {
    const ip = ipDe(req); if (ip === 'inconnue' || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return;
    const maintenant = Date.now();
    const liste = (evenements.get(ip) || []).filter((e) => maintenant - e.t < FENETRE_MS);
    liste.push({ t: maintenant, type });
    evenements.set(ip, liste);
    if (evenements.size > 5000) evenements.clear(); // garde-fou mémoire
    if (liste.length >= SEUIL_BLOCAGE && !bloques.has(ip)) bloques.set(ip, maintenant + DUREE_BLOCAGE_MS);
    if (liste.length >= SEUIL_ALERTE && maintenant - (alertes.get(ip) || 0) > ANTI_REPETITION_MS) {
      alertes.set(ip, maintenant);
      const parType = {}; liste.forEach((e) => { parType[e.type] = (parType[e.type] || 0) + 1; });
      const detail = Object.keys(parType).map((k) => parType[k] + ' × ' + (LIBELLES[k] || k)).join(', ');
      import('./_alertes.js').then((m) => m.alerter({
        cle: 'abus:' + masquer(ip), titre: 'IKO : activité suspecte détectée',
        message: 'Adresse ' + masquer(ip) + ' : ' + detail + ' en moins de 10 minutes.' + (liste.length >= SEUIL_BLOCAGE ? ' Adresse bloquée 15 minutes.' : ' Surveillée.'),
      })).catch(() => {});
    }
  } catch (e) { /* surveillance non bloquante */ }
}

// true si cette adresse est actuellement bloquée (trop d'abus récents).
export function estBloque(req) {
  try {
    const ip = ipDe(req); const fin = bloques.get(ip);
    if (!fin) return false;
    if (Date.now() > fin) { bloques.delete(ip); evenements.delete(ip); return false; }
    return true;
  } catch (e) { return false; }
}

// Résumé pour l'écran de contrôle (aucune IP complète).
export function resumeAbus() {
  const maintenant = Date.now();
  let suspects = 0, bloquesActifs = 0;
  evenements.forEach((l) => { if (l.some((e) => maintenant - e.t < FENETRE_MS)) suspects++; });
  bloques.forEach((fin) => { if (fin > maintenant) bloquesActifs++; });
  return { adressesSurveillees: suspects, adressesBloquees: bloquesActifs };
}
