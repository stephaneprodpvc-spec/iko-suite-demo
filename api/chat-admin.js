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
const MODELE_GEMINI = "gemini-2.5-flash";
const MAX_CHARS_MESSAGE = 1500;
const MAX_CLIENTS_CONTEXTE = 100;

// Convertit un schema JSON style Anthropic (type en minuscules) vers le
// format attendu par Gemini (type en MAJUSCULES), recursivement sur
// properties/items. Les autres cles (enum, description, required) sont
// compatibles telles quelles.
function versSchemaGemini(schema){
  if (!schema || typeof schema !== "object") return schema;
  const out = { ...schema };
  if (typeof out.type === "string") out.type = out.type.toUpperCase();
  if (out.properties){
    const props = {};
    for (const k in out.properties) props[k] = versSchemaGemini(out.properties[k]);
    out.properties = props;
  }
  if (out.items) out.items = versSchemaGemini(out.items);
  return out;
}
function toolsPourGemini(tools){
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: versSchemaGemini(t.input_schema),
  }));
}

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

ARCHITECTURE TECHNIQUE DU PROJET (connais-la par coeur pour diagnostiquer
et repondre precisement a Stephane quand il te decrit un probleme)

Repo GitHub "iko-suite-demo" (stephaneprodpvc-spec), deploye sur Vercel
(projet "iko-suite-demo", URL principale iko-suite-demo-git-main-akial.vercel.app).
Base Airtable unique : appkI8RKHkYNWY86U.

Fichiers front (racine du repo, HTML+React via Babel standalone sauf
amandine.html qui est en JS vanilla) :
- admin.html = CE poste de pilotage (toi, Claude, y es integre via
  api/chat-admin.js). Gere la table Clients (creation/edition/suppression,
  export CSV, stats, devis, schema des flux).
- dashboard.html = vue agence/admin des tickets SAV, RDV, planning.
- technicien.html = app terrain des techniciens (liste tickets, itineraire).
- amandine.html = chatbot SAV visiteur, appelle api/chat-amandine.js qui
  PEUT AGIR (creer ticket, reserver creneau) via le webhook Make.
- metreur.html = prise de cotes menuiserie (fiches Metres + Ouvertures Metre).
- reunion.html = mode "reunion d'equipe" ou tous les assistants IA
  (toi inclus potentiellement, Amandine/Max/Toise/Iko) discutent avec
  Stephane en mode oral/tutoiement.

Multi-tenant (mecanisme ?client=slug) :
- Table Airtable "Clients" (tblh1s7X6yXJlsTGW) : Nom client, Slug, Metier,
  Logo, Couleur principale/secondaire, Modules actifs, Statut client,
  Emails contact.
- Un champ lie "Compte client" a ete ajoute aux tables Tickets SAV,
  Planning, Metres, RDV Commercial : chaque enregistrement peut etre
  rattache a un client.
- Chaque page front lit ?client=slug (ou le slug memorise en
  localStorage), va chercher le record Clients correspondant via
  window.IKO_CLIENT_READY (Promise globale definie tout en haut du
  script), applique ses couleurs/logo, et filtre toutes ses requetes
  Airtable avec un helper filtreAvecClient()/filtreAvecClientServeur()
  qui ajoute FIND(clientId, ARRAYJOIN({Compte client})) a la formule.
- Cote serveur (api/chat-amandine.js), la resolution du client est faite
  PAR REQUETE (fonction resoudreClient(slug), jamais de variable globale
  partagee) car plusieurs clients peuvent parler a Amandine en meme temps.
  Le ticket cree par Amandine est tague avec Compte client en best-effort
  ~2.5s apres la creation via Make (le ticket est cree de facon asynchrone
  par le scenario Make, pas directement par le code).
- Point de vigilance connu : TRADE_ID et AGENCES_VALIDES restent des
  variables globales partagees (mode concepteur historique, record
  sentinelle Planning "Date=CONFIG", id rec45X231n9dXnyaU) utilisees en
  repli quand aucun client n'est charge. Ne pas les confondre avec le
  contexte par-client.

Securite en place : jamais de token en dur cote navigateur (proxy
api/airtable-proxy.js cote serveur avec AIRTABLE_TOKEN), secret partage
X-App-Secret sur les appels /api/airtable, verification d'origine et
limite de debit sur les endpoints /api/chat-*.

Si Stephane te decrit un souci (page blanche, donnees d'un client visibles
chez un autre, module qui ne repond pas...), utilise cette architecture
pour orienter ton diagnostic avant de repondre : par exemple "verifie que
l'URL contient bien ?client=slug", "ca sent un probleme de cache Vercel,
vercel.json doit avoir Cache-Control no-store sur ce fichier", "verifie
que le champ Compte client est bien rempli sur cet enregistrement".

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

QUATRIEME MODE : modifier_client
4. Si Stephane demande de modifier un client DEJA EXISTANT (change de
   statut, ajuste ses couleurs, active/desactive un module, change son
   nombre d'agences ou le montant du diagnostic) : appelle l'outil
   modifier_client.
- Identifie le client par correspondance EXACTE avec un nom present dans
  la liste "clients" fournie en contexte. Si aucun nom ne correspond
  clairement ou si plusieurs clients ont un nom proche, NE PAS deviner :
  reponds en texte libre pour demander a Stephane de preciser lequel.
- Les champs modifiables sont : metier, modules, couleur_principale,
  couleur_secondaire, statut ("Actif" ou "Pause"), acces_bloque (booleen),
  nombre_agences, montant_diagnostic_ht, telephone, adresse, code_postal,
  ville.
- "Bloquer le client X" ou "X n'a pas paye" => acces_bloque: true.
  "Debloquer le client X" ou "X a paye/regularise" => acces_bloque: false.
  Ne renseigne acces_bloque QUE si Stephane le demande explicitement, ne le
  deduis jamais d'un changement de statut ou d'une autre demande.
- Ne renseigne QUE les champs que Stephane a explicitement demande de
  changer, laisse les autres absents de la reponse.
- Le champ "message" resume clairement ce qui va etre modifie.

CINQUIEME MODE : modifier_agence
5. Si Stephane demande de modifier l'adresse, le code postal ou la ville
   d'une AGENCE (pas du client lui-meme) : appelle l'outil modifier_agence.
- La liste "agences" fournie en contexte ne contient que les agences du
  client actuellement ouvert dans le formulaire. Si elle est vide ou si
  aucun nom d'agence ne correspond clairement, reponds en texte libre pour
  demander a Stephane d'ouvrir le bon client ou de preciser l'agence.
- Identifie l'agence par correspondance EXACTE avec un nom present dans la
  liste "agences". Si plusieurs agences ont un nom proche, demande de
  preciser.
- Champs modifiables : adresse, code_postal, ville, telephone. Ne renseigne
  que ceux demandes.

SIXIEME MODE : creer_agence
6. Si Stephane demande de CREER/AJOUTER une nouvelle agence pour le client
   actuellement ouvert (meme sans nom precis, ex: "cree une autre agence a
   telle adresse") : appelle l'outil creer_agence. Ne confonds pas avec
   modifier_agence, qui ne s'applique qu'a une agence DEJA presente dans la
   liste "agences".
- Si la liste "agences" contient deja 10 agences, ne propose pas la
  creation : reponds en texte libre pour signaler que le plafond de 10
  agences est atteint.
- nom_agence est optionnel : si Stephane n'en donne pas, laisse-le vide
  (un nom par defaut "Agence N" sera genere cote application).
- Renseigne adresse/code_postal/ville/telephone uniquement s'ils sont
  mentionnes.
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
        telephone: { type: "string", description: "Numero de telephone du client, si mentionne." },
        adresse: { type: "string", description: "Adresse (rue, numero) du client, si mentionnee." },
        code_postal: { type: "string", description: "Code postal, si mentionne." },
        ville: { type: "string", description: "Ville, si mentionnee." },
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
  {
    name: "modifier_client",
    description: "Propose la modification de champs precis d'un client DEJA EXISTANT, identifie par son nom exact dans la liste de contexte.",
    input_schema: {
      type: "object",
      properties: {
        nom_client: { type: "string", description: "Nom EXACT du client a modifier, tel qu'il apparait dans la liste de contexte." },
        metier: { type: "string", enum: METIERS_VALIDES, description: "Nouveau metier, uniquement si demande." },
        modules: {
          type: "array",
          items: { type: "string", enum: MODULES_VALIDES },
          description: "Nouvelle liste complete des modules actifs, uniquement si demande.",
        },
        couleur_principale: { type: "string", description: "Code hex, uniquement si demande." },
        couleur_secondaire: { type: "string", description: "Code hex, uniquement si demande." },
        statut: { type: "string", enum: ["Actif", "Pause"], description: "Nouveau statut, uniquement si demande." },
        acces_bloque: { type: "boolean", description: "true pour bloquer l'acces du client aux modules (impaye), false pour debloquer. Uniquement si Stephane demande explicitement de bloquer/debloquer un client." },
        nombre_agences: { type: "number", description: "Nouveau nombre d'agences, uniquement si demande." },
        montant_diagnostic_ht: { type: "number", description: "Nouveau montant du diagnostic HT en euros, uniquement si demande." },
        telephone: { type: "string", description: "Nouveau numero de telephone, uniquement si demande." },
        adresse: { type: "string", description: "Nouvelle adresse (rue, numero), uniquement si demande." },
        code_postal: { type: "string", description: "Nouveau code postal, uniquement si demande." },
        ville: { type: "string", description: "Nouvelle ville, uniquement si demande." },
        message: { type: "string", description: "Une phrase courte resumant la modification proposee." },
      },
      required: ["nom_client", "message"],
    },
  },
  {
    name: "modifier_agence",
    description: "Propose la modification de l'adresse/code postal/ville/telephone d'une agence DEJA EXISTANTE, identifiee par son nom exact dans la liste de contexte 'agences' du client actuellement ouvert.",
    input_schema: {
      type: "object",
      properties: {
        nom_agence: { type: "string", description: "Nom EXACT de l'agence a modifier, tel qu'il apparait dans la liste de contexte 'agences'." },
        adresse: { type: "string", description: "Nouvelle adresse (rue, numero), uniquement si demande." },
        code_postal: { type: "string", description: "Nouveau code postal, uniquement si demande." },
        ville: { type: "string", description: "Nouvelle ville, uniquement si demande." },
        telephone: { type: "string", description: "Nouveau numero de telephone, uniquement si demande." },
        message: { type: "string", description: "Une phrase courte resumant la modification proposee." },
      },
      required: ["nom_agence", "message"],
    },
  },
  {
    name: "creer_agence",
    description: "Propose la creation d'une NOUVELLE agence pour le client actuellement ouvert dans le formulaire (different de modifier_agence, qui cible une agence deja existante).",
    input_schema: {
      type: "object",
      properties: {
        nom_agence: { type: "string", description: "Nom de la nouvelle agence, si precise. Laisse vide sinon." },
        adresse: { type: "string", description: "Adresse (rue, numero), si mentionnee." },
        code_postal: { type: "string", description: "Code postal, si mentionne." },
        ville: { type: "string", description: "Ville, si mentionnee." },
        telephone: { type: "string", description: "Numero de telephone, si mentionne." },
        message: { type: "string", description: "Une phrase courte resumant la creation proposee." },
      },
      required: ["message"],
    },
  },
];

// Les deux fonctions ci-dessous renvoient le meme format normalise :
// { texte: string, appelOutil: { name, input } | null }
// pour que le reste du handler ne depende d'aucun des deux formats d'API.

async function appellerGemini(cle, messagesHistorique, contexte){
  const contents = messagesHistorique.map(h => ({
    role: h.role === "user" ? "user" : "model",
    parts: [{ text: String(h.texte || "").slice(0, 800) }],
  }));
  contents.push({ role: "user", parts: [{ text: contexte }] });

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODELE_GEMINI + ":generateContent?key=" + cle;
  const reponse = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: contents,
      tools: [{ functionDeclarations: toolsPourGemini(TOOLS) }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { temperature: 0.5, maxOutputTokens: 700 },
    }),
  });
  if (!reponse.ok){
    const detail = await reponse.text();
    throw new Error("Gemini HTTP " + reponse.status + " : " + detail.slice(0, 300));
  }
  const data = await reponse.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const partOutil = parts.find(p => p.functionCall);
  if (partOutil){
    return { texte: "", appelOutil: { name: partOutil.functionCall.name, input: partOutil.functionCall.args || {} } };
  }
  const texte = parts.filter(p => typeof p.text === "string").map(p => p.text).join(" ").trim();
  if (!texte) throw new Error("Gemini : reponse vide ou format inattendu");
  return { texte: texte, appelOutil: null };
}

async function appellerClaude(cle, messagesHistorique, contexte){
  const messagesAnthropic = messagesHistorique.map(h => ({
    role: h.role === "user" ? "user" : "assistant",
    content: String(h.texte || "").slice(0, 800),
  }));
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
  if (!reponse.ok){
    const detail = await reponse.text();
    throw new Error("Claude HTTP " + reponse.status + " : " + detail.slice(0, 300));
  }
  const data = await reponse.json();
  const blocs = Array.isArray(data.content) ? data.content : [];
  const blocOutil = blocs.find(b => b.type === "tool_use");
  if (blocOutil){
    return { texte: "", appelOutil: { name: blocOutil.name, input: blocOutil.input } };
  }
  const texte = blocs.filter(b => b.type === "text").map(b => b.text || "").join(" ").trim();
  return { texte: texte || "…", appelOutil: null };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erreur: "Methode non autorisee" });
  }

  if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
  if (!verifierDebit(req)) return reponseBloquee(res, "debit");

  const cleGemini = process.env.GEMINI_API_KEY;
  const cleClaude = process.env.ANTHROPIC_API_KEY;
  if (!cleGemini && !cleClaude) {
    console.error("Ni GEMINI_API_KEY ni ANTHROPIC_API_KEY ne sont configurees");
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
    const agences = Array.isArray(body.agences) ? body.agences.slice(0, 10) : [];

    const contexte = "Clients actuels dans la base (JSON) :\n" + JSON.stringify(clients) +
      "\n\nAgences du client actuellement ouvert dans le formulaire (JSON, vide si aucun client ouvert) :\n" + JSON.stringify(agences) +
      "\n\nMessage de Stephane : \"" + message + "\"";

    // Gemini en priorite (gratuit) si une cle est configuree, avec repli
    // automatique et silencieux sur Claude en cas d'echec (reseau, format
    // de reponse inattendu, quota depasse...). Stephane ne voit jamais
    // l'echec cote client : au pire une reponse legerement plus lente.
    let resultat = null;
    let sourceUtilisee = null;
    if (cleGemini) {
      try {
        resultat = await appellerGemini(cleGemini, historique, contexte);
        sourceUtilisee = "gemini";
      } catch (e) {
        console.warn("chat-admin: Gemini indisponible, repli sur Claude —", e.message);
      }
    }
    if (!resultat) {
      if (!cleClaude) {
        return res.status(502).json({ erreur: "L'assistant est momentanément indisponible." });
      }
      resultat = await appellerClaude(cleClaude, historique, contexte);
      sourceUtilisee = "claude";
    }
    console.log("chat-admin: reponse via", sourceUtilisee);

    if (resultat.appelOutil) {
      const { name, input } = resultat.appelOutil;
      if (input && typeof input.message === "string") input.message = retirerEmojis(input.message);

      if (name === "proposer_client") return res.status(200).json({ type: "proposition", proposition: input });
      if (name === "generer_devis") return res.status(200).json({ type: "devis", devis: input });
      if (name === "modifier_client") return res.status(200).json({ type: "modification", modification: input });
      if (name === "modifier_agence") return res.status(200).json({ type: "modification_agence", modification_agence: input });
      if (name === "creer_agence") return res.status(200).json({ type: "creation_agence", creation_agence: input });
      // Outil inconnu (ne devrait pas arriver) : on retombe en texte libre.
      console.warn("chat-admin: outil inconnu retourne par", sourceUtilisee, ":", name);
    }

    return res.status(200).json({ type: "message", reponse: retirerEmojis(resultat.texte) || "…" });
  } catch (e) {
    console.error("Erreur chat-admin:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
