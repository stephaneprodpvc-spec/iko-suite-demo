// api/_connaissance.js
// Mécanisme commun de parsing/filtrage/formatage de "Connaissance entreprise
// (JSON)" (FAQ / procédures / règles internes par client), réutilisé à
// l'identique par les 4 assistants IKO (Stef, Amandine, Max, Dashboard) pour
// éviter toute duplication. Fonctions pures, AUCUN accès réseau ici : ce
// module ne fait que traiter des données déjà fournies par l'appelant — le
// record Airtable "Clients" déjà chargé pour Stef/Amandine (résolution par
// slug), le tableau déjà transmis par le front pour Max/Dashboard (record
// déjà chargé côté client au démarrage).
// Fichier préfixé "_" comme _securite.js / _trades/*.js : convention déjà
// en place dans ce repo pour un module interne, jamais une route Vercel.
//
// ISOLATION TENANT : ces fonctions ne lisent et n'utilisent JAMAIS un
// identifiant de tenant présent dans les entrées reçues (ex: un champ
// "tenantId" glissé dans une entrée par erreur ou malveillance) pour
// décider quoi que ce soit — elles filtrent/formatent uniquement du texte
// destiné au prompt. Le périmètre tenant reste déterminé exclusivement par
// l'appelant (résolution par slug pour Stef/Amandine, JWT/session existant
// pour Max/Dashboard) : ce module ne le modifie jamais.
//
// V1 "Intelligence Entreprise" : en plus du filtrage de base (normalisation
// V1 initiale), ce module gère maintenant la déduplication des entrées
// évidemment identiques, la priorisation déterministe par recouvrement de
// mots-clés avec la question en cours (jamais une note sémantique inventée
// par un modèle — du simple comptage de mots communs), et un budget global
// de caractères pour éviter qu'un client avec beaucoup de connaissance ne
// fasse gonfler le prompt inutilement. Ce module ne détecte et ne résout
// JAMAIS de contradiction entre deux entrées : trancher entre deux réponses
// qui se contredisent est un jugement de contenu qui n'appartient pas à une
// fonction de filtrage déterministe — les deux entrées sont transmises
// telles quelles, c'est à l'assistant (et à ses règles "n'invente jamais")
// de s'en sortir, ou à l'entreprise cliente de nettoyer sa propre base.

export const CONNAISSANCE_MAX_ENTREES = 20;      // plafond nombre d'entrées transmises au prompt
export const CONNAISSANCE_MAX_CHARS = 500;       // plafond taille du contenu par entrée
export const CONNAISSANCE_BUDGET_TOTAL = 4000;   // plafond global (somme des contenus) transmis au prompt
const CONNAISSANCE_MAX_TITRE = 200;
const CATEGORIES_VALIDES = ["FAQ", "Procédure", "Règle interne"];

// Retire les accents et met en minuscule, pour comparer "délai" et "delai"
// comme le même mot (doublons, recherche de pertinence) sans jamais changer
// le texte réellement transmis au prompt (toujours l'original, jamais cette
// version normalisée).
function normaliserTexte(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Normalise un tableau déjà JSON.parse en tableau propre, jamais d'entrée
// invalide/inutilisable, dédupliqué, ordre déterministe (catégorie puis
// titre, tri alphabétique français) pour que le contexte transmis à
// l'assistant ne varie pas d'un appel à l'autre à données égales :
// - entrée non-objet (null, tableau, nombre...) -> ignorée
// - actif === false -> exclue (absent/undefined compte comme actif, même
//   convention que "Actif" sur Questionnaire SAV : "!== false")
// - metier renseigné et différent du métier du client -> exclue (une entrée
//   réservée à un autre métier n'est pas "son contexte" pour ce client)
// - contenu vide (après trim) -> exclue : une entrée sans contenu n'apporte
//   rien et peut correspondre à une ligne ajoutée puis jamais remplie
// - catégorie hors liste connue -> repliée sur "FAQ" (jamais une valeur
//   affichée telle quelle si le JSON a été modifié à la main hors admin.html)
// - doublon évident (contenu strictement identique une fois accents/casse/
//   espaces ignorés, quel que soit le titre) -> seule la première
//   occurrence rencontrée est conservée. Volontairement PAS de déduplication
//   par simple similarité de titre : deux entrées au titre quasi identique
//   mais au contenu différent ne sont pas "évidemment" un doublon — ce
//   pourrait être une contradiction réelle (deux réponses différentes à la
//   même question) que cette fonction ne doit jamais trancher elle-même ni
//   faire disparaître silencieusement ; seul un contenu identique est un
//   doublon sans ambiguïté.
// - plafonnée à CONNAISSANCE_MAX_ENTREES entrées, chacune à
//   CONNAISSANCE_MAX_CHARS caractères de contenu (titre à 200)
export function normaliserConnaissance(entrees, metierClient) {
  if (!Array.isArray(entrees)) return [];
  const propres = entrees
    .filter(function (e) { return e && typeof e === "object" && !Array.isArray(e); })
    .filter(function (e) { return e.actif !== false; })
    .filter(function (e) { return !e.metier || e.metier === metierClient; })
    .map(function (e) {
      return {
        categorie: CATEGORIES_VALIDES.indexOf(e.categorie) !== -1 ? e.categorie : "FAQ",
        titre: String(e.titre == null ? "" : e.titre).trim().slice(0, CONNAISSANCE_MAX_TITRE),
        contenu: String(e.contenu == null ? "" : e.contenu).trim().slice(0, CONNAISSANCE_MAX_CHARS),
        metier: e.metier || "",
      };
    })
    .filter(function (e) { return e.contenu.length > 0; });

  const vusContenu = new Set();
  const dedupliquees = [];
  for (const e of propres) {
    const cleContenu = normaliserTexte(e.contenu);
    if (vusContenu.has(cleContenu)) continue;
    vusContenu.add(cleContenu);
    dedupliquees.push(e);
  }

  return dedupliquees
    .sort(function (a, b) {
      const ca = CATEGORIES_VALIDES.indexOf(a.categorie);
      const cb = CATEGORIES_VALIDES.indexOf(b.categorie);
      if (ca !== cb) return ca - cb;
      return a.titre.localeCompare(b.titre, "fr");
    })
    .slice(0, CONNAISSANCE_MAX_ENTREES);
}

// Extrait + normalise directement depuis un record Airtable "Clients" déjà
// chargé (Stef/Amandine résolvent ce record par slug une seule fois par
// requête) : lit UNIQUEMENT le champ "Connaissance entreprise (JSON)" de CE
// record déjà résolu, aucun appel réseau ici. JSON invalide/absent ->
// tableau vide, jamais d'erreur remontée à l'assistant.
export function extraireConnaissanceDuRecord(rec, metierClient) {
  try {
    const brut = rec && rec.fields && rec.fields["Connaissance entreprise (JSON)"];
    const entrees = JSON.parse(brut || "[]");
    return normaliserConnaissance(entrees, metierClient);
  } catch (e) {
    return [];
  }
}

const MOTS_VIDES = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "a", "au", "aux",
  "en", "pour", "sur", "avec", "dans", "est", "ce", "cette", "ces", "que", "qui",
  "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "mon", "ma", "mes",
  "votre", "vos", "son", "sa", "ses", "y", "se", "sont", "ai", "as", "avez", "ont",
]);

// Mots "significatifs" d'un texte (>=3 lettres, hors mots vides français),
// accents/casse ignorés — sert uniquement à mesurer un recouvrement lexical
// simple, jamais une compréhension du sens.
function motsSignificatifs(s) {
  return normaliserTexte(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(function (m) { return m.length >= 3 && !MOTS_VIDES.has(m); });
}

// Réordonne des entrées DÉJÀ normalisées (normaliserConnaissance /
// extraireConnaissanceDuRecord) selon leur pertinence par rapport au texte
// de la question en cours — un simple recouvrement de mots-clés (jamais une
// note sémantique inventée) : jamais utilisé pour EXCLURE une entrée (le
// filtrage actif/métier reste dans normaliserConnaissance), seulement pour
// faire remonter en tête du contexte celles qui semblent répondre à la
// question. Sans texte de requête (absent/vide) ou si aucun mot ne
// correspond, l'ordre existant (catégorie puis titre) est conservé tel
// quel — comportement par défaut inchangé pour tout appelant qui n'utilise
// pas cette fonction. Tri stable (Array.prototype.sort en Node est stable)
// donc l'ordre d'origine sert de départage naturel à score égal.
export function trierParPertinence(entreesNormalisees, texteRequete) {
  const source = entreesNormalisees || [];
  const motsRequete = motsSignificatifs(texteRequete);
  if (source.length === 0 || motsRequete.length === 0) return source;
  const motsRequeteSet = new Set(motsRequete);
  return source
    .map(function (e) {
      const motsEntree = motsSignificatifs(e.titre + " " + e.contenu);
      let score = 0;
      motsEntree.forEach(function (m) { if (motsRequeteSet.has(m)) score += 1; });
      return { e: e, score: score };
    })
    .sort(function (a, b) { return b.score - a.score; })
    .map(function (x) { return x.e; });
}

// Applique un plafond global de caractères de contenu (en plus du plafond
// par entrée déjà appliqué dans normaliserConnaissance), pour qu'un client
// avec de nombreuses entrées ne fasse pas gonfler le prompt indéfiniment
// même sous le plafond de CONNAISSANCE_MAX_ENTREES. Parcourt les entrées
// DANS L'ORDRE DÉJÀ DÉCIDÉ par l'appelant (catégorie, ou pertinence si
// trierParPertinence a été utilisé avant) : ne réordonne jamais. Tronque
// proprement la dernière entrée qui dépasse si la place restante est encore
// exploitable (>=30 caractères), sinon l'écarte plutôt que de transmettre
// un fragment inutile.
export function limiterBudget(entreesNormalisees, budgetTotal) {
  const budget = budgetTotal == null ? CONNAISSANCE_BUDGET_TOTAL : budgetTotal;
  const resultat = [];
  let restant = budget;
  for (const e of (entreesNormalisees || [])) {
    if (restant <= 0) break;
    if (e.contenu.length <= restant) {
      resultat.push(e);
      restant -= e.contenu.length;
    } else if (restant >= 30) {
      resultat.push(Object.assign({}, e, { contenu: e.contenu.slice(0, restant).trim() }));
      restant = 0;
    } else {
      break;
    }
  }
  return resultat;
}

// Formate le bloc de prompt, identique pour les 4 assistants. Marque
// explicitement qu'il s'agit de connaissances PROPRES à l'entreprise
// cliente (pas des informations générales sur le métier), avec la
// catégorie et le métier concerné visibles pour chaque entrée.
export function blocPromptConnaissance(entreesNormalisees) {
  if (!entreesNormalisees || entreesNormalisees.length === 0) return "";
  const lignes = entreesNormalisees.map(function (e) {
    const suffixeMetier = e.metier ? " (" + e.metier + ")" : "";
    return "- [" + e.categorie + suffixeMetier + "] " + e.titre + " : " + e.contenu;
  }).join("\n");
  return `

CONNAISSANCE PROPRE A CETTE ENTREPRISE
Ce qui suit n'est PAS une information generale sur le metier : ce sont des
FAQ, procedures et regles internes propres A CETTE ENTREPRISE cliente.
Utilise-les en priorite quand elles repondent a la question posee (les
entrees les plus pertinentes pour la question en cours sont placees en
premier), mais elles ne remplacent jamais les regles ci-dessus. Si deux
entrees se contredisent, ne tranche jamais de toi-meme : signale la
contradiction et propose de faire verifier par un conseiller humain plutot
que de choisir une version au hasard.
${lignes}`;
}

// Combinateur final, identique pour les 4 assistants : à partir d'entrées
// DÉJÀ normalisées (normaliserConnaissance / extraireConnaissanceDuRecord),
// applique la priorisation par pertinence (si une question est fournie)
// puis le budget global — dans cet ordre précis, pour que les entrées les
// plus pertinentes ne soient jamais celles tronquées/écartées par le
// budget. texteRequete est optionnel : omis ou vide, le comportement (ordre
// catégorie/titre, budget global toujours applique) reste déterministe.
export function affinerPourPrompt(entreesNormalisees, texteRequete) {
  const priorisees = texteRequete ? trierParPertinence(entreesNormalisees, texteRequete) : (entreesNormalisees || []);
  return limiterBudget(priorisees, CONNAISSANCE_BUDGET_TOTAL);
}
