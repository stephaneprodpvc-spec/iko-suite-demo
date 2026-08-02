// api/chat-metreur.js
// Relais serveur entre le widget vocal Toise (metreur.html) et l'API
// Claude (Anthropic). Toise remplit la fiche de metre (infos client) et
// ajoute des ouvertures (dimensions, couleur, vitrage...) a partir de la
// dictee du metreur sur le terrain. Si une information necessaire manque,
// elle le signale au metreur au lieu d'inventer une valeur.

const MODELE = "claude-haiku-4-5-20251001";
const MAX_CHARS_MESSAGE = 600;

const TYPES_VALIDES = ["Fixe", "Fenêtre", "Porte-fenêtre", "Coulissant", "Porte", "Volet roulant", "Portail", "Véranda", "Autre"];

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
- Pour une question ou un doute, utilise reponse_vocale.
- Reponses vocales tres courtes (1 phrase), sans markdown, sans
  emoji, tutoiement direct comme un collegue sur chantier.
- Un seul outil a la fois.
`;

const TOOLS = [
  {
    name: "ajouter_ouverture",
    description: "Ajoute une nouvelle ouverture (fenetre, porte, etc.) a la fiche de metre, avec les informations dictees. N'appelle cet outil que si le type ET les deux dimensions (largeur et hauteur) sont connus.",
    input_schema: {
      type: "object",
      properties: {
        repere: { type: "string", description: "Repere de l'ouverture (ex: F1, P2). Laisser vide si non precise." },
        type: { type: "string", enum: TYPES_VALIDES },
        largeur: { type: "number", description: "Largeur en millimetres." },
        hauteur: { type: "number", description: "Hauteur en millimetres." },
        couleur: { type: "string", description: "Couleur ou reference RAL." },
        vitrage: { type: "string", description: "Type de vitrage (ex: double vitrage, triple vitrage)." },
        note: { type: "string", description: "Remarque libre du metreur, si utile." },
      },
      required: ["type", "largeur", "hauteur"],
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

  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    console.error("ANTHROPIC_API_KEY absente des variables d'environnement");
    return res.status(500).json({ erreur: "Configuration serveur incomplete" });
  }

  try {
    const body = req.body || {};
    const message = String(body.message || "").slice(0, MAX_CHARS_MESSAGE).trim();
    if (!message) {
      return res.status(400).json({ erreur: "Aucune commande recue" });
    }
    const fiche = body.fiche || {};
    const ouvertures = Array.isArray(body.ouvertures) ? body.ouvertures.slice(0, 60) : [];

    const messageUtilisateur = "Fiche actuelle (JSON) : " + JSON.stringify(fiche) +
      "\n\nOuvertures deja ajoutees (JSON) : " + JSON.stringify(ouvertures) +
      "\n\nDictee du metreur : \"" + message + "\"";

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
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: messageUtilisateur }],
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
    for (const appel of appelsOutils) {
      if (appel.name === "reponse_vocale") {
        texteReponse = String(appel.input?.message || "").slice(0, 300);
      } else {
        actions.push(appel);
      }
    }
    if (!texteReponse) {
      const texteBrut = blocs.filter(b => b.type === "text").map(b => b.text || "").join(" ").trim();
      texteReponse = texteBrut || "C'est noté.";
    }

    return res.status(200).json({ actions, reponse: texteReponse });
  } catch (e) {
    console.error("Erreur chat-metreur:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
