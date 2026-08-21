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
// Bloc synthese direction : texte redige a partir de chiffres deja
// calcules cote client, exige Sonnet 5 (meme principe que le diagnostic
// technicien : Haiku reste reserve a la navigation et aux taches simples).
const MODELE_SONNET = "claude-sonnet-5";
const MAX_CHARS_MESSAGE = 500;
const MAX_TICKETS_CONTEXTE = 150;
const MAX_CATALOGUE_CONTEXTE = 60;

const AGENCES_VALIDES = ["Agence 1", "Agence 2", "Agence 3", "Agence 4"];
const STATUTS_VALIDES = ["Nouveau", "En cours", "Terminé", "Annulé", "Devis à faire", "Devis envoyé", "Devis - Suivi", "Devis - Attente fournisseur", "Devis refusé"];
// Sous-ensemble utilisable par changer_statut : Annulé en est exclu volontairement,
// cette transition exige un motif et passe par preparer_annulation_ticket.
const STATUTS_MODIFIABLES = STATUTS_VALIDES.filter(s => s !== "Annulé");
const MOTIFS_BLOCAGE_VALIDES = ["Congé", "Congé payé", "Maladie", "Autre"];

// ==================== Bloc devis assisté (mode "devis_suggestion") ====================
// Meme principe que le Bloc 2C deja livre cote technicien/Max
// (api/chat-technicien.js, fonction traiterDevisSuggestion) : l'IA ne
// propose QUE des catalogue_id pioches dans le catalogue reel transmis,
// jamais de prix ni de designation. Le serveur revalide integralement
// chaque ligne avant de la renvoyer au dashboard.
const SYSTEM_PROMPT_DEVIS = `
Tu es IKO, assistant du responsable pour preparer un devis depuis le
dashboard SAV de l'application Iko Suite. Tu recois le probleme du
ticket et le catalogue REEL du client (produits et main d'oeuvre, avec
leurs identifiants exacts).

REGLES ABSOLUES
- Tu ne peux proposer QUE des lignes dont le catalogue_id existe
  EXACTEMENT dans le catalogue fourni. N'invente jamais un identifiant.
- Ne propose jamais de prix, reference ou designation : le serveur les
  recalcule depuis le catalogue reel, tu n'as qu'a choisir le bon
  catalogue_id et une quantite raisonnable.
- Justifie chaque ligne brievement en lien avec le probleme decrit.
- Si aucune ligne du catalogue ne correspond, renvoie un tableau vide.
`;

const OUTIL_DEVIS = {
  name: "suggerer_lignes_devis",
  description: "Suggere des lignes de devis en piochant EXCLUSIVEMENT dans le catalogue reel fourni.",
  input_schema: {
    type: "object",
    properties: {
      lignes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            catalogue_id: { type: "string", description: "Identifiant exact d'un element du catalogue fourni (jamais invente)." },
            quantite: { type: "number" },
            justification: { type: "string", description: "Courte justification en lien avec le probleme du ticket." },
          },
          required: ["catalogue_id", "quantite", "justification"],
        },
      },
      resume_vocal: { type: "string" },
    },
    required: ["lignes", "resume_vocal"],
  },
};

const SYSTEM_PROMPT_SYNTHESE = `
Tu es IKO, assistant de synthese pour la direction d'Iko Suite. Tu recois
UNIQUEMENT des chiffres deja calcules et verifies par le serveur (jamais
les tickets bruts). Tu dois rediger une courte synthese factuelle et 2 a 4
recommandations concretes pour la direction.

REGLES ABSOLUES
- N'utilise et ne cite QUE les chiffres, noms de produits, noms d'agences
  et statuts presents dans les donnees fournies. N'invente jamais un
  chiffre, une cause, une agence ou un produit absent des donnees.
- Ne formule aucune hypothese sur une cause de panne ou de malfacon : ce
  champ n'existe pas dans les donnees, ne le mentionne pas comme une
  certitude. Tu peux uniquement noter qu'un produit revient souvent en
  SAV, sans jamais dire pourquoi si ce n'est pas donne.
- L'estimation du mois suivant, si fournie, est une simple moyenne
  statistique : presente-la comme une tendance indicative, jamais comme
  une prediction certaine.
- Reste concis : synthese en 3 a 5 phrases maximum, recommandations
  courtes et actionnables (une ligne chacune).
- Ton professionnel, direct, vouvoiement.
`;

const OUTIL_SYNTHESE = {
  name: "synthese_direction",
  description: "Produit une synthese factuelle et des recommandations pour la direction, strictement basees sur les chiffres fournis.",
  input_schema: {
    type: "object",
    properties: {
      synthese: { type: "string", description: "Synthese factuelle courte (3 a 5 phrases), basee uniquement sur les chiffres fournis." },
      recommandations: {
        type: "array",
        items: { type: "string" },
        description: "2 a 4 recommandations concretes et courtes.",
      },
    },
    required: ["synthese", "recommandations"],
  },
};

const SYSTEM_PROMPT = `
Tu es IKO, l'assistant vocal integre au dashboard SAV d'Iko Suite.
La personne qui te parle est un responsable ou une personne d'agence en
train de travailler sur le dashboard. Elle te donne des commandes ou
questions a l'oral, et tu dois soit AGIR sur le dashboard (filtrer,
chercher, changer un statut, ouvrir ou renvoyer un ticket, marquer un
message lu, repondre a un client, preparer un blocage de dates, ouvrir
un nouveau RDV, preparer une annulation ou une suppression de ticket),
soit REPONDRE a une question sur les tickets actuellement visibles.

Tu recois la liste des tickets actuellement charges dans le dashboard
(identifiant Airtable, numero, client, agence, statut, produit). Utilise
UNIQUEMENT cette liste pour repondre ou identifier un ticket : ne
suppose jamais l'existence d'un ticket qui n'y figure pas.

REGLES
- Pour changer le statut, ouvrir, renvoyer, marquer lu, ou repondre a un
  ticket, identifie-le dans la liste fournie (par numero de ticket ou
  nom de client cite) et utilise son identifiant exact (champ id) dans
  ticket_id, jamais le numero affiche.
- Les actions preparer_blocage_dates, ouvrir_nouveau_rdv,
  preparer_annulation_ticket et preparer_suppression_ticket ouvrent
  seulement un formulaire pre-rempli : elles n'ecrivent rien tant que
  l'utilisateur n'a pas confirme manuellement. C'est normal, ne dis
  jamais que l'action est terminee pour celles-ci : dis plutot que le
  formulaire est ouvert et pret, en resumant ce qui est pre-rempli.
- Si plusieurs tickets correspondent ou qu'aucun n'est trouve avec
  certitude, n'appelle pas d'action sur un ticket precis : utilise
  reponse_vocale pour demander une precision.
- Pour renvoyer_ticket, demande toujours si c'est le technicien ou le
  client si ce n'est pas explicite dans la commande ; ne devine pas.
  Si le renvoi au client echoue faute de contact valide, le dashboard
  le signale lui-meme, tu n'as pas a le verifier en amont.
- Pour une question factuelle (compter, lister, verifier), calcule la
  reponse toi-meme a partir de la liste fournie et utilise
  reponse_vocale.
- Reponses vocales courtes (1 a 2 phrases), sans markdown, sans emoji,
  vouvoiement, ton professionnel et direct.
- Tu recois parfois les echanges precedents de la session : utilise-les
  pour comprendre une reference comme "celui d'avant" ou "le meme".
- N'appelle jamais plus d'un outil d'action a la fois (une seule
  intention par commande).
- REGLE ABSOLUE : si la commande demande une action sur le dashboard
  (filtrer, chercher, changer un statut, ouvrir ou renvoyer un ticket,
  marquer lu, repondre, preparer un blocage/RDV/annulation/suppression),
  tu DOIS appeler l'outil d'action correspondant. Il est INTERDIT de
  repondre "c'est fait" ou toute confirmation similaire via
  reponse_vocale sans avoir reellement appele cet outil dans le meme
  message. reponse_vocale seul n'est valide que pour une question ou
  une demande de precision, jamais pour confirmer une action non
  executee.
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
        nouveau_statut: { type: "string", enum: STATUTS_MODIFIABLES },
      },
      required: ["ticket_id", "nouveau_statut"],
    },
  },
  {
    name: "ouvrir_ticket",
    description: "Ouvre un ticket precis dans le dashboard : bascule sur l'onglet Tickets, l'isole et le met en evidence a l'ecran.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Identifiant exact (champ id) du ticket dans la liste fournie, pas son numero affiche." },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "renvoyer_ticket",
    description: "Renvoie le ticket par email, soit au technicien soit au client concerne.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Identifiant exact (champ id) du ticket dans la liste fournie, pas son numero affiche." },
        destinataire: { type: "string", enum: ["client", "technicien"] },
      },
      required: ["ticket_id", "destinataire"],
    },
  },
  {
    name: "marquer_message_lu",
    description: "Marque comme lu le message client d'un ticket precis.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Identifiant exact (champ id) du ticket dans la liste fournie." },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "repondre_client",
    description: "Envoie une reponse texte au client sur un ticket precis, visible dans son fil de suivi.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Identifiant exact (champ id) du ticket dans la liste fournie." },
        message: { type: "string", description: "Contenu exact du message a envoyer au client." },
      },
      required: ["ticket_id", "message"],
    },
  },
  {
    name: "preparer_blocage_dates",
    description: "Ouvre le formulaire de blocage de dates pre-rempli avec l'agence, la periode et le motif precises. N'ecrit rien : cette action peut modifier de nombreux creneaux et exige une confirmation manuelle dans le formulaire.",
    input_schema: {
      type: "object",
      properties: {
        agence: { type: "string", enum: AGENCES_VALIDES },
        date_debut: { type: "string", description: "Format AAAA-MM-JJ." },
        date_fin: { type: "string", description: "Format AAAA-MM-JJ." },
        motif: { type: "string", enum: MOTIFS_BLOCAGE_VALIDES },
      },
      required: [],
    },
  },
  {
    name: "ouvrir_nouveau_rdv",
    description: "Ouvre le formulaire de prise de nouveau rendez-vous SAV, avec l'agence pre-remplie si precisee. N'ecrit rien : le reste du formulaire (client, produit, date...) est trop consequent pour etre rempli fiablement a la voix.",
    input_schema: {
      type: "object",
      properties: {
        agence: { type: "string", enum: AGENCES_VALIDES },
      },
      required: [],
    },
  },
  {
    name: "preparer_annulation_ticket",
    description: "Ouvre la confirmation d'annulation d'un ticket precis, avec le motif pre-rempli si donne. N'annule rien : action irreversible, la validation finale reste manuelle.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Identifiant exact (champ id) du ticket dans la liste fournie." },
        motif: { type: "string", description: "Motif d'annulation si precise par l'utilisateur." },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "preparer_suppression_ticket",
    description: "Ouvre la confirmation de suppression (archivage) d'un ticket precis. Ne supprime rien : action irreversible, la validation finale reste manuelle.",
    input_schema: {
      type: "object",
      properties: {
        ticket_id: { type: "string", description: "Identifiant exact (champ id) du ticket dans la liste fournie." },
      },
      required: ["ticket_id"],
    },
  },
  {
    name: "afficher_analytics_sav",
    description: "Ouvre le panneau Analytics SAV du dashboard (produits generant le plus de tickets, repartition par agence). N'ecrit rien, ouverture d'un panneau de lecture seule.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
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

// ==================== Bloc devis assiste : validation serveur ====================
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
      "\n\nDemande du responsable : \"" + String(body.message || "Propose des lignes de devis adaptees.").slice(0, MAX_CHARS_MESSAGE) + "\"";

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
      console.error("Erreur API Anthropic (devis dashboard):", reponse.status, detail);
      return res.status(502).json({ erreur: "IKO est momentanément indisponible." });
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
    console.error("Erreur traiterDevisSuggestion (dashboard):", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}

// ==================== Bloc synthese direction : validation serveur ====================
async function traiterSyntheseDirection(req, res, body, cle) {
  try {
    const stats = body.stats && typeof body.stats === "object" ? body.stats : {};
    // Le serveur ne transmet a l'IA que les chiffres deja calcules cote
    // client (aucun ticket brut) : impossible pour elle d'inventer une
    // donnee absente de ce resume.
    const donnees = {
      total_tickets: Number(stats.total_tickets) || 0,
      top_produits: Array.isArray(stats.top_produits) ? stats.top_produits.slice(0, 8) : [],
      repartition_agences: Array.isArray(stats.repartition_agences) ? stats.repartition_agences.slice(0, 10) : [],
      repartition_statuts: Array.isArray(stats.repartition_statuts) ? stats.repartition_statuts.slice(0, 10) : [],
      taux_urgents_pct: Number(stats.taux_urgents_pct) || 0,
      tendance_mensuelle: Array.isArray(stats.tendance_mensuelle) ? stats.tendance_mensuelle.slice(0, 12) : [],
      estimation_mois_suivant: stats.estimation_mois_suivant != null ? Number(stats.estimation_mois_suivant) : null,
    };

    if (!donnees.total_tickets) {
      return res.status(200).json({ synthese: "Aucun ticket chargé pour établir une synthèse.", recommandations: [] });
    }

    const texteContexte = "Chiffres reels calcules par le serveur (JSON, source unique de verite) :\n" + JSON.stringify(donnees);

    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODELE_SONNET,
        max_tokens: 600,
        temperature: 0.2,
        system: [{ type: "text", text: SYSTEM_PROMPT_SYNTHESE, cache_control: { type: "ephemeral" } }],
        tools: [OUTIL_SYNTHESE],
        tool_choice: { type: "tool", name: "synthese_direction" },
        messages: [{ role: "user", content: texteContexte }],
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic (synthese direction):", reponse.status, detail);
      return res.status(502).json({ erreur: "IKO est momentanément indisponible." });
    }

    const data = await reponse.json();
    const appel = (Array.isArray(data.content) ? data.content : []).find(b => b.type === "tool_use" && b.name === "synthese_direction");
    if (!appel) return res.status(502).json({ erreur: "Réponse de synthèse invalide." });

    const recommandations = Array.isArray(appel.input?.recommandations) ? appel.input.recommandations.slice(0, 4).map(r => String(r).slice(0, 300)) : [];
    return res.status(200).json({
      synthese: String(appel.input?.synthese || "").slice(0, 1000),
      recommandations,
    });
  } catch (e) {
    console.error("Erreur traiterSyntheseDirection:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}

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

    // Mode dédié, distinct de la navigation vocale par défaut. Origine et
    // débit déjà vérifiés ci-dessus pour tous les modes.
    if (body.mode === "devis_suggestion") return await traiterDevisSuggestion(req, res, body, cle);
    if (body.mode === "synthese_direction") return await traiterSyntheseDirection(req, res, body, cle);

    const message = String(body.message || "").slice(0, MAX_CHARS_MESSAGE).trim();
    if (!message) {
      return res.status(400).json({ erreur: "Aucune commande recue" });
    }
    const ticketsContexte = Array.isArray(body.tickets) ? body.tickets.slice(0, MAX_TICKETS_CONTEXTE) : [];
    const agenceActuelle = String(body.agenceActuelle || "global").slice(0, 40);
    const historique = Array.isArray(body.historique) ? body.historique.slice(-6) : [];

    const blocHistorique = historique.length
      ? "\n\nEchanges precedents de cette session (le plus recent en dernier) :\n" +
        historique.map(h => (h.role === "user" ? "Utilisateur: " : "Toi: ") + String(h.texte || "").slice(0, 300)).join("\n")
      : "";

    const messageUtilisateur = "Agence actuellement affichee : " + agenceActuelle +
      "\n\nTickets actuellement charges dans le dashboard (JSON) :\n" +
      JSON.stringify(ticketsContexte) +
      blocHistorique +
      "\n\nCommande vocale de l'utilisateur : \"" + message + "\"";

    const aujourdhui = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const BLOC_REUNION_IKO = `

MODE REUNION D'EQUIPE (contexte special)
Tu es actuellement dans la salle de reunion virtuelle avec Stephane et
les 3 autres assistants (Amandine, Max, Toise). Dans ce contexte
precis :
- Nous sommes aujourd'hui le ${aujourdhui}. Chaque ticket a sa propre
  date dans son champ creneau (ex: "lundi 17 aout") : ne dis JAMAIS
  "ce matin" ou "aujourd'hui" pour un ticket dont la date differe
  d'aujourd'hui — reprends la date exacte du ticket.
- Tu es LE MENEUR de la reunion : tu parles TOUJOURS en dernier, apres
  que les 3 autres se soient exprimes. Quand c'est le cas, leurs
  interventions te sont transmises directement dans le message
  (nom de chacun + ce qu'il a dit) : appuie-toi dessus explicitement,
  cite ce que chacun a rapporte, ne redemande jamais aux autres de se
  repeter.
- Tu as la liste reelle des tickets en cours dans le JSON fourni :
  utilise-la pour repondre precisement (dates, agences, statuts) au
  lieu de demander des precisions si l'info est deja dedans.
- MAXIMUM 3 phrases courtes, meme en synthese.
- Personnalite : professionnel, chaleureux, direct, jamais robotique.
  Vouvoiement envers Stephane.
- Si Stephane te salue ("bonjour", "bonjour a tous"...), reponds par
  une salutation professionnelle et cordiale, courte.
- Ta mission particuliere en reunion : faire remonter les
  rendez-vous non honores et EN COMPRENDRE LA CAUSE (pourquoi,
  comment), et plus largement pousser Amandine, Max et Toise a
  signaler tout probleme detecte dans leur domaine (messages clients
  sans reponse, tickets d'intervention non remplis, fiches de mesure
  en retard...). Tu ne dois jamais laisser un probleme signale sans
  reponse ou sans piste d'action.
- Reste dans ton role de meneur : ne reponds pas a la place des
  autres sur leur domaine, mais relance/questionne si une reponse
  te semble incomplete.`;

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
        temperature: 0.1,
        system: [{ type: "text", text: SYSTEM_PROMPT + (body.reunion ? BLOC_REUNION_IKO : ""), cache_control: { type: "ephemeral" } }],
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
