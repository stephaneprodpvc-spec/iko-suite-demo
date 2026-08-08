import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";

// api/chat-admin.js
// Assistant IA du poste de pilotage (admin.html). Aide Stephane a decrire
// un nouveau client en langage naturel et propose les champs structures
// (nom, slug, metier, modules, couleurs) a pre-remplir dans le formulaire.
//
// IMPORTANT : cet endpoint ne touche JAMAIS Airtable lui-meme. Il renvoie
// une simple proposition de champs ; c'est toujours Stephane qui relit et
// clique sur "Creer le client" cote client pour ecrire reellement dans la
// base (voir admin.html).

const MODELE = "claude-haiku-4-5-20251001";
const MAX_CHARS_MESSAGE = 800;

const METIERS_VALIDES = ["Menuiserie", "Plomberie & Chauffage", "Électricité", "Autre"];
const MODULES_VALIDES = ["Dashboard", "Technicien", "SAV", "Métreur"];

const SYSTEM_PROMPT = `
Tu es l'assistant du poste de pilotage Iko, utilise par Stephane (RSIA
Conseil) pour creer rapidement un nouveau client sur la plateforme Iko
Suite. Stephane te decrit un client en langage naturel (nom, metier,
besoins), et tu proposes les champs structures du formulaire de creation.

REGLES
- Deduis le metier le plus proche parmi la liste fournie. Si aucun ne
  correspond clairement, choisis "Autre".
- Propose les modules actifs les plus pertinents. Dashboard et SAV sont
  quasi toujours utiles des la creation. Technicien si le client a des
  interventions terrain. Metreur UNIQUEMENT si le metier est Menuiserie
  et que la prise de cotes est mentionnee ou evidente (sinon ne le
  coche pas par defaut, meme pour la menuiserie).
- Genere un slug technique a partir du nom : minuscules, sans accent,
  mots separes par des tirets.
- Propose des couleurs uniquement si Stephane en mentionne (ex: "en
  bleu", "couleurs vertes") ; sinon garde les couleurs Iko par defaut
  (#FF6B00 / #111111).
- Reponds TOUJOURS en appelant l'outil proposer_client, jamais en texte
  libre.
- Le champ "message" est une phrase courte (1 phrase, francais informel)
  confirmant ce que tu proposes, a afficher a Stephane.
- Si la description est trop vague pour deduire quoi que ce soit
  (ex: juste "un nouveau client"), propose des valeurs par defaut
  raisonnables plutot que de bloquer : Stephane ajustera dans le
  formulaire.
`;

const TOOLS = [
  {
    name: "proposer_client",
    description: "Propose les champs structures d'un nouveau client a partir de la description en langage naturel.",
    input_schema: {
      type: "object",
      properties: {
        nom: { type: "string", description: "Nom du client, tel que formule par Stephane." },
        slug: { type: "string", description: "Identifiant technique : minuscules, sans accent, tirets." },
        metier: { type: "string", enum: METIERS_VALIDES },
        modules: {
          type: "array",
          items: { type: "string", enum: MODULES_VALIDES },
        },
        couleur_principale: { type: "string", description: "Code hex, ex: #FF6B00" },
        couleur_secondaire: { type: "string", description: "Code hex, ex: #111111" },
        message: { type: "string", description: "Une phrase courte confirmant la proposition." },
      },
      required: ["nom", "slug", "metier", "modules", "couleur_principale", "couleur_secondaire", "message"],
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
    if (!message) {
      return res.status(400).json({ erreur: "Aucune description recue" });
    }
    const historique = Array.isArray(body.historique) ? body.historique.slice(-6) : [];

    const blocHistorique = historique.length
      ? "\n\nEchanges precedents de cette session (le plus recent en dernier) :\n" +
        historique.map(h => (h.role === "user" ? "Stephane: " : "Toi: ") + String(h.texte || "").slice(0, 300)).join("\n")
      : "";

    const messageUtilisateur = "Description du nouveau client par Stephane :\n\"" + message + "\"" + blocHistorique;

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
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        tool_choice: { type: "tool", name: "proposer_client" },
        messages: [{ role: "user", content: messageUtilisateur }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic:", reponse.status, detail);
      return res.status(502).json({ erreur: "Assistant momentanément indisponible." });
    }

    const data = await reponse.json();
    const blocs = Array.isArray(data.content) ? data.content : [];
    const appel = blocs.find(b => b.type === "tool_use" && b.name === "proposer_client");

    if (!appel) {
      return res.status(502).json({ erreur: "Réponse inattendue de l'assistant." });
    }

    return res.status(200).json({ proposition: appel.input });
  } catch (e) {
    console.error("Erreur chat-admin:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
