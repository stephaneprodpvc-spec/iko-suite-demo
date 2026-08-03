import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";

// api/chat-technicien.js
// Relais serveur entre le widget vocal Max (technicien.html) et l'API
// Claude (Anthropic). Meme principe que chat-dashboard.js : les tickets
// sont deja charges cote client, Max decide seulement quelle action
// effectuer, et le navigateur execute reellement l'action avec les
// fonctions deja existantes de la page technicien.

const MODELE = "claude-haiku-4-5-20251001";
const MAX_CHARS_MESSAGE = 500;
const MAX_TICKETS_CONTEXTE = 100;

const ONGLETS_VALIDES = ["aujourd_hui", "urgent", "devis", "termines", "annules"];

const SYSTEM_PROMPT = `
Tu es Max, l'assistant vocal du technicien sur le terrain, dans
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
    const message = String(body.message || "").slice(0, MAX_CHARS_MESSAGE).trim();
    if (!message) {
      return res.status(400).json({ erreur: "Aucune commande recue" });
    }
    const ticketsContexte = Array.isArray(body.tickets) ? body.tickets.slice(0, MAX_TICKETS_CONTEXTE) : [];
    const ongletActuel = String(body.ongletActuel || "aujourd_hui").slice(0, 40);
    const historique = Array.isArray(body.historique) ? body.historique.slice(-6) : [];
    const historiqueClient = Array.isArray(body.historiqueClient) ? body.historiqueClient.slice(0, 3) : null;

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
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        tool_choice: { type: "any" },
        messages: [{ role: "user", content: messageUtilisateur }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic:", reponse.status, detail);
      return res.status(502).json({ erreur: "Max est momentanément indisponible." });
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
