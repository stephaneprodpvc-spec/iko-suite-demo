// api/_connaissance.js
// Mécanisme commun de parsing/filtrage/formatage de "Connaissance entreprise
// (JSON)" (FAQ / procédures / règles internes par client), réutilisé à
// l'identique par les 4 assistants IKO (Stef, Amandine, Max, Dashboard) pour
// éviter toute duplication (Intelligence Entreprise V1). Fonctions pures,
// AUCUN accès réseau ici : ce module ne fait que traiter des données déjà
// fournies par l'appelant — le record Airtable "Clients" déjà chargé pour
// Stef/Amandine (résolution par slug), le tableau déjà transmis par le
// front pour Max/Dashboard (record déjà chargé côté client au démarrage).
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

export const CONNAISSANCE_MAX_ENTREES = 20;  // plafond nombre d'entrées transmises au prompt
export const CONNAISSANCE_MAX_CHARS = 500;   // plafond taille du contenu par entrée
const CONNAISSANCE_MAX_TITRE = 200;
const CATEGORIES_VALIDES = ["FAQ", "Procédure", "Règle interne"];

// Normalise un tableau déjà JSON.parse en tableau propre, jamais d'entrée
// invalide/inutilisable, ordre déterministe (catégorie puis titre, tri
// alphabétique français) pour que le contexte transmis à l'assistant ne
// varie pas d'un appel à l'autre à données égales :
// - entrée non-objet (null, tableau, nombre...) -> ignorée
// - actif === false -> exclue (absent/undefined compte comme actif, même
//   convention que "Actif" sur Questionnaire SAV : "!== false")
// - metier renseigné et différent du métier du client -> exclue (une entrée
//   réservée à un autre métier n'est pas "son contexte" pour ce client)
// - contenu vide (après trim) -> exclue : une entrée sans contenu n'apporte
//   rien et peut correspondre à une ligne ajoutée puis jamais remplie
// - catégorie hors liste connue -> repliée sur "FAQ" (jamais une valeur
//   affichée telle quelle si le JSON a été modifié à la main hors admin.html)
// - plafonnée à CONNAISSANCE_MAX_ENTREES entrées, chacune à
//   CONNAISSANCE_MAX_CHARS caractères de contenu (titre à 200)
export function normaliserConnaissance(entrees, metierClient) {
  if (!Array.isArray(entrees)) return [];
  return entrees
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
    .filter(function (e) { return e.contenu.length > 0; })
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
Utilise-les en priorite quand elles repondent a la question posee, mais
elles ne remplacent jamais les regles ci-dessus.
${lignes}`;
}
