// api/chat-conseil.js
// Relais serveur entre la page conseil.html et l'API Claude (Anthropic).
// La clé ANTHROPIC_API_KEY reste ici (côté serveur) : elle n'est jamais
// envoyée au navigateur du visiteur.

import { verifierOrigine, verifierDebit } from "./_securite.js";
import vocabMenuiserie from "./_trades/menuiserie.js";
import vocabPlomberieChauffage from "./_trades/plomberie_chauffage.js";
import { extraireConnaissanceDuRecord, blocPromptConnaissance } from "./_connaissance.js";

const MODELE = "claude-haiku-4-5-20251001"; // le plus economique, largement suffisant ici
const MAX_MESSAGES = 30;        // garde-fou : longueur max d'une conversation
const MAX_CHARS_MESSAGE = 2000; // garde-fou : taille max d'un message

// Vocabulaire parametrable par metier (voir _trades/*.js) — meme mecanisme
// que chat-amandine.js. Menuiserie reste le repli par defaut si aucun
// client n'est resolu ou si son metier n'est pas renseigne.
const TRADES = {
  menuiserie: vocabMenuiserie,
  plomberie_chauffage: vocabPlomberieChauffage,
};
function loadTradeVocab(tradeId) {
  return TRADES[tradeId] || TRADES.menuiserie;
}

const AIRTABLE_BASE = "appkI8RKHkYNWY86U"; // meme base demo que chat-amandine.js

function airtableHeaders() {
  return {
    Authorization: "Bearer " + process.env.AIRTABLE_TOKEN,
    "Content-Type": "application/json",
  };
}

// Agences de ce client (table "Agences", filtre Client + Actif) — meme
// requete que obtenirAgencesClient() dans chat-amandine.js, reduite au nom
// seul : Stef n'a besoin que d'orienter le visiteur, pas des emails de
// notification internes (specifiques au flux SAV d'Amandine).
async function obtenirAgencesClient(clientId) {
  if (!clientId) return null;
  try {
    const formule = encodeURIComponent('AND(FIND("' + clientId + '", ARRAYJOIN({Client})), {Actif}=1)');
    const url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent("Agences") +
      "?filterByFormula=" + formule + "&maxRecords=10";
    const r = await fetch(url, { headers: airtableHeaders() });
    if (!r.ok) return null;
    const json = await r.json();
    const noms = (json.records || []).map(function (rec) { return rec.fields["Nom agence"] || ""; }).filter(Boolean);
    return noms.length > 0 ? noms : null;
  } catch (e) {
    console.error("obtenirAgencesClient erreur:", e);
    return null;
  }
}

// Resout le client courant a partir de son slug (?client= transmis par
// conseil.html) — meme pattern que resoudreClient() dans chat-amandine.js,
// reduit aux seules donnees utiles a Stef (pas de questionnaire SAV, hors
// sujet pour un conseiller commercial). Calcule par requete (pas de variable
// globale partagee) : plusieurs visiteurs de clients differents peuvent
// discuter avec Stef simultanement sur ce meme serveur.
// (Connaissance entreprise : voir extraireConnaissanceDuRecord dans
// _connaissance.js, module commun reutilise par les 4 assistants IKO.)
async function resoudreClient(slug) {
  if (!slug) return null;
  try {
    const formule = encodeURIComponent('{Slug}="' + String(slug).replace(/"/g, '\\"') + '"');
    const r = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Clients?filterByFormula=" + formule + "&maxRecords=1", { headers: airtableHeaders() });
    if (!r.ok) return null;
    const json = await r.json();
    const rec = (json.records || [])[0];
    if (!rec) return null;
    const metier = rec.fields && rec.fields["Métier"];
    const metierId = metier === "Menuiserie" ? "menuiserie" : (metier === "Plomberie & Chauffage" ? "plomberie_chauffage" : null);
    const agences = await obtenirAgencesClient(rec.id);
    return {
      id: rec.id,
      nom: (rec.fields && rec.fields["Nom client"]) || null,
      tradeId: (metierId && TRADES[metierId]) ? metierId : null,
      agences: agences,
      connaissance: extraireConnaissanceDuRecord(rec, metier),
    };
  } catch (e) {
    console.error("resoudreClient erreur:", e);
    return null;
  }
}

// Personnalité + cadre métier du conseiller. C'est ici qu'on définit ce qu'il
// a le droit de dire — et surtout ce qu'il ne doit pas inventer. Paramétré
// par le vocabulaire métier (trade) et, si un client est résolu, son nom et
// ses agences — comportement par défaut inchangé quand aucun client n'est
// transmis (repli menuiserie, pas d'agences).
function buildSystemPrompt(vocab, nomEntreprise, agencesNoms, connaissanceEntrees) {
  const nom = nomEntreprise || "RSIA IKO";
  const listeGammes = vocab.produits.map(function (p) { return "- " + p; }).join("\n");
  const blocAgences = (agencesNoms && agencesNoms.length > 0) ? `

AGENCES DE CETTE ENTREPRISE
${agencesNoms.join(", ")}
Si le visiteur mentionne une ville ou demande une agence, oriente-le vers celle
qui semble la plus proche parmi cette liste, sans jamais inventer d'adresse ni
de numéro de téléphone : laisse le conseiller humain confirmer les coordonnées
exactes.` : "";
  const blocConseilsMenuiserie = vocab.trade_id === "menuiserie" ? `

CONSEILS TECHNIQUES DE BASE (tu peux les donner)
- PVC : très bon isolant, entretien facile, plus économique, choix de teintes
  plus limité, moins adapté aux très grandes dimensions.
- Aluminium : fin et élégant, permet de grandes surfaces vitrées, large choix
  de couleurs RAL, plus onéreux que le PVC.
- Neuf / rénovation : en rénovation on conserve souvent le dormant existant,
  ce qui réduit légèrement la surface vitrée.` : "";
  const blocConnaissance = blocPromptConnaissance(connaissanceEntrees);

  return `Tu es le conseiller virtuel de ${nom}, spécialiste de ${vocab.nom_metier}.

TON RÔLE
Accueillir le visiteur, comprendre son projet, répondre aux questions générales,
et l'orienter vers un rendez-vous ou un devis avec un conseiller humain.

GAMMES COUVERTES
${listeGammes}

TON STYLE
- Chaleureux, direct, sans jargon inutile. Vouvoiement.
- Réponses courtes : 2 à 4 phrases maximum, sauf si on te demande un détail.
- Une seule question à la fois, jamais un questionnaire.

RÈGLES ABSOLUES
- Ne donne JAMAIS de prix, ni fourchette, ni estimation, même approximative.
  Pour toute question de prix : explique que cela dépend des dimensions et des
  options, et propose un rendez-vous pour un devis gratuit.
- N'invente JAMAIS de délai de livraison, de garantie chiffrée, ni de
  disponibilité produit. Si tu ne sais pas, dis-le simplement et propose de
  faire vérifier par un conseiller.
- Pour un problème sur une installation existante (panne, casse, réglage),
  c'est du SAV : oriente vers le service après-vente, ne tente pas de dépanner.
- Reste concentré sur ${vocab.nom_metier}. Si on te parle d'autre chose, ramène
  poliment la conversation vers le projet du visiteur.
${blocConseilsMenuiserie}
${blocAgences}
${blocConnaissance}

OBJECTIF
Quand le visiteur a exprimé son besoin, propose naturellement un rendez-vous
avec un conseiller (à domicile ou en agence) pour un devis gratuit.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  if (!verifierOrigine(req)) {
    return res.status(403).json({ error: "Origine non autorisée." });
  }
  if (!verifierDebit(req)) {
    return res.status(429).json({ error: "Trop de requêtes, réessayez dans une minute." });
  }

  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    console.error("ANTHROPIC_API_KEY absente des variables d'environnement");
    return res.status(500).json({ error: "Configuration serveur incomplète" });
  }

  try {
    const { messages, client_slug } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Aucun message reçu" });
    }
    if (messages.length > MAX_MESSAGES) {
      return res.status(400).json({ error: "Conversation trop longue" });
    }

    // Résolution tenant : identique au pattern chat-amandine.js. Calculée
    // par requête (pas de cache global) — plusieurs visiteurs de clients
    // différents peuvent discuter avec Stef en parallèle sur ce serveur.
    const contexteClient = await resoudreClient(client_slug || null);
    const vocabActuel = loadTradeVocab(contexteClient ? contexteClient.tradeId : null);
    const nomEntrepriseActuel = contexteClient ? contexteClient.nom : null;
    const agencesActuelles = contexteClient ? contexteClient.agences : null;
    const connaissanceActuelle = contexteClient ? contexteClient.connaissance : null;
    const systemPromptActuel = buildSystemPrompt(vocabActuel, nomEntrepriseActuel, agencesActuelles, connaissanceActuelle);

    // Conversion au format attendu par l'API Messages + validation.
    // L'API exige que le premier message soit de rôle "user" : on écarte donc
    // le message d'accueil affiché côté page tant qu'aucun visiteur n'a parlé.
    const convertis = [];
    for (const m of messages) {
      const texte = String(m && m.texte ? m.texte : "").slice(0, MAX_CHARS_MESSAGE);
      if (!texte.trim()) continue;
      const role = m.role === "assistant" ? "assistant" : "user";
      if (convertis.length === 0 && role !== "user") continue;
      convertis.push({ role, content: texte });
    }
    if (convertis.length === 0) {
      return res.status(400).json({ error: "Message vide" });
    }

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
        temperature: 0.7,
        system: systemPromptActuel,
        messages: convertis,
      }),
    });

    if (!reponse.ok) {
      const detail = await reponse.text();
      console.error("Erreur API Anthropic:", reponse.status, detail);
      return res.status(502).json({ error: "Le service de conversation est momentanément indisponible." });
    }

    const data = await reponse.json();
    const texte = (data && Array.isArray(data.content) ? data.content : [])
      .filter(bloc => bloc.type === "text")
      .map(bloc => bloc.text || "")
      .join("")
      .trim();

    if (!texte) {
      console.error("Réponse Anthropic vide:", JSON.stringify(data).slice(0, 500));
      return res.status(200).json({
        reponse: "Désolé, je n'ai pas pu formuler de réponse. Pouvez-vous reformuler votre question ?",
      });
    }

    return res.status(200).json({ reponse: texte });
  } catch (e) {
    console.error("Erreur chat-conseil:", e);
    return res.status(500).json({ error: "Une erreur est survenue. Merci de réessayer." });
  }
}
