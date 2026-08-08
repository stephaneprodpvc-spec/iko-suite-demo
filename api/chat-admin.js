import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";

// api/chat-admin.js
// Claude, integre au poste de pilotage (admin.html) comme partenaire de
// travail de Stephane : discussion libre sur la strategie/le produit, ET
// proposition de champs structures quand un nouveau client est decrit.
//
// IMPORTANT : cet endpoint ne touche JAMAIS Airtable lui-meme. La creation
// reelle d'un client reste toujours un clic explicite de Stephane cote
// client (voir admin.html).

const MODELE = "claude-sonnet-4-6";
const MAX_CHARS_MESSAGE = 1500;
const MAX_CLIENTS_CONTEXTE = 100;

// Supprime emojis/pictogrammes d'un texte (filet de securite en plus de la
// consigne donnee a Claude dans le system prompt).
function retirerEmojis(texte){
  return String(texte || "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\uFE0F]/gu, "").replace(/ {2,}/g, " ").trim();
}

const METIERS_VALIDES = ["Menuiserie", "Plomberie & Chauffage", "Électricité", "Autre"];
const MODULES_VALIDES = ["Dashboard", "Technicien", "SAV", "Métreur"];

const SYSTEM_PROMPT = `
Tu es Claude, integre au poste de pilotage d'Iko Suite (RSIA Conseil,
Stephane). Tu es un partenaire de travail direct et competent : Stephane
peut te parler de strategie produit, discuter d'une idee, te demander un
avis, analyser sa base de clients actuelle, ou te decrire un nouveau
client a creer sur la plateforme.

CONTEXTE PRODUIT
Iko Suite est vendue a des professionnels (artisans/PME) pour gerer leur
SAV, technicien terrain et tableau de bord. Chaque client final a sa propre
fiche (metier, couleurs, logo, modules actifs, contacts) dans une base
multi-tenant. Le code des modules (dashboard, technicien, SAV) est
partage entre tous les clients. La liste actuelle des clients (JSON) t'est
fournie dans chaque message : utilise-la pour repondre precisement a toute
question sur l'etat de la base (nombre, statuts, modules, metiers), au
lieu de deviner.

STYLE
- Jamais d'emoji ni de pictogramme (😉, 👍, etc.), meme pour "faire
  sympa" : cette reponse est parfois lue a voix haute, les pictos n'ont
  aucun sens a l'oral et alourdissent le texte a l'ecrit.
- Direct, concret, professionnel. Pas de blabla commercial ni de
  formules creuses.

TROIS MODES DE REPONSE
1. Si Stephane decrit un nouveau client a creer (nom, metier, besoins) :
   appelle l'outil proposer_client avec les champs deduits.
2. Si Stephane demande un devis (RSIA vers un prospect/client) : appelle
   l'outil generer_devis. Structure toujours le devis en lignes claires
   (ex: "Abonnement Iko Suite - forfait mensuel", "Mise en place et
   parametrage", "Formation utilisateurs"). Ne facture QUE ce que Stephane
   a mentionne. Si un prix n'est pas donne, mets 0 et dis-le dans
   "message" pour qu'il le complete a la main - ne jamais inventer un
   prix.
3. Sinon (question, discussion, avis, strategie) : reponds en texte libre,
   naturellement, comme un collegue competent. Sois direct, concret, pas
   de blabla commercial.

REGLES POUR proposer_client
- Deduis le metier le plus proche parmi la liste fournie. Si aucun ne
  correspond clairement, choisis "Autre".
- Dashboard et SAV sont quasi toujours utiles des la creation. Technicien
  si le client a des interventions terrain. Metreur UNIQUEMENT si le
  metier est Menuiserie et que la prise de cotes est mentionnee.
- Slug : minuscules, sans accent, mots separes par des tirets.
- Couleurs uniquement si mentionnees, sinon garde les couleurs Iko par
  defaut (#FF6B00 / #111111).
- Le champ "message" est une phrase courte confirmant ce que tu proposes.
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
  {
    name: "generer_devis",
    description: "Genere un devis structure de RSIA Conseil vers un prospect/client, a partir de la description de Stephane.",
    input_schema: {
      type: "object",
      properties: {
        client_nom: { type: "string", description: "Nom du destinataire du devis." },
        client_adresse: { type: "string", description: "Adresse du destinataire, si connue. Vide sinon." },
        objet: { type: "string", description: "Objet du devis, ex: Abonnement Iko Suite - Menuiserie Dupont." },
        lignes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantite: { type: "number" },
              prix_unitaire: { type: "number", description: "En euros HT. Mettre 0 si Stephane n'a donne aucun prix : ne jamais inventer un prix." },
            },
            required: ["description", "quantite", "prix_unitaire"],
          },
        },
        conditions: { type: "string", description: "Conditions (validite, paiement...). Valeur par defaut raisonnable si non precise." },
        message: { type: "string", description: "Une phrase courte confirmant le devis genere, signalant si des prix sont a completer." },
      },
      required: ["client_nom", "objet", "lignes", "conditions", "message"],
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
      return res.status(400).json({ erreur: "Aucun message recu" });
    }
    const historique = Array.isArray(body.historique) ? body.historique.slice(-10) : [];
    const clients = Array.isArray(body.clients) ? body.clients.slice(0, MAX_CLIENTS_CONTEXTE) : [];

    const messagesAnthropic = historique.map(h => ({
      role: h.role === "user" ? "user" : "assistant",
      content: String(h.texte || "").slice(0, 800),
    }));
    const contexte = "Clients actuels dans la base (JSON) :\n" + JSON.stringify(clients) + "\n\nMessage de Stephane : \"" + message + "\"";
    messagesAnthropic.push({ role: "user", content: contexte });

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 700,
        temperature: 0.5,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        tool_choice: { type: "auto" },
        messages: messagesAnthropic,
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic:", reponse.status, detail);
      return res.status(502).json({ erreur: "Claude est momentanément indisponible." });
    }

    const data = await reponse.json();
    const blocs = Array.isArray(data.content) ? data.content : [];
    const appelClient = blocs.find(b => b.type === "tool_use" && b.name === "proposer_client");
    const appelDevis = blocs.find(b => b.type === "tool_use" && b.name === "generer_devis");

    if (appelClient) {
      appelClient.input.message = retirerEmojis(appelClient.input.message);
      return res.status(200).json({ type: "proposition", proposition: appelClient.input });
    }

    if (appelDevis) {
      appelDevis.input.message = retirerEmojis(appelDevis.input.message);
      return res.status(200).json({ type: "devis", devis: appelDevis.input });
    }

    const texteBrut = blocs.filter(b => b.type === "text").map(b => b.text || "").join(" ").trim();
    return res.status(200).json({ type: "message", reponse: retirerEmojis(texteBrut) || "…" });
  } catch (e) {
    console.error("Erreur chat-admin:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
