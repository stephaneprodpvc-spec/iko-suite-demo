// api/detecter-demande-client.js
// Appelé par suivi.html juste après l'envoi d'un message client. Si le
// message demande un changement de date de RDV, Iko propose automatiquement
// une nouvelle période dans "Réponse agence" (le client valide ensuite via
// le panneau "Changer la date" déjà existant : Planning/Tickets SAV ne sont
// modifiés qu'à ce moment-là, jamais ici).

import { verifierOrigine, verifierDebit } from "./_securite.js";
import { creneauxLibres, identDepuisClientId } from "./_planning.js";
import { blocSystemeIko } from "./_systeme-iko.js";
import { blocMetierMenuiserie } from "./_metier-menuiserie.js";
import { enteteMake } from "./_make.js";
import { ajouterMailsAuCorps, marqueClient, enrichirDepuisTicket } from "./_mail.js";
import { pousserAgence } from "./_alertes.js";

const MAKE_WEBHOOK = "https://hook.eu1.make.com/n3lwi92wldkf22jcemmjfem334p4mv6a"; // même scénario que le proxy
// IKO pose lui-même la nouvelle date quand le client en cite une précise et qu'elle est libre. Désactivable : IKO_REPLANIF_AUTO=0.
const REPLANIF_AUTO = process.env.IKO_REPLANIF_AUTO !== "0";

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

async function chargerTicket(ticketId) {
  const r = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV/" + encodeURIComponent(ticketId), { headers: airtableHeaders() });
  return r.ok ? await r.json() : null;
}
// Identite du client du ticket (lien "Compte client" du ticket) ; sans lien = demo.
async function identDepuisTicket(ticket) {
  const ctx = { baseId: AIRTABLE_BASE, headers: airtableHeaders() };
  const clientId = ((ticket && ticket.fields && ticket.fields["Compte client"]) || [])[0];
  return (await identDepuisClientId(ctx, clientId)) || { demo: true };
}
// Faits réels du ticket donnés à l'IA : elle répond d'après ces faits, jamais d'après son imagination.
function faitsTicket(t) {
  const f = (t && t.fields) || {};
  const lignes = [
    ["Numéro", f.Name], ["Statut", f.Statut || "Nouveau"], ["Produit", f.Produit], ["Problème", f["Problème"]], ["Rendez-vous", f["Créneau"]],
    ["Agence", f.Agence], ["Technicien assigné", f["Technicien assigné"]], ["Technicien en route depuis", f["En route depuis"]], ["Arrivée estimée", f["Arrivée estimée"]],
    ["Montant du devis", f["Montant devis"] ? f["Montant devis"] + " € TTC" : ""], ["Pièce à commander", f["Pièce à commander"]], ["Commande de pièce", f["Commande pièce"]],
  ].filter((x) => x[1]);
  return lignes.map((x) => "- " + x[0] + " : " + x[1]).join("\n");
}

// Nombre de creneaux libres du bon client et de la bonne agence (delai minimum et
// generation a la demande geres par api/_planning.js).
async function compterDispos(ident, agence, periode, moisSouhaite) {
  const ctx = { baseId: AIRTABLE_BASE, headers: airtableHeaders(), finAt: Date.now() + 7000 };
  const r = await creneauxLibres(ctx, ident, { agence, periode, mois: moisSouhaite || undefined });
  return r.creneaux.length;
}

// Repli sans IA (crédit Anthropic épuisé, panne réseau...) : détection simple par mots-clés,
// pour que le client puisse quand même choisir une nouvelle date.
const MOIS_FR = ["janvier","fevrier","mars","avril","mai","juin","juillet","aout","septembre","octobre","novembre","decembre"];
const pad2 = (n) => String(n).padStart(2, "0");
// Date précise citée par le client (« 28 octobre », « 28/10 »), format AAAA-MM-JJ ; null sinon.
function dateExplicite(t) {
  const maintenant = new Date();
  let jour, mois, annee = null;
  let m = /(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?/.exec(t);
  if (m) { jour = +m[1]; mois = MOIS_FR.indexOf(m[2]); annee = m[3] ? +m[3] : null; }
  else {
    m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
    if (!m) return null;
    jour = +m[1]; mois = +m[2] - 1; annee = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null;
  }
  if (jour < 1 || jour > 31 || mois < 0 || mois > 11) return null;
  if (!annee) { annee = maintenant.getFullYear(); if (new Date(annee, mois, jour, 12) < new Date(maintenant.getTime() - 86400000)) annee += 1; }
  return annee + "-" + pad2(mois + 1) + "-" + pad2(jour);
}
// Réponses sûres tirées des faits du ticket (utilisées sans IA, ou quand l'IA n'a rien d'exploitable).
function repondreDepuisTicket(texte, ticket) {
  const f = (ticket && ticket.fields) || {};
  const t = String(texte || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/(ou en est|avancement|statut|etat de|suivi de ma demande)/.test(t))
    return "Votre demande " + (f.Name || "") + " est actuellement au statut « " + (f.Statut || "Nouveau") + " »" + (f["Créneau"] ? ", avec un rendez-vous prévu : " + f["Créneau"] : "") + ".";
  if (/(quand|quelle heure|a quelle heure|jour de passage|rendez-vous|rdv)/.test(t) && f["Créneau"])
    return "Votre rendez-vous est prévu : " + f["Créneau"] + ". Pour le déplacer, indiquez simplement la date qui vous convient.";
  if (/(annul)/.test(t)) return "Pour annuler votre demande, utilisez le bouton « Annuler ma demande » sous votre dossier.";
  if (/(merci)/.test(t)) return "Avec plaisir. N'hésitez pas à nous écrire si vous avez une autre question.";
  return null;
}
function classifierSansIA(texte, ticket) {
  const t = String(texte || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const verbe = /(chang|deplac|decal|report|avanc|recul|modifi)/;
  const objet = /(date|rdv|rendez|intervention|passage)/;
  if (!(verbe.test(t) && objet.test(t))) return { intention: "autre", reponse: repondreDepuisTicket(texte, ticket) };
  let mois = null;
  const idx = MOIS_FR.findIndex(function (m) { return t.indexOf(m) !== -1; });
  if (idx >= 0) {
    const maintenant = new Date();
    let annee = maintenant.getFullYear();
    if (idx < maintenant.getMonth()) annee += 1;
    mois = annee + "-" + String(idx + 1).padStart(2, "0");
  }
  const periode = /apres[- ]?midi/.test(t) ? "apres_midi" : (/matin/.test(t) ? "matin" : null);
  return { intention: "changement_date", periode_souhaitee: periode, mois_souhaite: mois, date_souhaitee: dateExplicite(t), reponse: "Bonjour, nous avons bien reçu votre demande de changement de date." };
}

async function classifierMessage(texte, creneauActuelLabel, ticket) {
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
        "Tu es Amandine, assistante SAV d'Iko Suite (menuiserie). Nous sommes le " + new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }) + ". " +
        "Un client vient d'ecrire un message dans son espace de suivi SAV. Le RDV actuel du client est : " + (creneauActuelLabel || "non defini") + ". " +
        "Reponds UNIQUEMENT avec un objet JSON, sans aucun texte autour, de la forme : " +
        '{"intention":"changement_date"|"autre","periode_souhaitee":"matin"|"apres_midi"|null,"mois_souhaite":"AAAA-MM"|null,"date_souhaitee":"AAAA-MM-JJ"|null,"reponse":"..."}. ' +
        'date_souhaitee = le jour precis (AAAA-MM-JJ) UNIQUEMENT si le client cite une date exacte (ex. "mercredi 28 octobre", "le 3 novembre"), sinon null. ' +
        '"changement_date" = le client demande explicitement a deplacer, changer, avancer ou reculer ' +
        "son rendez-vous/sa date d'intervention. periode_souhaitee = matin ou apres-midi UNIQUEMENT si " +
        "le client le precise clairement dans son message, sinon null. mois_souhaite = le mois (et l'annee) " +
        "que le client vise, au format AAAA-MM, UNIQUEMENT s'il cite un mois, une periode (\"debut octobre\", " +
        "\"la semaine prochaine\" -> mois en cours ou suivant selon la date du jour, etc.) ou une date precise ; " +
        "sinon null. Si le client cite un mois sans annee, prends la prochaine occurrence a partir d'aujourd'hui. " +
        "\"reponse\" = une reponse courte (1 a 2 phrases, chaleureuse, vouvoiement, sans emoji ni markdown) " +
        "a envoyer immediatement au client. Si intention=changement_date, reponse doit juste accuser reception " +
        "de la demande (une autre etape se charge ensuite de proposer les creneaux, ne propose donc jamais " +
        "de date ou de disponibilite toi-meme). Si intention=autre, reponse doit repondre du mieux possible " +
        "au message du client avec les infos disponibles ; si tu ne peux pas resoudre sa demande toi-meme " +
        "(question technique complexe, prix, urgence...), dis simplement qu'un conseiller de l'agence revient " +
        "vers lui rapidement. Ne donne jamais de prix, ne confirme jamais un rendez-vous ou une info que tu " +
        "n'es pas sur. " +
        "FAITS REELS DU DOSSIER DE CE CLIENT (reponds uniquement d'apres eux, n'invente rien) :\n" + faitsTicket(ticket) + "\n" +
        blocSystemeIko("amandine") + blocMetierMenuiserie("amandine"),
      messages: [{ role: "user", content: texte.slice(0, MAX_CHARS_MESSAGE) }],
    }),
  });
  if (!reponse.ok) return classifierSansIA(texte, ticket);
  const data = await reponse.json();
  const bloc = (data.content || []).find(function (b) { return b.type === "text"; });
  if (!bloc) return classifierSansIA(texte, ticket);
  try {
    const nettoye = bloc.text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(nettoye);
    if (parsed.intention !== "changement_date") parsed.intention = "autre";
    return parsed;
  } catch (e) {
    return classifierSansIA(texte, ticket);
  }
}

// IKO déplace lui-même le rendez-vous quand le client cite une date précise et que le créneau est libre.
// Mêmes écritures que le panneau « Changer la date » du suivi client : nouveau créneau pris, ancien libéré, ticket mis à jour,
// technicien et agence prévenus. Retourne le nouveau créneau (texte) ou null si ce n'est pas possible (le flux de propositions prend alors le relais).
async function poserDateAutomatiquement(ticket, identClient, agence, dateIso, periodePreferee) {
  try {
    const f = ticket.fields || {};
    const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
    if (new Date(dateIso + "T12:00:00") <= aujourdhui) return null;
    const ctx = { baseId: AIRTABLE_BASE, headers: airtableHeaders(), finAt: Date.now() + 7000 };
    const ordre = periodePreferee === "apres_midi" ? ["apres_midi", "matin"] : ["matin", "apres_midi"];
    let choisi = null;
    for (const p of ordre) {
      const r = await creneauxLibres(ctx, identClient, { agence, periode: p, date: dateIso });
      choisi = (r.creneaux || []).find(function (c) { return c.date === dateIso; });
      if (choisi) break;
    }
    if (!choisi) return null;
    const verif = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning/" + encodeURIComponent(choisi.id), { headers: airtableHeaders() });
    if (!verif.ok) return null;
    const fp = (await verif.json()).fields || {};
    if (fp.Statut === "Pris" || fp.Statut === "Bloqué") return null;
    const prise = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning/" + encodeURIComponent(choisi.id), { method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ fields: { Statut: "Pris" } }) });
    if (!prise.ok) return null;
    if (f.PlanningID) {
      await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning/" + encodeURIComponent(f.PlanningID), { method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ fields: { Statut: "Libre" } }) }).catch(function () {});
    }
    const jourLabel = new Date(dateIso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const nouveauCreneau = (choisi.creneau || "") + " — " + jourLabel;
    const ancien = f["Créneau"] || "";
    const horodatage = new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    const confirmation = "C'est fait : votre rendez-vous est déplacé — " + nouveauCreneau + ". Votre technicien et l'agence en ont été informés.";
    const reponseExistante = f["Réponse agence"] || "";
    const patch = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV/" + encodeURIComponent(ticket.id), {
      method: "PATCH", headers: airtableHeaders(),
      body: JSON.stringify({ fields: { "Créneau": nouveauCreneau, PlanningID: choisi.id, Statut: "Nouveau", "Proposition auto en attente": false, "Proposition auto créneau": "", "Proposition auto mois": "",
        "RDV modifié - notif technicien": true, "Réponse agence": reponseExistante ? reponseExistante + "\n\n[" + horodatage + "]\n" + confirmation : "[" + horodatage + "]\n" + confirmation } }),
    });
    if (!patch.ok) return null;
    // Prévenir : mail à l'agence (Make) et notification en direct aux techniciens.
    try {
      const corps = { marque: "iko", action: "rdv_modifie", ticket: f.Name, agence: f.Agence || agence, ancien_creneau: ancien, nouveau_creneau: nouveauCreneau, auteur_modification: "client (déplacé automatiquement par IKO)" };
      const clientId = (f["Compte client"] || [])[0] || null;
      await enrichirDepuisTicket(corps, { baseId: AIRTABLE_BASE, headers: airtableHeaders() });
      ajouterMailsAuCorps(corps, "rdv_modifie", await marqueClient(clientId));
      await fetch(MAKE_WEBHOOK, { method: "POST", headers: enteteMake({ "Content-Type": "application/json" }), body: JSON.stringify(corps) });
    } catch (e) { console.error("Notification agence (rdv déplacé) :", e); }
    await pousserAgence({ agence: f.Agence || agence, titre: "RDV modifié — " + (f.Name || ""), message: (f.Client || "Client") + " : " + nouveauCreneau });
    return nouveauCreneau;
  } catch (e) {
    console.error("poserDateAutomatiquement :", e);
    return null;
  }
}

const REPONSE_REPLI = "Bonjour, nous avons bien recu votre message. Un conseiller de l'agence revient vers vous rapidement.";

async function ajouterReponseAgence(ticketId, texteMessage, champsSupplementaires) {
  const horodatage = new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
  const ticketResp = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV/" + encodeURIComponent(ticketId), { headers: airtableHeaders() });
  const ticketJson = await ticketResp.json();
  if (!ticketResp.ok) throw new Error("Ticket introuvable");
  const existant = ticketJson.fields?.["Réponse agence"] || "";
  const nouveauTexte = existant ? existant + "\n\n[" + horodatage + "]\n" + texteMessage : "[" + horodatage + "]\n" + texteMessage;
  const patch = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV/" + encodeURIComponent(ticketId), {
    method: "PATCH",
    headers: airtableHeaders(),
    body: JSON.stringify({ fields: Object.assign({ "Réponse agence": nouveauTexte }, champsSupplementaires || {}) }),
  });
  if (!patch.ok) {
    const detail = await patch.text().catch(function () { return ""; });
    console.error("Erreur PATCH Tickets SAV:", patch.status, detail);
    throw new Error("Ecriture Airtable echouee");
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

    const ticketRec = await chargerTicket(ticketId);
    if (!ticketRec) return res.status(404).json({ error: "Ticket introuvable" });
    const identClient = await identDepuisTicket(ticketRec);
    const classification = await classifierMessage(String(texte), creneauActuel, ticketRec);

    if (classification.intention !== "changement_date") {
      // Iko repond toujours a un message client, meme quand ce n'est pas une
      // demande de changement de date : reponse contextuelle de l'IA, ou
      // message de repli si l'IA n'a rien renvoye d'exploitable.
      const texteReponse = (typeof classification.reponse === "string" && classification.reponse.trim())
        ? classification.reponse.trim().slice(0, 600)
        : (repondreDepuisTicket(String(texte), ticketRec) || REPONSE_REPLI);
      await ajouterReponseAgence(ticketId, texteReponse, {});
      return res.status(200).json({ intention: "autre" });
    }

    let periode = classification.periode_souhaitee;
    if (periode !== "matin" && periode !== "apres_midi") {
      periode = periodeDepuisCreneauTexte(creneauActuel) || "matin";
    }
    // Date précise donnée par le client : IKO la pose lui-même si le créneau est libre.
    const dateVoulue = /^\d{4}-\d{2}-\d{2}$/.test(classification.date_souhaitee || "") ? classification.date_souhaitee : null;
    if (REPLANIF_AUTO && dateVoulue) {
      const pose = await poserDateAutomatiquement(ticketRec, identClient, agence, dateVoulue, periode);
      if (pose) return res.status(200).json({ intention: "changement_date", applique: true, creneau: pose });
    }
    const moisSouhaite = /^\d{4}-\d{2}$/.test(classification.mois_souhaite || "") ? classification.mois_souhaite : null;

    // Si un mois est demande, on cherche d'abord dedans ; sinon (ou si rien dispo
    // dans ce mois), on retombe sur la logique existante (prochaines dispos).
    let moisTrouve = false;
    let nbDispos = 0;
    if (moisSouhaite) {
      nbDispos = await compterDispos(identClient, agence, periode, moisSouhaite);
      if (nbDispos === 0) {
        const autrePeriode = periode === "matin" ? "apres_midi" : "matin";
        const nbAutre = await compterDispos(identClient, agence, autrePeriode, moisSouhaite);
        if (nbAutre > 0) { periode = autrePeriode; nbDispos = nbAutre; }
      }
      moisTrouve = nbDispos > 0;
    }
    if (!moisTrouve) {
      nbDispos = await compterDispos(identClient, agence, periode);
      if (nbDispos === 0) {
        const autrePeriode = periode === "matin" ? "apres_midi" : "matin";
        const nbAutre = await compterDispos(identClient, agence, autrePeriode);
        if (nbAutre > 0) periode = autrePeriode;
        nbDispos = nbAutre;
      }
    }

    const accuseReception = (typeof classification.reponse === "string" && classification.reponse.trim())
      ? classification.reponse.trim().slice(0, 300)
      : "Bonjour, nous avons bien recu votre demande de changement de date.";
    let texteMessage;
    if (nbDispos > 0 && moisTrouve) {
      texteMessage = accuseReception + " Choisissez une nouvelle date directement ci-dessous, dans la conversation.";
    } else if (nbDispos > 0) {
      texteMessage = accuseReception + (moisSouhaite ? " Nous n'avons pas de disponibilite sur la periode visee, mais voici les prochaines dates disponibles ci-dessous." : " Choisissez une nouvelle date directement ci-dessous, dans la conversation.");
    } else {
      texteMessage = accuseReception + " Nous n'avons pas de disponibilite dans l'immediat, un conseiller va revenir vers vous pour convenir d'une nouvelle date.";
    }

    await ajouterReponseAgence(ticketId, texteMessage, {
      "Proposition auto en attente": nbDispos > 0,
      "Proposition auto créneau": nbDispos > 0 ? periode : "",
      "Proposition auto mois": moisTrouve ? moisSouhaite : "",
    });

    return res.status(200).json({ intention: "changement_date", propose: nbDispos > 0, periode: periode });
  } catch (e) {
    console.error("Erreur detecter-demande-client:", e);
    return res.status(500).json({ error: "Une erreur est survenue." });
  }
}
