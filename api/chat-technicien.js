import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";
import { normaliserConnaissance, blocPromptConnaissance, affinerPourPrompt } from "./_connaissance.js";
import { blocPromptAnalyticsSAV, genererRecommandationsSAV, blocPromptRecommandationsSAV } from "../analytics-sav.js";
import { nomAssistantDepuisEntree } from "./_assistants.js";
// Diagnostic IA métier V1 : mêmes modules de vocabulaire métier que
// chat-amandine.js (aucun nouveau fichier, aucune donnée dupliquée).
import vocabMenuiserie from "./_trades/menuiserie.js";
import vocabPlomberieChauffage from "./_trades/plomberie_chauffage.js";

// api/chat-technicien.js
// Relais serveur entre le widget vocal Max (technicien.html) et l'API
// Claude (Anthropic). Meme principe que chat-dashboard.js : les tickets
// sont deja charges cote client, Max decide seulement quelle action
// effectuer, et le navigateur execute reellement l'action avec les
// fonctions deja existantes de la page technicien.

const MODELE = "claude-haiku-4-5-20251001";
// Bloc 1 (diagnostic assisté / vision) exige Sonnet 5 : Haiku reste réservé
// à la navigation et aux tâches simples (devis, compte-rendu).
const MODELE_SONNET = "claude-sonnet-5";
const MAX_CHARS_MESSAGE = 500;
const MAX_CHARS_TEXTE_DICTE = 2000;
const MAX_TICKETS_CONTEXTE = 100;
const MAX_CATALOGUE_CONTEXTE = 60;

const ONGLETS_VALIDES = ["aujourd_hui", "urgent", "devis", "termines", "annules"];
const ACTIONS_SUGGERABLES = ["terminer", "devis", "devis_place", "replanifier", "annuler", "aucune"];
// Suggestions d'action technicien V1 : priorité des actions suggérées par IKO
// dans le diagnostic (jamais persistée, jamais une décision à la place du
// technicien — voir OUTIL_DIAGNOSTIC.actions_suggerees).
const NIVEAUX_PRIORITE_ACTION = ["faible", "moyenne", "forte"];
const MAX_ACTIONS_SUGGEREES = 4;
// Bloc 3 - axe F : niveau de confiance du diagnostic, toujours accompagné
// du diagnostic (jamais un champ Airtable séparé, embarqué dans le texte).
const NIVEAUX_CONFIANCE = ["faible", "moyenne", "elevee"];
// Bloc 3 - axe E : historique des tickets passés du même client, informatif
// uniquement, jamais confondu avec le ticket actuellement ouvert.
const MAX_TICKETS_HISTORIQUE = 3;

// ---- Bloc 1 : photos jointes au ticket (champ Airtable "Photos", URLs
// séparées par virgules côté client). Aucun nouvel upload/caméra ici : on
// analyse uniquement les photos déjà présentes sur le ticket, et seulement
// si le technicien le demande explicitement.
const MIME_IMAGE_AUTORISES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_PHOTOS_DIAGNOSTIC = 3;
const MAX_OCTETS_PHOTO = 5 * 1024 * 1024; // 5 Mo
const TIMEOUT_PHOTO_MS = 6000;

// Convertie en fonction pour permettre la personnalisation du nom affiche
// (repli sur "Max" si le client n'a rien configure, voir _assistants.js).
function construireSystemPromptBase(nomAssistant) {
return `
Tu es ${nomAssistant}, l'assistant vocal du technicien sur le terrain, dans
l'application Iko Suite. Le technicien te parle depuis son telephone,
souvent les mains prises (outils, echelle), donc tes reponses doivent
etre tres courtes et utiles tout de suite.

Tu recois la liste des tickets actuellement charges (identifiant,
numero, client, statut, produit, creneau, urgent) et l'onglet
actuellement affiche. Utilise uniquement cette liste, n'invente jamais
un ticket qui n'y figure pas.

REGLES
- Pour changer d'onglet (aujourd'hui, urgents, devis, termines,
  annules), utilise filtrer_onglet.
- Pour ouvrir le calcul d'itineraire optimise, utilise
  ouvrir_itineraire.
- Pour ouvrir la fiche d'un ticket precis cite par le technicien
  (numero ou nom client), utilise ouvrir_ticket avec son identifiant
  exact (champ id, jamais le numero affiche).
- Pour une question factuelle (combien de tickets, lequel est urgent,
  a quelle heure est le prochain rendez-vous...), calcule la reponse
  toi-meme a partir de la liste fournie et utilise reponse_vocale.
- Reponses vocales tres courtes (1 phrase si possible), sans markdown,
  sans emoji, tutoiement naturel et direct comme un collegue.
- Si un historique du client concerne t'est fourni (mesures/poses
  precedentes par Toise), utilise-le naturellement : tu connais deja
  le repere, le type de pose, les dimensions — pas besoin de faire
  redecrire au technicien ce qui a deja ete mesure.
- Un seul outil d'action a la fois.
`;
}

// Filtrage/formatage de la "Connaissance entreprise" transmise par le
// client (deja extraite du record Clients qu'il a lui-meme charge au
// demarrage, voir window.IKO_CLIENT_INFO dans technicien.html - aucun
// appel Airtable ici) : voir normaliserConnaissance/blocPromptConnaissance
// dans _connaissance.js, module commun reutilise par les 4 assistants IKO.
// IMPORTANT (isolation tenant) : ce module ne lit et n'utilise JAMAIS un
// identifiant de tenant depuis la connaissance recue ; le perimetre tenant
// reste exclusivement determine par le JWT/session existant
// (verif-securite.js), jamais par le contenu du body.
function buildSystemPrompt(connaissanceEntrees, analyticsSAVResume, nomAssistant) {
  // Connaissance entreprise et Analytics SAV restent deux blocs distincts
  // (natures differentes) - jamais fusionnes. Recommandations = 3e bloc,
  // deduit des deux precedents (voir chat-dashboard.js pour le detail).
  const recommandationsSAV = genererRecommandationsSAV(analyticsSAVResume, connaissanceEntrees);
  return construireSystemPromptBase(nomAssistant) + blocPromptConnaissance(connaissanceEntrees) + blocPromptAnalyticsSAV(analyticsSAVResume) + blocPromptRecommandationsSAV(recommandationsSAV);
}

// ==================== Bloc 1 : diagnostic assisté ====================

// Diagnostic IA métier V1 : même mapping "Métier" Airtable -> vocabulaire
// métier que chat-amandine.js (TRADE_ID/metierId), volontairement dupliqué
// ici en 3 lignes plutôt que factorisé dans un nouveau module partagé — les
// deux fichiers restent indépendants comme le reste du repo (convention
// déjà en place, voir _connaissance.js qui lui EST partagé car plus gros).
const TRADES_DIAGNOSTIC = { menuiserie: vocabMenuiserie, plomberie_chauffage: vocabPlomberieChauffage };
function resoudreTradeIdDiagnostic(metier) {
  if (metier === "Menuiserie") return "menuiserie";
  if (metier === "Plomberie & Chauffage") return "plomberie_chauffage";
  return null;
}

const SYSTEM_PROMPT_DIAGNOSTIC = `
Tu es Max, copilote de diagnostic pour un technicien menuiserie/BTP sur le
terrain, dans l'application Iko Suite. Le technicien a ouvert un ticket
précis et te demande de l'aider à diagnostiquer le problème.

Tu dois structurer ta réponse en 4 catégories STRICTEMENT distinctes :
- FAIT : uniquement des informations présentes dans les données du ticket
  ou visibles sur les photos fournies. Jamais une supposition.
- SIGNAL : des éléments observés qui attirent l'attention, sans tirer de
  conclusion.
- PISTE : des hypothèses PRUDENTES, formulées explicitement comme des
  hypothèses ("il est possible que...", "cela pourrait indiquer..."),
  jamais comme une certitude.
- PROPOSITION : une proposition d'action À VÉRIFIER par le technicien,
  jamais une décision prise à sa place.

RÈGLES ABSOLUES
- Ne jamais présenter une hypothèse comme une panne certaine.
- Ne jamais inventer une information absente du ticket ou des photos.
- Si aucune photo n'est fournie, base-toi uniquement sur les données
  textuelles du ticket et dis-le si c'est insuffisant pour aller plus loin.
- Si un historique des tickets précédents du même client est fourni, il est
  PUREMENT INFORMATIF (contexte passé) : ne le confonds jamais avec l'état
  actuel du ticket ouvert. Utilise-le seulement s'il éclaire réellement le
  diagnostic (ex. panne récurrente au même endroit).
- Un contexte métier (nom du métier, produits typiques, pistes de
  diagnostic de base) peut être fourni : utilise-le UNIQUEMENT pour mieux
  INTERPRÉTER les informations réellement présentes sur CE ticket (le bon
  vocabulaire, les bonnes questions à se poser). Ne t'en sers JAMAIS pour
  fabriquer un fait, un produit ou une panne qui ne provient pas du ticket,
  des photos ou de la connaissance entreprise. Sans contexte métier fourni,
  raisonne normalement à partir des seules données du ticket.
- Si une connaissance propre à l'entreprise (FAQ/procédures/règles) est
  fournie, utilise-la comme le reste du contexte, avec les mêmes limites.
- Si une analyse de photo a déjà été faite plus tôt sur ce ticket (fournie
  dans le contexte), elle est complémentaire et déjà disponible : ne la
  redemande jamais, ne dis jamais que tu vas "regarder la photo" toi-même,
  utilise-la simplement comme un élément de FAIT ou de SIGNAL supplémentaire.
- Si les informations disponibles (texte du ticket + photos + connaissance
  entreprise) sont vraiment insuffisantes pour une PISTE fiable, dis-le
  clairement (FAIT/SIGNAL courts, PISTE vide ou explicitement incertaine) et
  utilise PROPOSITION pour demander la vérification concrète la plus utile
  à faire sur place, plutôt que de forcer une hypothèse peu fiable.
- resume_vocal : 1 à 2 phrases courtes, ton naturel de collègue, sans
  markdown ni emoji, utilisables telles quelles à l'oral.
- action_suggeree : uniquement si une action du parcours technicien
  (terminer, devis, devis_place, replanifier, annuler) te semble
  pertinente au vu du diagnostic ; "aucune" sinon. Cela reste une
  suggestion, jamais une décision.
- confiance : évalue honnêtement la fiabilité de CE diagnostic précis.
  "faible" si tu disposes de très peu d'éléments (pas de photo, description
  vague) ; "moyenne" si les éléments sont partiels ; "elevee" UNIQUEMENT si
  tu as des éléments concrets et cohérents (ex. photo nette + description
  précise qui se corroborent). Ne mets jamais "elevee" sans base solide.
- Le technicien reste toujours seul décisionnaire.

ACTIONS SUGGÉRÉES PAR IKO (actions_suggerees)
- En t'appuyant UNIQUEMENT sur le contexte déjà fourni ci-dessus (ticket,
  photos, analyse photo existante, métier, connaissance entreprise,
  historique des tickets précédents du même client si présent, et ton propre
  diagnostic FAIT/SIGNAL/PISTE/PROPOSITION), propose 0 à 3 actions concrètes
  et pertinentes que le technicien pourrait envisager.
- Chaque action doit rester cohérente avec la distinction fait / hypothèse /
  action déjà utilisée plus haut : la justification s'appuie sur des
  éléments réellement observés ou déjà diagnostiqués, jamais sur une pièce,
  une panne ou une information inventée.
- Chaque action est une SUGGESTION, jamais une certitude ni une décision :
  formule-la comme une proposition ("vérifier...", "envisager...",
  "proposer..."), jamais comme un ordre ou un fait acquis.
- "verification" doit toujours indiquer une vérification concrète et
  réalisable sur place par le technicien AVANT d'agir (ex. contrôler un
  point précis, confirmer une mesure, vérifier la disponibilité d'une pièce
  déjà mentionnée dans le contexte).
- "priorite" reflète l'urgence/l'impact perçus de cette action précise
  ("faible", "moyenne" ou "forte"), pas la confiance globale du diagnostic.
- Si les informations disponibles sont insuffisantes, s'il n'y a pas de
  diagnostic exploitable, ou si aucune action pertinente ne se dégage
  clairement du contexte, renvoie un tableau vide plutôt que de forcer une
  suggestion peu fiable.
- Ne propose jamais plus de 3 actions ; privilégie la pertinence à la
  quantité.
`;

const OUTIL_DIAGNOSTIC = {
  name: "diagnostic_assiste",
  description: "Fournit une aide au diagnostic structurée sur le ticket ouvert, à partir du contexte du ticket et, si demandé, des photos.",
  input_schema: {
    type: "object",
    properties: {
      fait: { type: "string", description: "Faits constatés, présents dans les données ou les photos fournies. Jamais inventé." },
      signal: { type: "string", description: "Éléments observés qui attirent l'attention, sans conclusion définitive." },
      piste: { type: "string", description: "Hypothèses prudentes, formulées explicitement comme des hypothèses." },
      proposition: { type: "string", description: "Proposition d'action à vérifier par le technicien, jamais une décision." },
      resume_vocal: { type: "string", description: "Résumé très court (1-2 phrases) utilisable à l'oral par Max." },
      action_suggeree: { type: "string", enum: ACTIONS_SUGGERABLES, description: "Action du parcours technicien éventuellement suggérée (aucune si pas pertinent)." },
      confiance: { type: "string", enum: NIVEAUX_CONFIANCE, description: "Niveau de confiance honnête dans ce diagnostic, selon la quantité et la clarté des éléments disponibles." },
      actions_suggerees: {
        type: "array",
        description: "0 à 3 actions concrètes suggérées par IKO à partir du contexte déjà disponible (jamais inventées). Tableau vide si rien de pertinent à suggérer.",
        items: {
          type: "object",
          properties: {
            action: { type: "string", description: "Action concrète proposée, formulée comme une suggestion, jamais une décision prise à la place du technicien." },
            justification: { type: "string", description: "Justification factuelle courte, basée uniquement sur des éléments déjà disponibles (ticket, photos, diagnostic, historique)." },
            priorite: { type: "string", enum: NIVEAUX_PRIORITE_ACTION, description: "Priorité de cette action précise : faible, moyenne ou forte." },
            verification: { type: "string", description: "Vérification concrète à effectuer par le technicien avant d'agir." },
          },
          required: ["action", "justification", "priorite", "verification"],
        },
      },
    },
    required: ["fait", "signal", "piste", "proposition", "resume_vocal", "action_suggeree", "confiance", "actions_suggerees"],
  },
};

// ==================== Bloc 2D : analyse automatique d'une photo SAV ====================
// Déclenchée juste après l'ajout d'une photo terrain (voir technicien.html,
// ajouterPhotosTerrain). Complète le diagnostic Max, ne le remplace jamais :
// lecture visuelle rapide et strictement factuelle d'UNE photo, réutilise
// recupererPhotoValidee (même infra que le Bloc 1 diagnostic). Rien n'est
// écrit dans Airtable par ce mode : affichage uniquement, le technicien
// reste seul décisionnaire.

const SYSTEM_PROMPT_ANALYSE_PHOTO = `
Tu es Max, et tu donnes une première lecture visuelle rapide d'UNE photo
SAV que le technicien vient d'ajouter, dans l'application Iko Suite. Cette
lecture complète un éventuel diagnostic existant, elle ne le remplace jamais.

RÈGLES ABSOLUES
- Reste strictement factuel : décris uniquement ce qui est réellement
  visible sur la photo.
- Ne présente jamais une hypothèse comme un fait acquis. Si tu formules une
  piste, dis-le explicitement ("cela pourrait indiquer...").
- N'invente jamais un élément, une anomalie ou une mesure absente de
  l'image.
- Si la photo est trop floue, trop sombre, trop éloignée, ou ne permet pas
  de conclure : dis-le clairement dans "limites" plutôt que de forcer une
  lecture. Les autres champs peuvent alors rester vides.
- confiance : "faible" si la photo est peu exploitable, "moyenne" si
  partiellement exploitable, "elevee" UNIQUEMENT si les éléments visibles
  sont nets et sans ambiguïté.
- recommandation : uniquement si une suite concrète et utile se dégage
  clairement de la photo (ex. "prendre une photo plus rapprochée de la
  zone X", "vérifier l'état de..."). Laisse vide sinon.
`;

const OUTIL_ANALYSE_PHOTO = {
  name: "analyser_photo_sav",
  description: "Donne une première lecture factuelle d'une photo SAV, sans jamais inventer d'élément absent de l'image.",
  input_schema: {
    type: "object",
    properties: {
      elements_visibles: { type: "string", description: "Éléments concrets identifiables sur la photo (produit, matériau, environnement...)." },
      anomalie_dommage: { type: "string", description: "Anomalie ou dommage apparent, si réellement visible. Vide sinon." },
      zone_concernee: { type: "string", description: "Zone ou partie précise concernée par l'anomalie, si identifiable." },
      indices_diagnostic: { type: "string", description: "Indices utiles pour orienter le diagnostic, formulés prudemment." },
      confiance: { type: "string", enum: NIVEAUX_CONFIANCE, description: "Niveau de confiance honnête dans cette lecture." },
      recommandation: { type: "string", description: "Recommandation concrète pour la suite, uniquement si elle se dégage clairement de la photo." },
      limites: { type: "string", description: "À remplir si la photo est insuffisante, floue ou ambiguë pour conclure ; vide sinon." },
    },
    required: ["elements_visibles", "anomalie_dommage", "zone_concernee", "indices_diagnostic", "confiance", "recommandation", "limites"],
  },
};

async function traiterAnalysePhoto(req, res, body, cle) {
  try {
    const photo = await recupererPhotoValidee(String(body.photoUrl || ""));
    if (!photo) {
      return res.status(200).json({ erreur: "", limites: "Photo inaccessible ou illisible : aucune analyse possible.", nonExploitable: true });
    }

    const contexteRecu = body.contexte && typeof body.contexte === "object" ? body.contexte : {};
    const contexte = {
      produit: String(contexteRecu.produit || "").slice(0, 200),
      probleme: String(contexteRecu.probleme || "").slice(0, 500),
      diagnosticExistant: String(contexteRecu.diagnosticExistant || "").slice(0, 500),
      metier: String(contexteRecu.metier || "").slice(0, 60),
    };

    const blocsContenu = [
      { type: "image", source: { type: "base64", media_type: photo.media_type, data: photo.data } },
      { type: "text", text: "Contexte de l'intervention (JSON, purement informatif, ne décrit pas forcément ce qui est visible sur CETTE photo) :\n" + JSON.stringify(contexte) },
    ];

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELE_SONNET,
        max_tokens: 500,
        temperature: 0.2,
        system: [{ type: "text", text: SYSTEM_PROMPT_ANALYSE_PHOTO, cache_control: { type: "ephemeral" } }],
        tools: [OUTIL_ANALYSE_PHOTO],
        tool_choice: { type: "tool", name: "analyser_photo_sav" },
        messages: [{ role: "user", content: blocsContenu }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic (analyse photo):", reponse.status, detail);
      return res.status(502).json({ erreur: "Analyse photo momentanément indisponible." });
    }

    const data = await reponse.json();
    const appel = (Array.isArray(data.content) ? data.content : []).find(b => b.type === "tool_use" && b.name === "analyser_photo_sav");
    if (!appel) return res.status(502).json({ erreur: "Réponse d'analyse invalide." });

    const sortie = appel.input || {};
    return res.status(200).json({
      elements_visibles: String(sortie.elements_visibles || ""),
      anomalie_dommage: String(sortie.anomalie_dommage || ""),
      zone_concernee: String(sortie.zone_concernee || ""),
      indices_diagnostic: String(sortie.indices_diagnostic || ""),
      confiance: NIVEAUX_CONFIANCE.includes(sortie.confiance) ? sortie.confiance : "moyenne",
      recommandation: String(sortie.recommandation || ""),
      limites: String(sortie.limites || ""),
    });
  } catch (e) {
    console.error("Erreur traiterAnalysePhoto:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue pendant l'analyse de la photo." });
  }
}

// ==================== Bloc 2C : suggestions de lignes de devis ====================

const SYSTEM_PROMPT_DEVIS = `
Tu es Max, assistant du technicien pour préparer un devis sur place dans
l'application Iko Suite. Tu reçois le problème du ticket et le catalogue
RÉEL du client (produits et main d'œuvre, avec leurs identifiants exacts).

RÈGLES ABSOLUES
- Tu ne peux proposer QUE des lignes dont le catalogue_id existe
  EXACTEMENT dans le catalogue fourni. N'invente jamais un identifiant.
- Ne propose jamais de prix, référence ou désignation : le serveur les
  recalcule depuis le catalogue réel, tu n'as qu'à choisir le bon
  catalogue_id et une quantité raisonnable.
- Justifie chaque ligne brièvement en lien avec le problème décrit.
- Si aucune ligne du catalogue ne correspond, renvoie un tableau vide.
`;

const OUTIL_DEVIS = {
  name: "suggerer_lignes_devis",
  description: "Suggère des lignes de devis en piochant EXCLUSIVEMENT dans le catalogue réel fourni.",
  input_schema: {
    type: "object",
    properties: {
      lignes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            catalogue_id: { type: "string", description: "Identifiant exact d'un élément du catalogue fourni (jamais inventé)." },
            quantite: { type: "number" },
            justification: { type: "string", description: "Courte justification en lien avec le problème du ticket." },
          },
          required: ["catalogue_id", "quantite", "justification"],
        },
      },
      resume_vocal: { type: "string" },
    },
    required: ["lignes", "resume_vocal"],
  },
};

// ==================== Bloc 2B : structuration du compte-rendu vocal ====================

const SYSTEM_PROMPT_COMPTE_RENDU = `
Tu structures un compte-rendu d'intervention dicté par un technicien
menuiserie/BTP, dans l'application Iko Suite, en 6 rubriques :
fait_constate (constat / problème), diagnostic, intervention_realisee,
piece_action_necessaire (pièces utilisées ou à prévoir), resultat,
suite_a_donner.

RÈGLES ABSOLUES
- N'invente jamais une rubrique ou une information absente du texte
  dicté. Si une rubrique n'est pas mentionnée, renvoie une chaîne vide
  pour cette rubrique plutôt que d'inventer.
- Reformule de façon claire et professionnelle, sans dénaturer le sens.
- Ne rajoute aucune information qui ne provient pas du texte dicté.
`;

const OUTIL_COMPTE_RENDU = {
  name: "structurer_compte_rendu",
  description: "Structure un compte-rendu dicté par le technicien en rubriques, sans jamais inventer d'information absente.",
  input_schema: {
    type: "object",
    properties: {
      fait_constate: { type: "string", description: "Constat / problème rapporté par le client ou observé." },
      diagnostic: { type: "string", description: "Cause identifiée par le technicien, si mentionnée dans la dictée." },
      intervention_realisee: { type: "string" },
      piece_action_necessaire: { type: "string", description: "Pièces utilisées pendant l'intervention, ou pièces/actions à prévoir plus tard." },
      resultat: { type: "string", description: "Résultat de l'intervention (fonctionne, à revoir, partiellement résolu, etc.), si mentionné." },
      suite_a_donner: { type: "string" },
    },
    required: ["fait_constate", "diagnostic", "intervention_realisee", "piece_action_necessaire", "resultat", "suite_a_donner"],
  },
};

// ---- Bloc 1 : téléchargement + validation d'une photo avant envoi à
// Claude Vision. Ne lève jamais d'exception : retourne null si l'image
// est inaccessible, trop grosse, pas une image, ou si 6s sont dépassées —
// le diagnostic continue simplement sans cette photo.
function detecterMimeReel(tampon) {
  if (tampon.length >= 3 && tampon[0] === 0xff && tampon[1] === 0xd8 && tampon[2] === 0xff) return "image/jpeg";
  if (tampon.length >= 8 && tampon[0] === 0x89 && tampon[1] === 0x50 && tampon[2] === 0x4e && tampon[3] === 0x47) return "image/png";
  if (tampon.length >= 12 && tampon.toString("ascii", 0, 4) === "RIFF" && tampon.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (tampon.length >= 6 && (tampon.toString("ascii", 0, 6) === "GIF87a" || tampon.toString("ascii", 0, 6) === "GIF89a")) return "image/gif";
  return null;
}

async function recupererPhotoValidee(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) return null;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_PHOTO_MS);
  try {
    const reponse = await fetch(url.trim(), { signal: controleur.signal });
    if (!reponse.ok) return null;
    const contentType = (reponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const longueurAnnoncee = Number(reponse.headers.get("content-length") || 0);
    if (longueurAnnoncee && longueurAnnoncee > MAX_OCTETS_PHOTO) return null;
    const tampon = Buffer.from(await reponse.arrayBuffer());
    if (tampon.length === 0 || tampon.length > MAX_OCTETS_PHOTO) return null;
    const mimeReel = detecterMimeReel(tampon) || (MIME_IMAGE_AUTORISES.includes(contentType) ? contentType : null);
    if (!mimeReel || !MIME_IMAGE_AUTORISES.includes(mimeReel)) return null;
    return { media_type: mimeReel, data: tampon.toString("base64") };
  } catch (e) {
    return null; // timeout, DNS, image inaccessible... on ignore proprement
  } finally {
    clearTimeout(minuteur);
  }
}

const TOOLS = [
  {
    name: "filtrer_onglet",
    description: "Change l'onglet affiche dans la liste des tickets du technicien.",
    input_schema: {
      type: "object",
      properties: {
        onglet: { type: "string", enum: ONGLETS_VALIDES },
      },
      required: ["onglet"],
    },
  },
  {
    name: "ouvrir_itineraire",
    description: "Ouvre le calcul d'itineraire optimise pour la tournee du jour.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "ouvrir_ticket",
    description: "Ouvre la fiche detaillee d'un ticket precis identifie dans la liste fournie.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Identifiant exact (champ id) du ticket, pas son numero affiche." },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "reponse_vocale",
    description: "Repond simplement a voix haute, sans modifier l'affichage (question factuelle ou demande de precision).",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
    },
  },
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erreur: "Methode non autorisee" });
  }

  if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
  if (!verifierDebit(req)) return reponseBloquee(res, "debit");

  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    console.error("ANTHROPIC_API_KEY absente des variables d'environnement");
    return res.status(500).json({ erreur: "Configuration serveur incomplete" });
  }

  try {
    const body = req.body || {};

    // Bloc 1 + Bloc 2 : modes dédiés, distincts de la navigation par
    // défaut. Origine et débit déjà vérifiés ci-dessus pour tous les modes.
    const modeRequete = ["diagnostic", "devis_suggestion", "structurer_compte_rendu", "analyser_photo"].includes(body.mode)
      ? body.mode
      : "navigation";
    if (modeRequete === "diagnostic") return await traiterDiagnostic(req, res, body, cle);
    if (modeRequete === "devis_suggestion") return await traiterDevisSuggestion(req, res, body, cle);
    if (modeRequete === "structurer_compte_rendu") return await traiterCompteRendu(req, res, body, cle);
    if (modeRequete === "analyser_photo") return await traiterAnalysePhoto(req, res, body, cle);

    // Nom deja resolu cote client (technicien.html lit window.IKO_CLIENT_INFO,
    // deja charge via la session/le tenant : pas de nouvel appel Airtable ici).
    const nomAssistantActuel = nomAssistantDepuisEntree(body.nomAssistant, "technicien");

    const message = String(body.message || "").slice(0, MAX_CHARS_MESSAGE).trim();
    if (!message) {
      return res.status(400).json({ erreur: "Aucune commande recue" });
    }
    const ticketsContexte = Array.isArray(body.tickets) ? body.tickets.slice(0, MAX_TICKETS_CONTEXTE) : [];
    const ongletActuel = String(body.ongletActuel || "aujourd_hui").slice(0, 40);
    const historique = Array.isArray(body.historique) ? body.historique.slice(-6) : [];
    const historiqueClient = Array.isArray(body.historiqueClient) ? body.historiqueClient.slice(0, 3) : null;
    // Connaissance entreprise transmise par le client (deja extraite du
    // record Clients qu'il a lui-meme charge - voir technicien.html).
    // Filtree ici uniquement (actif/metier), jamais utilisee pour
    // determiner un perimetre tenant : voir commentaire ci-dessus.
    // Priorisee ensuite selon la commande vocale en cours (affinerPourPrompt).
    const connaissanceActuelle = affinerPourPrompt(normaliserConnaissance(body.connaissance, String(body.metier || "").slice(0, 60)), message);
    // Analytics SAV : deja calcule cote navigateur (window.AnalyticsSAV,
    // module partage - voir technicien.html) a partir des tickets deja
    // charges. Le serveur ne fait que FORMATER (aucun recalcul, aucun
    // appel Airtable ici).
    const analyticsSAVActuelles = body.analyticsSAV || null;

    const blocHistorique = historique.length
      ? "\n\nEchanges precedents de cette session (le plus recent en dernier) :\n" +
        historique.map(h => (h.role === "user" ? "Technicien: " : "Toi: ") + String(h.texte || "").slice(0, 300)).join("\n")
      : "";

    const blocHistoriqueClient = historiqueClient && historiqueClient.length
      ? "\n\nHistorique du client concerne (mesures/poses precedentes, si connu) :\n" + JSON.stringify(historiqueClient)
      : "";

    const messageUtilisateur = "Onglet actuellement affiche : " + ongletActuel +
      "\n\nTickets actuellement charges (JSON) :\n" +
      JSON.stringify(ticketsContexte) +
      blocHistorique +
      blocHistoriqueClient +
      "\n\nCommande vocale du technicien : \"" + message + "\"";

    const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const BLOC_REUNION_MAX = `

MODE REUNION D'EQUIPE (contexte special)
Tu es actuellement dans la salle de reunion virtuelle avec Stephane,
IKO, Amandine et Toise, pas sur le terrain avec un technicien. Tu as
la liste reelle des tickets en cours dans le JSON fourni : utilise-la
pour repondre precisement (dates, agences, statuts) au lieu de dire
que tu n'as rien charge.

Nous sommes aujourd'hui le ${aujourdhui}.
EXEMPLE OBLIGATOIRE A SUIVRE si un ticket a pour creneau "lundi 17 aout" et qu'aujourd'hui n'est pas le 17 aout :
- MAUVAIS (interdit) : "Salut, t'as 4 tickets ce matin."
- BON (a faire) : "Salut, t'as 4 tickets prevus lundi 17 aout."
Ne dis "ce matin" ou "aujourd'hui" QUE si la date du ticket est
reellement celle d'aujourd'hui. Sinon, cite toujours la date exacte
du ticket telle qu'elle est ecrite.

- Personnalite : professionnel, sympa, direct entre collegues.
  Tutoiement.
- MAXIMUM 2 phrases courtes. Reponds directement a partir des donnees
  fournies, ne redemande pas de precision si l'info est deja dans la
  liste des tickets.
- Si Stephane te salue ("bonjour", "bonjour a tous"...), reponds par
  une salutation cordiale d'une phrase.
- Ta mission en reunion : faire remonter a IKO les problemes cote
  terrain que tu detectes ou soupconnes : tickets d'intervention non
  remplis par les techniciens, rendez-vous manques et leur raison
  probable, retards recurrents. Sois honnete et precis, pas alarmiste.
- Reponses orales, sans markdown ni emoji.`;

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 400,
        temperature: 0.3,
        system: [{ type: "text", text: buildSystemPrompt(connaissanceActuelle, analyticsSAVActuelles, nomAssistantActuel) + (body.reunion ? BLOC_REUNION_MAX : ""), cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: messageUtilisateur }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic:", reponse.status, detail);
      return res.status(502).json({ erreur: nomAssistantActuel + " est momentanément indisponible." });
    }

    const data = await reponse.json();
    const blocs = Array.isArray(data.content) ? data.content : [];
    const appelsOutils = blocs.filter(b => b.type === "tool_use");

    let texteReponse = "";
    const actions = [];
    for (const appel of appelsOutils) {
      if (appel.name === "reponse_vocale") {
        texteReponse = String(appel.input?.message || "").slice(0, 300);
      } else {
        actions.push(appel);
      }
    }
    if (!texteReponse) {
      const texteBrut = blocs.filter(b => b.type === "text").map(b => b.text || "").join(" ").trim();
      texteReponse = texteBrut || "C'est fait.";
    }

    return res.status(200).json({ actions, reponse: texteReponse });
  } catch (e) {
    console.error("Erreur chat-technicien:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}

// ==================== Bloc 1 : diagnostic assisté (Sonnet 5) ====================
async function traiterDiagnostic(req, res, body, cle) {
  try {
    const ticket = body.ticket && typeof body.ticket === "object" ? body.ticket : {};
    const message = String(body.message || "").slice(0, MAX_CHARS_MESSAGE).trim();
    const demanderPhotos = body.analyserPhoto === true;
    const historique = Array.isArray(body.historique) ? body.historique.slice(-6) : [];

    const contexteTicket = {
      numero: String(ticket.numero || "").slice(0, 60),
      produit: String(ticket.produit || "").slice(0, 200),
      probleme: String(ticket.probleme || "").slice(0, 500),
      garantie: String(ticket.garantie || "").slice(0, 60),
      adresse: String(ticket.adresse || "").slice(0, 200),
      commentaireExistant: String(ticket.commentaireExistant || "").slice(0, 500),
      diagnosticExistant: String(ticket.diagnosticExistant || "").slice(0, 500),
      urgence: String(ticket.urgence || "").slice(0, 40),
      historiqueToise: Array.isArray(ticket.historiqueToise) ? ticket.historiqueToise.slice(0, 3) : null,
    };

    // Bloc 3 - axe E : historique des tickets précédents du même client,
    // tronqué et assaini côté serveur (défense en profondeur, même si le
    // client tronque déjà à 3 avant envoi).
    const historiqueTickets = Array.isArray(ticket.historiqueTickets)
      ? ticket.historiqueTickets.slice(0, MAX_TICKETS_HISTORIQUE).map(h => ({
          date: String(h?.date || "").slice(0, 20),
          produit: String(h?.produit || "").slice(0, 100),
          probleme: String(h?.probleme || "").slice(0, 200),
          statut: String(h?.statut || "").slice(0, 40),
          diagnostic: String(h?.diagnostic || "").slice(0, 300),
        }))
      : [];
    if (historiqueTickets.length) contexteTicket.historiqueTicketsClient = historiqueTickets;

    // Diagnostic IA métier V1 : métier + connaissance entreprise déjà
    // chargés côté client (window.IKO_CLIENT_INFO), transmis tels quels par
    // technicien.html — aucun nouvel appel Airtable ici, mêmes fonctions de
    // filtrage que le chat Max principal (_connaissance.js, déjà importé).
    const metierRecu = String(body.metier || "").slice(0, 60);
    const tradeIdDiagnostic = resoudreTradeIdDiagnostic(metierRecu);
    const vocabMetierDiagnostic = tradeIdDiagnostic ? TRADES_DIAGNOSTIC[tradeIdDiagnostic] : null;
    const connaissanceDiagnostic = affinerPourPrompt(
      normaliserConnaissance(body.connaissance, metierRecu),
      message || contexteTicket.probleme
    );

    // Analyse photo V1 (Bloc 2D) : lue si déjà présente côté client, jamais
    // relancée ici (pas de nouvel appel Anthropic Vision, pas de second
    // déclenchement) — purement complémentaire au diagnostic.
    const analysePhotoRecue = body.analysePhotoExistante && typeof body.analysePhotoExistante === "object"
      ? {
          elements_visibles: String(body.analysePhotoExistante.elements_visibles || "").slice(0, 500),
          anomalie_dommage: String(body.analysePhotoExistante.anomalie_dommage || "").slice(0, 500),
          zone_concernee: String(body.analysePhotoExistante.zone_concernee || "").slice(0, 200),
          indices_diagnostic: String(body.analysePhotoExistante.indices_diagnostic || "").slice(0, 500),
          confiance: String(body.analysePhotoExistante.confiance || "").slice(0, 20),
          limites: String(body.analysePhotoExistante.limites || "").slice(0, 300),
        }
      : null;

    const blocsContenu = [];
    let nbPhotosAnalysees = 0;
    if (demanderPhotos) {
      const urlsPhotos = Array.isArray(body.photosUrls) ? body.photosUrls.slice(0, MAX_PHOTOS_DIAGNOSTIC) : [];
      const resultats = await Promise.allSettled(urlsPhotos.map(recupererPhotoValidee));
      for (const r of resultats) {
        if (r.status === "fulfilled" && r.value) {
          blocsContenu.push({ type: "image", source: { type: "base64", media_type: r.value.media_type, data: r.value.data } });
          nbPhotosAnalysees += 1;
        }
      }
    }

    const blocMetierDiagnostic = vocabMetierDiagnostic
      ? "\n\nContexte metier de l'entreprise (a utiliser pour interpreter, jamais pour inventer) :\n" +
        "Metier : " + vocabMetierDiagnostic.nom_metier + "\n" +
        "Produits typiques : " + vocabMetierDiagnostic.produits.join(", ") + "\n" +
        "Pistes de diagnostic de base pour ce metier (reperes generaux, pas un diagnostic sur ce ticket) :\n" +
        vocabMetierDiagnostic.diagnostics.map(d => "- " + d).join("\n")
      : "";

    const blocAnalysePhotoDiagnostic = analysePhotoRecue
      ? "\n\nAnalyse deja faite de la derniere photo ajoutee sur ce ticket (NE PAS la redemander, deja disponible) :\n" +
        JSON.stringify(analysePhotoRecue)
      : "";

    const texteContexte =
      "Ticket ouvert (JSON) :\n" + JSON.stringify(contexteTicket) +
      (historique.length
        ? "\n\nEchanges precedents de cette session :\n" +
          historique.map(h => (h.role === "user" ? "Technicien: " : "Toi: ") + String(h.texte || "").slice(0, 300)).join("\n")
        : "") +
      blocMetierDiagnostic +
      blocPromptConnaissance(connaissanceDiagnostic) +
      blocAnalysePhotoDiagnostic +
      "\n\nDemande du technicien : \"" + (message || "Aide-moi a diagnostiquer ce ticket.") + "\"" +
      (demanderPhotos
        ? "\n\n" + nbPhotosAnalysees + " photo(s) jointe(s) ci-dessus a analyser."
        : "\n\nAucune photo a analyser pour cette demande.");

    blocsContenu.push({ type: "text", text: texteContexte });

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELE_SONNET,
        max_tokens: 700,
        temperature: 0.2,
        system: [{ type: "text", text: SYSTEM_PROMPT_DIAGNOSTIC, cache_control: { type: "ephemeral" } }],
        tools: [OUTIL_DIAGNOSTIC],
        tool_choice: { type: "tool", name: "diagnostic_assiste" },
        messages: [{ role: "user", content: blocsContenu }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic (diagnostic):", reponse.status, detail);
      return res.status(502).json({ erreur: "Max est momentanément indisponible pour le diagnostic." });
    }

    const data = await reponse.json();
    const appel = (Array.isArray(data.content) ? data.content : []).find(b => b.type === "tool_use" && b.name === "diagnostic_assiste");
    if (!appel) {
      return res.status(502).json({ erreur: "Réponse de diagnostic invalide." });
    }
    const sortie = appel.input || {};
    // Suggestions d'action technicien V1 : assainissement défensif, aucune
    // invention côté serveur — on ne fait que valider/tronquer ce que le
    // modèle a produit à partir du contexte déjà fourni.
    const actionsSuggereesBrutes = Array.isArray(sortie.actions_suggerees) ? sortie.actions_suggerees : [];
    const actionsSuggerees = actionsSuggereesBrutes
      .filter(a => a && typeof a === "object" && String(a.action || "").trim())
      .slice(0, MAX_ACTIONS_SUGGEREES)
      .map(a => ({
        action: String(a.action || "").slice(0, 200),
        justification: String(a.justification || "").slice(0, 300),
        priorite: NIVEAUX_PRIORITE_ACTION.includes(a.priorite) ? a.priorite : "faible",
        verification: String(a.verification || "").slice(0, 300),
      }));
    return res.status(200).json({
      fait: String(sortie.fait || ""),
      signal: String(sortie.signal || ""),
      piste: String(sortie.piste || ""),
      proposition: String(sortie.proposition || ""),
      resume_vocal: String(sortie.resume_vocal || ""),
      action_suggeree: ACTIONS_SUGGERABLES.includes(sortie.action_suggeree) ? sortie.action_suggeree : "aucune",
      confiance: NIVEAUX_CONFIANCE.includes(sortie.confiance) ? sortie.confiance : "moyenne",
      actions_suggerees: actionsSuggerees,
      photosAnalysees: nbPhotosAnalysees,
    });
  } catch (e) {
    console.error("Erreur traiterDiagnostic:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue pendant le diagnostic." });
  }
}

// ==================== Bloc 2C : suggestions de lignes de devis (Haiku) ====================
async function traiterDevisSuggestion(req, res, body, cle) {
  try {
    const ticket = body.ticket && typeof body.ticket === "object" ? body.ticket : {};
    const catalogueRecu = Array.isArray(body.catalogue) ? body.catalogue.slice(0, MAX_CATALOGUE_CONTEXTE) : [];

    const catalogueValide = catalogueRecu
      .filter(c => c && typeof c.id === "string" && c.id)
      .map(c => ({
        id: c.id,
        type: c.type === "mo" ? "mo" : "produit",
        designation: String(c.designation || "").slice(0, 200),
        prix: Number(c.prix) || 0,
      }));

    if (!catalogueValide.length) {
      return res.status(200).json({ lignes: [], resume_vocal: "Le catalogue n'est pas disponible pour ce client.", rejets: 0 });
    }

    const indexCatalogue = new Map(catalogueValide.map(c => [c.id, c]));

    const texteContexte =
      "Ticket (JSON) :\n" + JSON.stringify({
        produit: String(ticket.produit || "").slice(0, 200),
        probleme: String(ticket.probleme || "").slice(0, 500),
      }) +
      "\n\nCatalogue reel disponible (JSON, catalogue_id exact a reutiliser) :\n" +
      JSON.stringify(catalogueValide.map(c => ({ catalogue_id: c.id, type: c.type, designation: c.designation }))) +
      "\n\nDemande du technicien : \"" + String(body.message || "Propose des lignes de devis adaptees.").slice(0, MAX_CHARS_MESSAGE) + "\"";

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 500,
        temperature: 0.2,
        system: [{ type: "text", text: SYSTEM_PROMPT_DEVIS, cache_control: { type: "ephemeral" } }],
        tools: [OUTIL_DEVIS],
        tool_choice: { type: "tool", name: "suggerer_lignes_devis" },
        messages: [{ role: "user", content: texteContexte }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic (devis):", reponse.status, detail);
      return res.status(502).json({ erreur: "Max est momentanément indisponible." });
    }

    const data = await reponse.json();
    const appel = (Array.isArray(data.content) ? data.content : []).find(b => b.type === "tool_use" && b.name === "suggerer_lignes_devis");
    if (!appel) return res.status(502).json({ erreur: "Réponse de suggestion invalide." });

    const lignesBrutes = Array.isArray(appel.input?.lignes) ? appel.input.lignes : [];
    let rejets = 0;
    const lignesValidees = [];
    for (const ligne of lignesBrutes) {
      const ref = indexCatalogue.get(String(ligne?.catalogue_id || ""));
      if (!ref) { rejets += 1; continue; } // catalogue_id halluciné : rejeté côté serveur
      const quantite = Math.max(1, Math.round(Number(ligne.quantite) || 1));
      lignesValidees.push({
        catalogue_id: ref.id,
        type: ref.type,
        designation: ref.designation, // toujours depuis le catalogue reel, jamais depuis Claude
        prix: ref.prix,
        quantite,
        justification: String(ligne.justification || "").slice(0, 200),
      });
    }

    return res.status(200).json({
      lignes: lignesValidees,
      resume_vocal: String(appel.input?.resume_vocal || ""),
      rejets,
    });
  } catch (e) {
    console.error("Erreur traiterDevisSuggestion:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}

// ==================== Bloc 2B : structuration du compte-rendu (Haiku) ====================
async function traiterCompteRendu(req, res, body, cle) {
  try {
    const texteDicte = String(body.texteDicte || "").slice(0, MAX_CHARS_TEXTE_DICTE).trim();
    if (!texteDicte) return res.status(400).json({ erreur: "Aucun texte dicté à structurer." });

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 500,
        temperature: 0.2,
        system: [{ type: "text", text: SYSTEM_PROMPT_COMPTE_RENDU, cache_control: { type: "ephemeral" } }],
        tools: [OUTIL_COMPTE_RENDU],
        tool_choice: { type: "tool", name: "structurer_compte_rendu" },
        messages: [{ role: "user", content: "Texte dicté par le technicien :\n\"" + texteDicte + "\"" }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic (compte-rendu):", reponse.status, detail);
      return res.status(502).json({ erreur: "Max est momentanément indisponible." });
    }

    const data = await reponse.json();
    const appel = (Array.isArray(data.content) ? data.content : []).find(b => b.type === "tool_use" && b.name === "structurer_compte_rendu");
    if (!appel) return res.status(502).json({ erreur: "Réponse invalide." });

    const sortie = appel.input || {};
    return res.status(200).json({
      fait_constate: String(sortie.fait_constate || ""),
      diagnostic: String(sortie.diagnostic || ""),
      intervention_realisee: String(sortie.intervention_realisee || ""),
      piece_action_necessaire: String(sortie.piece_action_necessaire || ""),
      resultat: String(sortie.resultat || ""),
      suite_a_donner: String(sortie.suite_a_donner || ""),
      texte_original: texteDicte,
    });
  } catch (e) {
    console.error("Erreur traiterCompteRendu:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
