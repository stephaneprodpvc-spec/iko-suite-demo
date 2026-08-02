import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";

// api/chat-dashboard.js
// Relais serveur entre le widget vocal Amandine (dashboard.html) et l'API
// Claude (Anthropic). La cle ANTHROPIC_API_KEY reste ici (cote serveur).
//
// Contrairement a chat-amandine.js (qui agit reellement sur Airtable cote
// serveur pour les visiteurs du site), ici les donnees (tickets) sont deja
// chargees cote client dans le dashboard : Amandine se contente de decider
// QUELLE action effectuer (filtrer, chercher, changer un statut...), et
// c'est le navigateur qui execute reellement l'action avec les fonctions
// deja existantes du dashboard (memes fonctions que les boutons manuels).

const MODELE = "claude-haiku-4-5-20251001";
const MAX_CHARS_MESSAGE = 500;
const MAX_TICKETS_CONTEXTE = 150;

const AGENCES_VALIDES = ["Agence 1", "Agence 2", "Agence 3", "Agence 4"];
const STATUTS_VALIDES = ["Nouveau", "En cours", "Terminé", "Annulé"];

const SYSTEM_PROMPT = `
Tu es IKO, l'assistant vocal integre au dashboard SAV d'Iko Suite.
La personne qui te parle est un responsable ou une personne d'agence en
train de travailler sur le dashboard. Elle te donne des commandes ou
questions a l'oral, et tu dois soit AGIR sur le dashboard (filtrer,
chercher, changer un statut), soit REPONDRE a une question sur les
tickets actuellement visibles.

Tu recois la liste des tickets actuellement charges dans le dashboard
(identifiant Airtable, numero, client, agence, statut, produit). Utilise
UNIQUEMENT cette liste pour repondre ou identifier un ticket : ne
suppose jamais l'existence d'un ticket qui n'y figure pas.

REGLES
- Pour changer le statut d'un ticket, identifie-le dans la liste fournie
  (par numero de ticket ou nom de client cite) et utilise son identifiant
  exact (champ id) dans ticket_id, jamais le numero affiche.
- Si plusieurs tickets correspondent ou qu'aucun n'est trouve avec
  certitude, n'appelle pas changer_statut : utilise reponse_vocale pour
  demander une precision.
- Pour une question factuelle (compter, lister, verifier), calcule la
  reponse toi-meme a partir de la liste fournie et utilise
  reponse_vocale.
- Reponses vocales courtes (1 a 2 phrases), sans markdown, sans emoji,
  vouvoiement, ton professionnel et direct.
- N'appelle jamais plus d'un outil d'action a la fois (une seule
  intention par commande).
`;

const TOOLS = [
  {
    name: "filtrer_agence",
    description: "Filtre la liste des tickets sur une agence, ou revient a toutes les agences.",
    input_schema: {
      type: "object",
      properties: {
        agence: { type: "string", enum: [...AGENCES_VALIDES, "toutes"] },
      },
      required: ["agence"],
    },
  },
  {
    name: "rechercher",
    description: "Lance une recherche texte (nom client, numero de ticket, produit) dans la liste des tickets.",
    input_schema: {
      type: "object",
      properties: {
        requete: { type: "string", description: "Texte a rechercher." },
      },
      required: ["requete"],
    },
  },
  {
    name: "filtrer_statut",
    description: "Filtre la liste des tickets sur un statut precis, ou revient a tous les statuts.",
    input_schema: {
      type: "object",
      properties: {
        statut: { type: "string", enum: ["tous", ...STATUTS_VALIDES] },
      },
      required: ["statut"],
    },
  },
  {
    name: "changer_statut",
    description: "Change le statut d'un ticket precis identifie dans la liste fournie.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Identifiant exact (champ id) du ticket dans la liste fournie, pas son numero affiche." },
        nouveau_statut: { type: "string", enum: STATUTS_VALIDES },
      },
      required: ["ticket_id", "nouveau_statut"],
    },
  },
  {
    name: "reponse_vocale",
    description: "Repond simplement a voix haute, sans modifier le dashboard (question factuelle, demande de precision, ou confirmation).",
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
    const agenceActuelle = String(body.agenceActuelle || "global").slice(0, 40);

    const messageUtilisateur = "Agence actuellement affichee : " + agenceActuelle +
      "\n\nTickets actuellement charges dans le dashboard (JSON) :\n" +
      JSON.stringify(ticketsContexte) +
      "\n\nCommande vocale de l'utilisateur : \"" + message + "\"";

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 500,
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
      return res.status(502).json({ erreur: "IKO est momentanément indisponible." });
    }

    const data = await reponse.json();
    const blocs = Array.isArray(data.content) ? data.content : [];
    const appelsOutils = blocs.filter(b => b.type === "tool_use");

    let texteReponse = "";
    const actions = [];
    for (const appel of appelsOutils) {
      if (appel.name === "reponse_vocale") {
        texteReponse = String(appel.input?.message || "").slice(0, 400);
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
    console.error("Erreur chat-dashboard:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
