// api/chat-conseil.js
// Relais serveur entre la page conseil.html et l'API Claude (Anthropic).
// La clé ANTHROPIC_API_KEY reste ici (côté serveur) : elle n'est jamais
// envoyée au navigateur du visiteur.

import { verifierOrigine, verifierDebit } from "./_securite.js";

const MODELE = "claude-haiku-4-5-20251001"; // le plus économique, largement suffisant ici
const MAX_MESSAGES = 30;        // garde-fou : longueur max d'une conversation
const MAX_CHARS_MESSAGE = 2000; // garde-fou : taille max d'un message

// Personnalité + cadre métier du conseiller. C'est ici qu'on définit ce qu'il
// a le droit de dire — et surtout ce qu'il ne doit pas inventer.
const SYSTEM_PROMPT = `Tu es le conseiller virtuel de RSIA IKO, spécialiste de la menuiserie.

TON RÔLE
Accueillir le visiteur, comprendre son projet, répondre aux questions générales,
et l'orienter vers un rendez-vous ou un devis avec un conseiller humain.

GAMMES COUVERTES
- Fenêtres et portes-fenêtres PVC et Aluminium
- Portes d'entrée
- Portails aluminium (battants et coulissants)
- Volets (roulants, battants)
- Stores bannes
- Vérandas

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
- Reste sur le sujet menuiserie. Si on te parle d'autre chose, ramène
  poliment la conversation vers le projet du visiteur.

CONSEILS TECHNIQUES DE BASE (tu peux les donner)
- PVC : très bon isolant, entretien facile, plus économique, choix de teintes
  plus limité, moins adapté aux très grandes dimensions.
- Aluminium : fin et élégant, permet de grandes surfaces vitrées, large choix
  de couleurs RAL, plus onéreux que le PVC.
- Neuf / rénovation : en rénovation on conserve souvent le dormant existant,
  ce qui réduit légèrement la surface vitrée.

OBJECTIF
Quand le visiteur a exprimé son besoin, propose naturellement un rendez-vous
avec un conseiller (à domicile ou en agence) pour un devis gratuit.`;

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
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Aucun message reçu" });
    }
    if (messages.length > MAX_MESSAGES) {
      return res.status(400).json({ error: "Conversation trop longue" });
    }

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
        system: SYSTEM_PROMPT,
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
