import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";

// api/chat-metreur.js
// Relais serveur entre le widget vocal Toise (metreur.html) et l'API
// Claude (Anthropic). Toise remplit la fiche de metre (infos client) et
// ajoute des ouvertures (dimensions, couleur, vitrage...) a partir de la
// dictee du metreur sur le terrain. Si une information necessaire manque,
// elle le signale au metreur au lieu d'inventer une valeur.

const MODELE = "claude-haiku-4-5-20251001";
const MODELE_PHOTO = "claude-sonnet-5"; // lecture de graduation sur photo : precision prioritaire sur le cout
const MAX_CHARS_MESSAGE = 600;
const MAX_TAILLE_IMAGE = 5_000_000; // ~5 Mo en base64

const TYPES_VALIDES = ["Fixe", "Fenêtre", "Porte-fenêtre", "Coulissant", "Porte", "Volet roulant", "Portail", "Véranda", "Ensemble composé", "Autre"];

// Bornes de plausibilite (mm) par type d'ouverture, pour detecter une
// mesure probablement fausse (erreur de lecture photo, virgule mal placee,
// confusion cm/mm...) sans jamais bloquer la saisie : on avertit seulement.
const BORNES_PLAUSIBILITE = {
  "Fixe":              { largeur: [300, 3000],  hauteur: [300, 3000] },
  "Fenêtre":           { largeur: [300, 2000],  hauteur: [300, 2500] },
  "Porte-fenêtre":     { largeur: [600, 2400],  hauteur: [1800, 2600] },
  "Coulissant":        { largeur: [800, 6000],  hauteur: [800, 2600] },
  "Porte":             { largeur: [600, 1200],  hauteur: [1800, 2400] },
  "Volet roulant":     { largeur: [300, 3000],  hauteur: [300, 2500] },
  "Portail":           { largeur: [2000, 8000], hauteur: [800, 2500] },
  "Véranda":           { largeur: [1000, 8000], hauteur: [1800, 3500] },
  "Ensemble composé":  { largeur: [500, 10000], hauteur: [500, 4000] },
  "Autre":             { largeur: [100, 10000], hauteur: [100, 5000] },
};

function verifierPlausibilite(type, largeur, hauteur) {
  const bornes = BORNES_PLAUSIBILITE[type];
  if (!bornes || !largeur || !hauteur) return null;
  const alertes = [];
  if (largeur < bornes.largeur[0] || largeur > bornes.largeur[1]) {
    alertes.push("largeur " + largeur + " mm inhabituelle pour un " + type.toLowerCase());
  }
  if (hauteur < bornes.hauteur[0] || hauteur > bornes.hauteur[1]) {
    alertes.push("hauteur " + hauteur + " mm inhabituelle pour un " + type.toLowerCase());
  }
  return alertes.length ? alertes.join(", ") : null;
}
const REMPLISSAGES_VALIDES = ["Fixe", "Ouvrant à la française gauche", "Ouvrant à la française droite", "Oscillo-battant gauche", "Oscillo-battant droite", "Coulissant", "Porte gauche", "Porte droite", "Soufflet"];
const POSES_VALIDES = ["Rénovation totale", "Rénovation partielle", "Neuf en applique", "Neuf en tunnel"];

const SYSTEM_PROMPT = `
Tu es Toise, l'assistante vocale du métreur sur le terrain, dans
l'application Iko Suite. Le métreur dicte les informations d'une
ouverture (fenêtre, porte...) ou de la fiche client pendant qu'il
prend ses mesures, souvent les mains occupées.

Tu recois l'etat actuel de la fiche (client, adresse, telephone,
numero dossier) et la liste des ouvertures deja ajoutees.

REGLES
- Pour une nouvelle ouverture (fenetre, porte...), utilise
  ajouter_ouverture avec les champs que tu as compris. Le repere
  (ex: F1, P2) : si le metreur ne le donne pas, laisse-le vide, il
  sera genere automatiquement.
- Dimensions en millimetres. Si le metreur dit des centimetres ou des
  metres, convertis toujours en mm (ex: "120 par 100" en contexte
  fenetre = 1200 x 1000 mm le plus souvent ; si ambigu, demande).
- IMPORTANT : si des informations essentielles manquent pour
  l'ouverture (au minimum le type ET les deux dimensions), n'appelle
  PAS ajouter_ouverture : utilise reponse_vocale pour demander
  precisement ce qui manque, en une phrase courte.
- Pour les infos client (nom, adresse, telephone, numero de dossier),
  utilise renseigner_fiche.
- Si le metreur corrige une ouverture DEJA dans la liste fournie (ex:
  "corrige la largeur de F2 à 1300", "F1 c'est finalement en gris
  anthracite"), utilise modifier_ouverture avec le repere exact et
  uniquement les champs a changer. Ne recree jamais une ouverture qui
  existe deja avec ajouter_ouverture.
- Pour une question ou un doute, utilise reponse_vocale.
- Reponses vocales tres courtes (1 phrase), sans markdown, sans
  emoji, tutoiement direct comme un collegue sur chantier.
- Un seul outil a la fois.

TYPE DE POSE (essentiel, ne jamais deviner)
Chaque ouverture doit avoir un type de pose, car il determine OU se
prend la reference de mesure :
- "Rénovation totale" : mesure sur le tableau brut (l'ouverture nue,
  ancien dormant depose).
- "Rénovation partielle" : mesure sur l'ancien dormant conserve.
- "Neuf en applique" : mesure sur la face du mur, le dormant vient se
  poser dessus.
- "Neuf en tunnel" : mesure dans l'epaisseur du mur, dormant encastre.
Si le metreur ne precise pas le type de pose pour une ouverture,
demande-le via reponse_vocale avant d'ajouter — ne suppose jamais un
type de pose par defaut, une erreur ici fausse toute la fabrication.

LECTURE DE COTE SUR PHOTO (mètre ruban dans le cadre)
Si une photo est fournie avec le message, le metreur a pris une photo
de l'ouverture avec un metre ruban deroule dedans pour te donner une
reference d'echelle reelle.
- Lis PRECISEMENT la graduation visible sur le ruban dans la photo.
  Ne jamais estimer une dimension "a l'oeil" a partir de la seule
  photo sans metre ruban visible : sans graduation lisible, tu n'as
  aucune echelle fiable.
- Convertis la lecture en millimetres.
- Si la graduation n'est pas clairement lisible sur l'image (flou,
  angle, doigt qui cache le chiffre...), n'invente jamais un chiffre :
  utilise reponse_vocale pour demander une nouvelle photo plus nette
  ou la valeur a l'oral.
- Associe toujours la lecture au type de pose dicte par le metreur
  (voir section precedente), car la meme photo peut correspondre a
  une mesure de tableau brut, d'ancien dormant, de mur ou de tunnel
  selon ce qui a ete dit.
- Une fois la cote lue avec certitude, utilise reponse_vocale pour la
  confirmer a voix haute avant de l'enregistrer via ajouter_ouverture
  ou modifier_ouverture (le metreur doit pouvoir corriger a l'oral si
  la lecture est fausse).

ENSEMBLES COMPOSES (plusieurs vantaux dans une meme ouverture)
Un "Ensemble composé" est une ouverture decoupee en plusieurs zones,
chacune avec son propre remplissage (fixe, ouvrant, coulissant...).
La decoupe se fait avec :
- meneaux : liste des positions verticales (en mm depuis la gauche)
  qui separent l'ouverture en colonnes. Ex: pour une fenetre de
  2400mm de large coupee au milieu, meneaux = [1200].
- traverses : liste des positions horizontales (en mm depuis le bas)
  qui separent l'ouverture en lignes. Vide si l'ensemble n'a qu'une
  seule ligne (cas le plus frequent).
- zones : une entree par case du quadrillage resultant, avec :
  - colonne : 0 = la plus a gauche, 1 = suivante, etc.
  - ligne : 0 = la plus basse, 1 = suivante, etc. (0 si une seule ligne)
  - remplissage : un parmi "Fixe", "Ouvrant à la française gauche",
    "Ouvrant à la française droite", "Oscillo-battant gauche",
    "Oscillo-battant droite", "Coulissant", "Porte gauche",
    "Porte droite", "Soufflet"

Quand le metreur decrit un ensemble composé, utilise type
"Ensemble composé" et remplis meneaux/traverses/zones en consequence.
Exemple : "Ensemble composé F3, 2400 par 1500, un meneau au milieu,
la partie gauche fixe, la partie droite oscillo-battant" donne :
type: "Ensemble composé", largeur: 2400, hauteur: 1500,
meneaux: [1200], zones: [
  { colonne: 0, ligne: 0, remplissage: "Fixe" },
  { colonne: 1, ligne: 0, remplissage: "Oscillo-battant droite" }
].
Si le metreur decrit un ensemble sans preciser le remplissage de
chaque partie, demande-le avant d'ajouter (via reponse_vocale) plutot
que de deviner.
`;

const TOOLS = [
  {
    name: "ajouter_ouverture",
    description: "Ajoute une nouvelle ouverture (fenetre, porte, etc.) a la fiche de metre, avec les informations dictees. N'appelle cet outil que si le type, pose, ET les deux dimensions (largeur et hauteur) sont connus. Pour un 'Ensemble composé', ajoute aussi meneaux/traverses/zones (voir instructions).",
    input_schema: {
      type: "object",
      properties: {
        repere: { type: "string", description: "Repere de l'ouverture (ex: F1, P2). Laisser vide si non precise." },
        type: { type: "string", enum: TYPES_VALIDES },
        pose: { type: "string", enum: POSES_VALIDES, description: "Type de pose, determine ou se prend la reference de mesure. Toujours demander si non precise." },
        largeur: { type: "number", description: "Largeur en millimetres." },
        hauteur: { type: "number", description: "Hauteur en millimetres." },
        couleur: { type: "string", description: "Couleur ou reference RAL." },
        vitrage: { type: "string", description: "Type de vitrage (ex: double vitrage, triple vitrage)." },
        note: { type: "string", description: "Remarque libre du metreur, si utile." },
        meneaux: { type: "array", items: { type: "number" }, description: "Ensemble composé uniquement : positions verticales en mm depuis la gauche qui separent les colonnes." },
        traverses: { type: "array", items: { type: "number" }, description: "Ensemble composé uniquement : positions horizontales en mm depuis le bas qui separent les lignes." },
        zones: {
          type: "array",
          description: "Ensemble composé uniquement : le remplissage de chaque case du quadrillage.",
          items: {
            type: "object",
            properties: {
              colonne: { type: "integer", description: "0 = colonne la plus a gauche." },
              ligne: { type: "integer", description: "0 = ligne la plus basse." },
              remplissage: { type: "string", enum: REMPLISSAGES_VALIDES },
            },
            required: ["colonne", "ligne", "remplissage"],
          },
        },
      },
      required: ["type", "pose", "largeur", "hauteur"],
    },
  },
  {
    name: "modifier_ouverture",
    description: "Corrige une ou plusieurs valeurs d'une ouverture DEJA existante, identifiee par son repere (ex: F2). N'ajoute pas une nouvelle ouverture.",
    input_schema: {
      type: "object",
      properties: {
        repere: { type: "string", description: "Repere exact de l'ouverture a corriger (ex: F2), tel qu'il apparait dans la liste fournie." },
        largeur: { type: "number" },
        hauteur: { type: "number" },
        couleur: { type: "string" },
        vitrage: { type: "string" },
        type: { type: "string", enum: TYPES_VALIDES },
        pose: { type: "string", enum: POSES_VALIDES },
        note: { type: "string" },
      },
      required: ["repere"],
    },
  },
  {
    name: "renseigner_fiche",
    description: "Met a jour les informations client de la fiche de metre.",
    input_schema: {
      type: "object",
      properties: {
        client: { type: "string" },
        adresse: { type: "string" },
        telephone: { type: "string" },
        numeroDossier: { type: "string" },
      },
    },
  },
  {
    name: "reponse_vocale",
    description: "Repond ou demande une precision a voix haute, sans modifier la fiche.",
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
    const message = String(body.message || "").slice(0, MAX_CHARS_MESSAGE).trim();
    const image = body.image ? String(body.image) : "";
    if (!message && !image) {
      return res.status(400).json({ erreur: "Aucune commande ni photo recue" });
    }
    if (image && image.length > MAX_TAILLE_IMAGE) {
      return res.status(400).json({ erreur: "Photo trop volumineuse." });
    }
    const fiche = body.fiche || {};
    const ouvertures = Array.isArray(body.ouvertures) ? body.ouvertures.slice(0, 60) : [];
    const historique = Array.isArray(body.historique) ? body.historique.slice(-6) : [];

    const blocHistorique = historique.length
      ? "\n\nEchanges precedents de cette session (le plus recent en dernier) :\n" +
        historique.map(h => (h.role === "user" ? "Metreur: " : "Toi: ") + String(h.texte || "").slice(0, 300)).join("\n")
      : "";

    const messageUtilisateur = "Fiche actuelle (JSON) : " + JSON.stringify(fiche) +
      "\n\nOuvertures deja ajoutees (JSON) : " + JSON.stringify(ouvertures) +
      blocHistorique +
      (image
        ? "\n\nUne photo est jointe (metre ruban dans le cadre). Dictee du metreur accompagnant la photo : \"" + (message || "(aucune, lis juste la photo)") + "\""
        : "\n\nDictee du metreur : \"" + message + "\"");

    // Contenu multimodal si une photo est fournie : image + texte, sinon texte seul.
    let contenuMessage = messageUtilisateur;
    if (image) {
      const correspondance = image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (correspondance) {
        contenuMessage = [
          { type: "image", source: { type: "base64", media_type: correspondance[1], data: correspondance[2] } },
          { type: "text", text: messageUtilisateur },
        ];
      }
    }

    const BLOC_REUNION_TOISE = `

MODE REUNION D'EQUIPE (contexte special)
Tu es actuellement dans la salle de reunion virtuelle avec Stephane,
IKO, Amandine et Max, pas sur un chantier avec un metreur.
- Personnalite : professionnelle, posee, aimable entre collegues.
  Tutoiement.
- MAXIMUM 2 phrases courtes. Si la question ne concerne pas les
  metres/fiches de mesure (ex: nombre de tickets, planning technicien),
  dis-le en une phrase et renvoie vers IKO ou Max, ne te lance jamais
  dans une explication de ton propre role.
- Si Stephane te salue ("bonjour", "bonjour a tous"...), reponds par
  une salutation cordiale d'une phrase.
- Ta mission en reunion : faire remonter a IKO les problemes de ton
  domaine : fiches de mesure en retard ou incompletes, informations
  manquantes recurrentes (type de pose non precise, dimensions
  douteuses...). Sois honnete et precise.
- Reponses orales, sans markdown ni emoji.`;

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: image ? MODELE_PHOTO : MODELE,
        max_tokens: 400,
        temperature: 0.2,
        system: SYSTEM_PROMPT + (body.reunion ? BLOC_REUNION_TOISE : ""),
        tools: TOOLS,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: contenuMessage }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic:", reponse.status, detail);
      return res.status(502).json({ erreur: "Toise est momentanément indisponible." });
    }

    const data = await reponse.json();
    const blocs = Array.isArray(data.content) ? data.content : [];
    const appelsOutils = blocs.filter(b => b.type === "tool_use");

    let texteReponse = "";
    const actions = [];
    const alertesPlausibilite = [];
    for (const appel of appelsOutils) {
      if (appel.name === "reponse_vocale") {
        texteReponse = String(appel.input?.message || "").slice(0, 300);
      } else {
        if ((appel.name === "ajouter_ouverture" || appel.name === "modifier_ouverture") && appel.input?.largeur && appel.input?.hauteur) {
          const alerte = verifierPlausibilite(appel.input.type, appel.input.largeur, appel.input.hauteur);
          if (alerte) {
            appel.input._suspect = true;
            alertesPlausibilite.push((appel.input.repere || "cette ouverture") + " : " + alerte);
          }
        }
        actions.push(appel);
      }
    }
    if (!texteReponse) {
      const texteBrut = blocs.filter(b => b.type === "text").map(b => b.text || "").join(" ").trim();
      texteReponse = texteBrut || "C'est noté.";
    }
    if (alertesPlausibilite.length) {
      texteReponse += " Attention, à vérifier : " + alertesPlausibilite.join(" ; ") + ".";
    }

    return res.status(200).json({ actions, reponse: texteReponse });
  } catch (e) {
    console.error("Erreur chat-metreur:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
