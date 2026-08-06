// api/detecter-demande-client.js
// Appelé par suivi.html juste après l'envoi d'un message client. Si le
// message demande un changement de date de RDV, Iko propose automatiquement
// une nouvelle période dans "Réponse agence" (le client valide ensuite via
// le panneau "Changer la date" déjà existant : Planning/Tickets SAV ne sont
// modifiés qu'à ce moment-là, jamais ici).

import { verifierOrigine, verifierDebit } from "./_securite.js";

const MODELE = "claude-haiku-4-5-20251001";
const AIRTABLE_BASE = "appkI8RKHkYNWY86U"; // base démo Iko Suite
const DELAI_MIN_JOURS = 7;
const MAX_CHARS_MESSAGE = 2000;

const CRENEAUX = {
  matin: "Matin (8h30 — 12h00)",
  apres_midi: "Après-midi (13h00 — 17h00)",
};

function airtableHeaders() {
  return {
    Authorization: "Bearer " + process.env.AIRTABLE_TOKEN,
    "Content-Type": "application/json",
  };
}

function periodeDepuisCreneauTexte(texte) {
  if (!texte) return null;
  if (texte.indexOf("Après-midi") === 0 || texte.indexOf("Apres-midi") === 0) return "apres_midi";
  if (texte.indexOf("Matin") === 0) return "matin";
  return null;
}

async function compterDispos(agence, periode) {
  const valeurCreneau = CRENEAUX[periode];
  const formule = "AND({Agence}=\"" + agence + "\",{Créneau}=\"" + valeurCreneau + "\",{Statut}=\"Libre\")";
  const url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning?filterByFormula=" + encodeURIComponent(formule) + "&sort[0][field]=Date&sort[0][direction]=asc&maxRecords=60";
  const r = await fetch(url, { headers: airtableHeaders() });
  const json = await r.json();
  if (!r.ok) return 0;
  const auPlusTot = new Date();
  auPlusTot.setDate(auPlusTot.getDate() + DELAI_MIN_JOURS);
  const auPlusTotStr = auPlusTot.toISOString().split("T")[0];
  return (json.records || []).filter(function (rec) { return rec.fields.Date && rec.fields.Date >= auPlusTotStr; }).length;
}

async function classifierMessage(texte, creneauActuelLabel) {
  const reponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELE,
      max_tokens: 200,
      temperature: 0,
      system:
        "Tu classes un message envoye par un client SAV Iko Suite dans son " +
        "espace de suivi. Le RDV actuel du client est : " + (creneauActuelLabel || "non defini") + ". " +
        "Reponds UNIQUEMENT avec un objet JSON, sans aucun texte autour, de la forme : " +
        '{"intention":"changement_date"|"autre","periode_souhaitee":"matin"|"apres_midi"|null}. ' +
        '"changement_date" = le client demande explicitement a deplacer, changer, avancer ou reculer ' +
        "son rendez-vous/sa date d'intervention. periode_souhaitee = matin ou apres-midi UNIQUEMENT si " +
        "le client le precise clairement dans son message, sinon null.",
      messages: [{ role: "user", content: texte.slice(0, MAX_CHARS_MESSAGE) }],
    }),
  });
  if (!reponse.ok) return { intention: "autre" };
  const data = await reponse.json();
  const bloc = (data.content || []).find(function (b) { return b.type === "text"; });
  if (!bloc) return { intention: "autre" };
  try {
    const nettoye = bloc.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(nettoye);
    if (parsed.intention !== "changement_date") return { intention: "autre" };
    return parsed;
  } catch (e) {
    return { intention: "autre" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Methode non autorisee" });
  if (!verifierOrigine(req)) return res.status(403).json({ error: "Origine non autorisée." });
  if (!verifierDebit(req)) return res.status(429).json({ error: "Trop de requêtes, réessayez dans une minute." });

  if (!process.env.ANTHROPIC_API_KEY || !process.env.AIRTABLE_TOKEN) {
    console.error("Variables d'environnement manquantes (ANTHROPIC_API_KEY / AIRTABLE_TOKEN)");
    return res.status(500).json({ error: "Configuration serveur incomplete" });
  }

  try {
    const { ticketId, texte, agence, creneauActuel } = req.body || {};
    if (!ticketId || !texte || !agence) return res.status(400).json({ error: "Parametres manquants" });

    const classification = await classifierMessage(String(texte), creneauActuel);
    if (classification.intention !== "changement_date") {
      return res.status(200).json({ intention: "autre" });
    }

    let periode = classification.periode_souhaitee;
    if (periode !== "matin" && periode !== "apres_midi") {
      periode = periodeDepuisCreneauTexte(creneauActuel) || "matin";
    }

    let nbDispos = await compterDispos(agence, periode);
    if (nbDispos === 0) {
      const autrePeriode = periode === "matin" ? "apres_midi" : "matin";
      const nbAutre = await compterDispos(agence, autrePeriode);
      if (nbAutre > 0) periode = autrePeriode;
      nbDispos = nbAutre;
    }

    const horodatage = new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const texteMessage = nbDispos > 0
      ? "Bonjour, nous avons bien recu votre demande de changement de date. " +
        "Cliquez sur \"Changer la date d'intervention\" ci-dessous pour choisir parmi nos prochaines disponibilites."
      : "Bonjour, nous avons bien recu votre demande de changement de date. " +
        "Nous n'avons pas de disponibilite dans l'immediat, un conseiller va revenir vers vous pour convenir d'une nouvelle date.";

    const ticketResp = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV/" + encodeURIComponent(ticketId), { headers: airtableHeaders() });
    const ticketJson = await ticketResp.json();
    if (!ticketResp.ok) return res.status(502).json({ error: "Ticket introuvable" });
    const existant = ticketJson.fields?.["Réponse agence"] || "";
    const nouveauTexte = existant ? existant + "\n\n[" + horodatage + "]\n" + texteMessage : "[" + horodatage + "]\n" + texteMessage;

    const patch = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV/" + encodeURIComponent(ticketId), {
      method: "PATCH",
      headers: airtableHeaders(),
      body: JSON.stringify({
        fields: {
          "Réponse agence": nouveauTexte,
          "Proposition auto en attente": nbDispos > 0,
          "Proposition auto créneau": nbDispos > 0 ? periode : "",
        },
      }),
    });
    if (!patch.ok) {
      const detail = await patch.text().catch(function () { return ""; });
      console.error("Erreur PATCH Tickets SAV:", patch.status, detail);
      return res.status(502).json({ error: "Ecriture Airtable echouee" });
    }

    return res.status(200).json({ intention: "changement_date", propose: nbDispos > 0, periode: periode });
  } catch (e) {
    console.error("Erreur detecter-demande-client:", e);
    return res.status(500).json({ error: "Une erreur est survenue." });
  }
}
