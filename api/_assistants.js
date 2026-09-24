// api/_assistants.js
// Résolution PURE du nom affiché des assistants IA (Amandine, Max) par
// client/tenant — personnalisation V1 (nom affiché uniquement, pas
// d'avatar/voix/personnalité). Aucun accès réseau ici : les données
// viennent toujours de l'appelant (fetch Airtable déjà fait cote serveur
// ou cote client, ou valeur déjà résolue transmise dans le corps de la
// requete). Ne leve jamais d'exception : repli silencieux sur le nom par
// défaut en toute circonstance (champ absent, JSON invalide, nom vide).
//
// Identifiants internes STABLES (ne jamais changer meme si le nom affiche
// change un jour) :
//   - "amandine"   -> widget SAV public (amandine.html / chat-amandine.js)
//   - "technicien" -> assistant vocal Max (technicien.html / chat-technicien.js)
//
// Champ Airtable optionnel sur la table Clients : "Assistants (JSON)",
// ex. {"amandine":"Sophie","technicien":"Théo"}. Ce champ n'existe pas
// encore dans Airtable (a créer manuellement si besoin) : tant qu'il est
// absent, tout resout silencieusement sur NOMS_PAR_DEFAUT ci-dessous.

export const NOMS_PAR_DEFAUT = {
  amandine: "Amandine",
  technicien: "Max",
};

const CHAMP_AIRTABLE = "Assistants (JSON)";
const LONGUEUR_MAX = 40;

function nettoyer(brut) {
  if (typeof brut !== "string") return "";
  return brut.trim().slice(0, LONGUEUR_MAX);
}

// A partir des champs Airtable d'un client (rec.fields), résout le nom
// affiché pour un assistant donné. clientInfo peut etre null/undefined
// (aucun client résolu) : repli sur le nom par défaut.
export function nomAssistant(clientInfo, identifiantInterne) {
  const defaut = NOMS_PAR_DEFAUT[identifiantInterne];
  if (!defaut) return null; // identifiant interne inconnu
  if (!clientInfo) return defaut;
  const brut = clientInfo[CHAMP_AIRTABLE];
  if (!brut) return defaut;
  try {
    const config = typeof brut === "string" ? JSON.parse(brut) : brut;
    const nom = nettoyer(config && config[identifiantInterne]);
    return nom || defaut;
  } catch (e) {
    return defaut; // JSON invalide -> repli propre, jamais d'erreur remontée
  }
}

// Variante pour un nom déjà résolu côté appelant (ex. technicien.html
// résout le nom depuis window.IKO_CLIENT_INFO déjà chargé et l'envoie tel
// quel dans le corps de la requête : pas de nouvel appel Airtable ici).
// Même nettoyage/repli que nomAssistant, sans lecture de champ Airtable.
export function nomAssistantDepuisEntree(brut, identifiantInterne) {
  const defaut = NOMS_PAR_DEFAUT[identifiantInterne];
  if (!defaut) return null;
  const nom = nettoyer(brut);
  return nom || defaut;
}
