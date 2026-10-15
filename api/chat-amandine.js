// api/chat-amandine.js
// Relais serveur entre la page amandine.html et l'API Claude (Anthropic).
// La cle ANTHROPIC_API_KEY reste ici (cote serveur) : elle n'est jamais
// envoyee au navigateur du visiteur.
//
// Amandine peut desormais AGIR : lister les creneaux disponibles, reserver
// un creneau et creer un vrai ticket SAV, exactement comme le formulaire
// manuel de index.html (meme base Airtable Planning / Tickets SAV, meme
// webhook Make de creation de ticket). Le client garde donc le choix entre
// remplir le formulaire lui-meme ou tout faire a la voix/au clavier avec
// Amandine ; dans les deux cas, le meme systeme derriere est utilise.

import { limiterChat } from "./_securite.js";
import { lienSuivi } from "./_suivi.js";
import { creneauxLibres, identDepuisClientId } from "./_planning.js";
import vocabMenuiserie from "./_trades/menuiserie.js";
import vocabPlomberieChauffage from "./_trades/plomberie_chauffage.js";
import { blocSystemeIko } from "./_systeme-iko.js";
import { alerter } from "./_alertes.js";
import { photosHtml, adressesPhotos, ajouterMailsAuCorps, marqueClient } from "./_mail.js";
import { blocMetierMenuiserie } from "./_metier-menuiserie.js";
import { extraireConnaissanceDuRecord, blocPromptConnaissance, affinerPourPrompt } from "./_connaissance.js";
import { nomAssistant as resoudreNomAssistant, NOMS_PAR_DEFAUT } from "./_assistants.js";
import { enteteMake } from './_make.js';

// Vocabulaire parametrable par metier (voir trades/*.js). Menuiserie reste
// le repli par defaut pour ne rien casser sur les clients demo existants.
const TRADES = {
  menuiserie: vocabMenuiserie,
  plomberie_chauffage: vocabPlomberieChauffage,
};
function loadTradeVocab(tradeId) {
  return TRADES[tradeId] || TRADES.menuiserie;
}

const MODELE = "claude-haiku-4-5-20251001";  // le plus economique, largement suffisant ici
const MAX_MESSAGES = 60; // garde-fou : longueur max d'une conversation
const MAX_CHARS_MESSAGE = 2000; // garde-fou : taille max d'un message
const MAX_TOOL_ROUNDS = 5; // garde-fou : nombre d'aller-retours d'outils par tour de conversation

const AIRTABLE_BASE = "appkI8RKHkYNWY86U"; // base démo Iko Suite (était: prod Falliero)
const MAKE_WEBHOOK = "https://hook.eu1.make.com/n3lwi92wldkf22jcemmjfem334p4mv6a"; // scénario démo isolé (était: scénario prod partagé)
const DELAI_MIN_JOURS = 7;

// Enregistrement sentinelle Planning (Date="CONFIG") qui porte le nombre
// d'agences défini en mode concepteur (1 à 10) — même record que dashboard.html.
const CONFIG_RECORD_ID = "rec45X231n9dXnyaU";
const AGENCES_CACHE_TTL_MS = 60000;
let AGENCES_CACHE_TS = 0;

// Liste dynamique, synchronisée sur "Nombre agences" via synchroniserAgences().
// Valeur de départ = repli si la synchro échoue avant le premier appel.
let AGENCES_VALIDES = ["Agence 1", "Agence 2", "Agence 3", "Agence 4"];

// Metier de l'agence demo, synchronise sur le champ "Métier" du record
// CONFIG (Planning), meme mecanisme/cache que AGENCES_VALIDES. Repli sur
// "menuiserie" si le champ est vide ou absent (comportement historique).
let TRADE_ID = "menuiserie";

const CRENEAUX = {
    matin: "Matin (8h30 — 12h00)",
    apres_midi: "Après-midi (13h00 — 17h00)",
};

function buildSystemPrompt(vocab, agencesNoms, questionnairePersonnalise, connaissanceEntrees, nomAssistant) {
  const listeDiagnostics = vocab.diagnostics.map(function (d) { return "- " + d; }).join("\n");
  const listeAgences = (agencesNoms && agencesNoms.length > 0 ? agencesNoms : ["Agence 1", "Agence 2", "Agence 3", "Agence 4"]).join(", ");
  const blocQuestionnaire = (questionnairePersonnalise && questionnairePersonnalise.length > 0) ? `

QUESTIONNAIRE PERSONNALISE DE CE CLIENT
En plus (et a la place) des questions generiques du deroule ci-dessus pour
comprendre le probleme, pose aussi ces questions specifiques a ce client,
dans cet ordre, une seule a la fois, juste apres avoir compris le probleme
general et avant de demander l'agence :
${questionnairePersonnalise.map(function (q, i) {
  const choix = (q.type === "Choix multiple" && q.options) ? " (propose ces choix : " + q.options.split("\n").filter(Boolean).join(", ") + ")" : "";
  const oblig = q.obligatoire ? " [reponse obligatoire]" : " [optionnel, tu peux passer si le client ne sait pas]";
  return (i + 1) + ". " + q.question + choix + oblig;
}).join("\n")}
Quand tu appelles creer_ticket, remplis le champ reponses_questionnaire avec
un objet JSON en texte, au format {"question 1": "reponse", "question 2": "reponse"},
en reprenant exactement le texte de chaque question ci-dessus comme cle.` : "";
  const blocConnaissance = blocPromptConnaissance(connaissanceEntrees);
  return `
Tu es ${nomAssistant}, l'assistante SAV en ligne d'Iko Suite, specialiste de
${vocab.nom_metier}.

TON ROLE
Le client peut soit remplir le formulaire de demande SAV lui-meme, soit tout
faire en discutant avec toi. Si le client veut ouvrir un ticket SAV et/ou
prendre rendez-vous, tu peux reellement le faire toi-meme via tes outils
(lister_creneaux, creer_ticket) : tu n'es pas qu'une
conversation, tu agis pour de vrai, exactement comme s'il avait rempli le
formulaire.

TON STYLE
- Chaleureuse, directe, sans jargon inutile. Vouvoiement.
- Reponses courtes : 2 a 4 phrases maximum, sauf recapitulatif final.
- Une seule question a la fois, jamais un questionnaire. Si le client donne
  plusieurs informations d'un coup, prends-les toutes en compte et ne
  redemande JAMAIS ce que tu sais deja. Ne repete pas ce que le client vient de dire.
- N'utilise JAMAIS d'emoji ni de pictogramme dans tes reponses (pas de main,
pas de coeur, pas de sourire, aucun symbole decoratif) : uniquement du texte
simple, car tes reponses sont aussi lues a voix haute.
- N'utilise JAMAIS de markdown dans tes reponses (pas d'asterisques, pas de
gras, pas d'italique, pas de #, pas de listes a puces) : le texte est affiche
brut, donc ecris uniquement du texte simple, y compris pour les numeros de
ticket (ex: SAV-2026-1234, jamais **SAV-2026-1234**).

DEROULE POUR OUVRIR UN TICKET / PRENDRE RDV
1. Comprendre le probleme (quel produit, quelle panne, depuis quand).
2. ${agencesNoms && agencesNoms.length === 1 ? "Ce client n'a qu'une seule agence : " + agencesNoms[0] + ". Ne demande PAS l'agence, utilise-la directement." : "Demander l'agence du client parmi : " + listeAgences + "."} Si le client
   donne juste sa ville, associe-la a l'agence la plus proche parmi
      celles-ci.
      3. Recuperer nom complet, telephone, e-mail, adresse complete (rue, code
         postal, ville).
         Attention a l'email dicte a l'oral : les clients disent parfois "arobase" pour
         @ et "point" pour . (ex: "jean point dupont arobase gmail point com"). Convertis
         toujours ca en adresse email standard avant de l'utiliser (jean.dupont@gmail.com).
         Verifie que l'adresse contient bien un @ et un domaine plausible ; si ce n'est
         pas le cas, relis l'adresse au client et demande-lui de confirmer ou de la
         repreciser avant d'appeler creer_ticket.
         3bis. Des que tu as le nom OU le telephone du client, appelle
         consulter_historique_ouvertures. S'il existe un historique, utilise-le
         naturellement dans la conversation (ex: "je vois que vous avez une
         fenetre F1 posee en tunnel, c'est celle-la qui pose probleme ?") au
         lieu de tout redemander depuis zero. Si rien n'est trouve, continue
         normalement sans le mentionner (ne dis jamais "je n'ai rien trouve").
         4. Demander si l'equipement est sous garantie (facture Iko Suite) ; si oui,
            demander le numero de facture. Sinon note "hors garantie".
            5. Si le client veut un rendez-vous : demande la periode preferee (matin ou
               apres-midi), appelle lister_creneaux, propose 2-3 dates parmi celles
                  renvoyees en annoncant aussi l'horaire indique pour chacune (champ
                  horaire). Si un jour a plusieurs horaires_disponibles, propose-les au
                  client. Quand il a choisi, NE RESERVE RIEN a part : la reservation se fait
                  automatiquement dans creer_ticket (champs rdv_date, rdv_horaire).
                     Si le client prefere etre rappele pour convenir d'un horaire plutot que de
                        choisir maintenant, c'est possible : laisse alors rdv_date vide.
                        6. Quand tu as toutes les infos, fais UN recapitulatif court (produit et
                           probleme, adresse, agence, rendez-vous choisi, e-mail) et demande
                           "Je l'enregistre ?". Des que le client dit oui, appelle creer_ticket
                           IMMEDIATEMENT, sans reposer de questions. Le systeme ecrit lui-meme
                           le message de confirmation (numero de ticket, rendez-vous, e-mail) :
                           ne reformule pas et n'ajoute rien apres l'appel de l'outil.
                           Si l'outil renvoie une erreur (creneau pris), explique-le simplement et
                           propose d'autres dates.

                              REGLES ABSOLUES
                              - Ne donne JAMAIS de prix. Si on te le demande, dis-le simplement et propose
                                qu'un conseiller confirme.
                                - Ne donne JAMAIS de numero de ticket ou de confirmation de rendez-vous sans
                                  avoir reellement appele l'outil correspondant et recu un resultat.
                                  - N'invente JAMAIS de creneau, de disponibilite ou de numero de telephone
                                    d'agence.
                                    - En cas d'urgence securite (degat des eaux en cours, effraction, portail
                                      dangereux), invite le client a contacter directement son agence
                                        par telephone plutot que d'attendre ; propose quand meme d'ouvrir un
                                          ticket en parallele si le client le souhaite.
                                          - Reste sur le sujet SAV. Si on te parle d'un nouveau projet ou d'un devis,
                                            redirige poliment vers le conseiller commercial.
                                          - ${vocab.regle_securite}

QUELQUES PISTES DE DIAGNOSTIC DE BASE (a titre indicatif, jamais une garantie)
${listeDiagnostics}
${blocQuestionnaire}
${blocConnaissance}
${blocSystemeIko("amandine")}
${vocab.trade_id === "menuiserie" ? blocMetierMenuiserie("amandine") : ""}
`;
}
// Construit la liste d'outils pour UN appel donne, avec l'enum d'agences et
// le vocabulaire produit du client concerne (ou le repli demo si aucun
// client resolu). Reconstruit a chaque requete au lieu d'une constante
// partagee, pour eviter qu'un client A voie les agences d'un client B sur
// un meme serveur (meme raison que resoudreClient calcule par requete).
function buildTools(agencesNoms, vocab) {
  const listeAgences = agencesNoms && agencesNoms.length > 0 ? agencesNoms : AGENCES_VALIDES;
  return [
  {
    name: "lister_creneaux",
    description: "Liste les creneaux de rendez-vous disponibles pour une agence et une periode donnees (au moins " + DELAI_MIN_JOURS + " jours a l'avance). Retourne jusqu'a 5 dates avec leur horaire (ex. 9h00 — 10h00) et leur identifiant interne a reutiliser dans reserver_creneau.",
    input_schema: {
      type: "object",
      properties: {
        agence: { type: "string", enum: listeAgences, description: "Agence concernee." },
        periode: { type: "string", enum: ["matin", "apres_midi"], description: "Periode de la journee souhaitee." },
      },
      required: ["agence", "periode"],
    },
  },
  {
    name: "creer_ticket",
    description: "Cree reellement le ticket SAV dans le systeme Iko Suite (meme mecanisme que le formulaire manuel), RESERVE le creneau choisi s'il y en a un, et notifie l'agence. C'est le SEUL outil qui enregistre une demande et un rendez-vous : sans lui rien n'existe. A appeler une seule fois, quand toutes les informations necessaires ont ete recueillies (et le recapitulatif confirme par le client). Si le creneau n'est plus libre, l'outil renvoie une erreur et ne cree rien : propose alors d'autres dates.",
    input_schema: {
      type: "object",
      properties: {
        agence: { type: "string", enum: listeAgences },
        nom: { type: "string", description: "Nom complet du client." },
        telephone: { type: "string" },
        email: { type: "string" },
        adresse: { type: "string", description: "Adresse complete : rue, code postal, ville." },
        produit: { type: "string", description: "Ex : " + (vocab || TRADES.menuiserie).produits.join(", ") + "." },
        probleme: { type: "string", description: "Description du probleme rencontre." },
        urgent: { type: "boolean", description: "true si probleme de securite ou degat en cours." },
        garantie: { type: "string", enum: ["oui", "non", "inconnu"] },
        numero_facture: { type: "string", description: "Numero de facture si sous garantie, sinon vide." },
        rdv_date: { type: "string", description: "Date du rendez-vous choisi parmi celles de lister_creneaux (AAAA-MM-JJ ou texte comme 'jeudi 22 octobre'). Laisser vide si le client prefere etre rappele." },
        rdv_periode: { type: "string", enum: ["matin", "apres_midi"], description: "Periode du rendez-vous choisi (celle demandee a lister_creneaux). OBLIGATOIRE des que rdv_date est renseigne." },
        rdv_horaire: { type: "string", description: "Horaire choisi si plusieurs horaires etaient proposes ce jour-la (ex. 9h00 — 10h00). Sinon vide." },
        planning_id: { type: "string", description: "Identifiant du creneau, tel que renvoye par lister_creneaux, si tu l'as encore. Sinon vide (rdv_date + agence suffisent)." },
        reponses_questionnaire: { type: "string", description: "Si un questionnaire personnalise a ete fourni dans tes instructions, objet JSON en texte {\"question\": \"reponse\"} avec les reponses recueillies. Laisser vide sinon." },
      },
      required: ["agence", "nom", "telephone", "email", "adresse", "produit", "probleme", "urgent", "garantie"],
    },
  },
  {
    name: "consulter_historique_ouvertures",
    description: "Recherche si ce client a deja des ouvertures (fenetres, portes...) mesurees et posees precedemment, a partir de son nom ou telephone. A appeler des que tu connais le nom ou le telephone du client et avant de lui demander de decrire son produit en detail : s'il a un historique, tu peux t'appuyer dessus (repere, type, pose, dimensions) au lieu de tout lui faire redecrire.",
    input_schema: {
      type: "object",
      properties: {
        recherche: { type: "string", description: "Nom du client ou numero de telephone." },
      },
      required: ["recherche"],
    },
  },
  ];
}

function airtableHeaders() {
  return {
    Authorization: "Bearer " + process.env.AIRTABLE_TOKEN,
    "Content-Type": "application/json",
  };
}

// Aligne AGENCES_VALIDES (repli demo, hors client resolu) sur le mode
// concepteur (dashboard.html) en lisant "Nombre agences" sur le record
// sentinelle Planning. Mutation en place. Cache 60s pour eviter un appel
// Airtable a chaque message.
// Resout le client courant a partir de son slug (?client=slug transmis par
// amandine.html). Calcul PAR REQUETE (pas de variable globale partagee, a
// la difference de TRADE_ID/AGENCES_VALIDES) car plusieurs clients peuvent
// discuter avec Amandine simultanement sur ce meme serveur.
// (Connaissance entreprise : voir extraireConnaissanceDuRecord dans
// _connaissance.js, module commun reutilise par les 4 assistants IKO.)

// Questionnaire SAV personnalise de ce client (table "Questionnaire SAV",
// filtre Client + Actif, trie par Ordre). null si le client n'en a pas
// defini (Amandine garde alors le deroule generique par defaut).
async function obtenirQuestionnaireClient(clientId) {
  if (!clientId) return null;
  try {
    const formule = encodeURIComponent('AND(FIND("' + clientId + '", ARRAYJOIN({Client})), {Actif}=1)');
    const url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent("Questionnaire SAV") +
      "?filterByFormula=" + formule + "&sort[0][field]=Ordre&sort[0][direction]=asc&maxRecords=30";
    const r = await fetch(url, { headers: airtableHeaders() });
    if (!r.ok) return null;
    const json = await r.json();
    const questions = (json.records || []).map(function (rec) {
      return {
        question: rec.fields["Question"] || "",
        type: rec.fields["Type de réponse"] || "Texte libre",
        options: rec.fields["Options"] || "",
        obligatoire: !!rec.fields["Obligatoire"],
      };
    }).filter(function (q) { return q.question; });
    return questions.length > 0 ? questions : null;
  } catch (e) {
    console.error("obtenirQuestionnaireClient erreur:", e);
    return null;
  }
}

// Agences de ce client (table "Agences", filtre Client + Actif), avec leurs
// emails de notification. null si le client n'a pas encore d'agences
// configurees (Amandine garde alors le repli demo AGENCES_VALIDES).
async function obtenirAgencesClient(clientId, clientNom, nombreAgences) {
  if (!clientId || !clientNom) return null;
  try {
    // ARRAYJOIN() sur un lien renvoie le NOM affiche (pas l'ID) : on filtre par
    // nom, puis on verifie le lien par ID sur les enregistrements recus.
    const plafond = Math.max(1, Math.min(10, parseInt(nombreAgences, 10) || 10));
    const formule = encodeURIComponent('AND(FIND("' + String(clientNom).replace(/"/g, '\\"') + '", ARRAYJOIN({Client})), {Actif}=1)');
    const url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent("Agences") +
      "?filterByFormula=" + formule + "&maxRecords=50";
    const r = await fetch(url, { headers: airtableHeaders() });
    if (!r.ok) return null;
    const json = await r.json();
    const agences = (json.records || []).filter(function (rec) {
      return Array.isArray(rec.fields["Client"]) && rec.fields["Client"].indexOf(clientId) !== -1;
    }).slice(0, plafond).map(function (rec) {
      return {
        nom: rec.fields["Nom agence"] || "",
        emailAgence: rec.fields["Email agence"] || "",
        emailTechnicien: rec.fields["Email technicien SAV"] || "",
      };
    }).filter(function (a) { return a.nom; });
    return agences.length > 0 ? agences : null;
  } catch (e) {
    console.error("obtenirAgencesClient erreur:", e);
    return null;
  }
}

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
    const [questionnaire, agences] = await Promise.all([
      obtenirQuestionnaireClient(rec.id),
      obtenirAgencesClient(rec.id, rec.fields && rec.fields["Nom client"], rec.fields && rec.fields["Nombre agences"]),
    ]);
    return {
      id: rec.id,
      tradeId: (metierId && TRADES[metierId]) ? metierId : null,
      questionnaire: questionnaire,
      agences: agences,
      bloque: rec.fields && rec.fields["Accès bloqué"] === true,
      connaissance: extraireConnaissanceDuRecord(rec, metier),
      // Nom affiche pour Amandine, personnalisable via le champ Airtable
      // "Assistants (JSON)" sur Clients ; repli sur "Amandine" si absent.
      nomAssistant: resoudreNomAssistant(rec.fields, "amandine"),
    };
  } catch (e) {
    console.error("resoudreClient erreur:", e);
    return null;
  }
}

async function synchroniserAgences() {
  if (Date.now() - AGENCES_CACHE_TS < AGENCES_CACHE_TTL_MS) return;
  try {
    const r = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning/" + CONFIG_RECORD_ID, { headers: airtableHeaders() });
    if (r.ok) {
      const json = await r.json();
      const n = Math.max(1, Math.min(10, parseInt(json.fields?.["Nombre agences"], 10) || 4));
      AGENCES_VALIDES.length = 0;
      for (let i = 1; i <= n; i++) AGENCES_VALIDES.push("Agence " + i);

      const metier = json.fields?.["Métier"];
      TRADE_ID = TRADES[metier] ? metier : "menuiserie";
      // Note : plus besoin de muter un TOOLS global ici, buildTools()
      // reconstruit l'enum agences et la description produit a chaque
      // requete (voir handler plus bas).
    }
  } catch (e) {
    console.error("synchroniserAgences erreur:", e);
  }
  AGENCES_CACHE_TS = Date.now();
}

function filtreAvecClientServeur(baseFormula, clientId) {
  if (!clientId) return baseFormula;
  const clause = 'FIND("' + clientId + '", ARRAYJOIN({Compte client}))';
  return baseFormula ? "AND(" + baseFormula + "," + clause + ")" : clause;
}

// Réserve réellement un créneau du planning (identifiant vérifié, sinon retrouvé par agence + date). Retourne { ok, id, texte } ou { erreur }.
async function reserverCreneauServeur(input, clientId) {
  const MOIS_FR = { janvier: 1, "février": 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, "août": 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, "décembre": 12, decembre: 12 };
  const versIso = function (txt) {
    const t = String(txt || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = /(\d{1,2})\s+(\p{L}+)(?:\s+(\d{4}))?/u.exec(t);
    if (!m || !MOIS_FR[m[2].toLowerCase()]) return null;
    const auj = new Date();
    let an = m[3] ? parseInt(m[3], 10) : auj.getFullYear();
    let d = new Date(an, MOIS_FR[m[2].toLowerCase()] - 1, parseInt(m[1], 10), 12);
    if (!m[3] && d < new Date(auj.getTime() - 86400000)) d = new Date(an + 1, d.getMonth(), d.getDate(), 12);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const indispo = { erreur: "Ce creneau n'est plus disponible : aucun ticket n'a ete cree. Propose au client d'autres dates avec lister_creneaux." };
  const dateIso = versIso(input.rdv_date || input.date);
  const urlPlanning = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning/";
  let cible = null;
  if (input.planning_id && /^rec[A-Za-z0-9]{10,}$/.test(String(input.planning_id))) {
    const g = await fetch(urlPlanning + encodeURIComponent(input.planning_id), { headers: airtableHeaders() });
    if (g.ok) {
      const f = (await g.json()).fields || {};
      if (f.Statut !== "Pris" && f.Statut !== "Bloqué" && (!dateIso || String(f.Date).slice(0, 10) === dateIso)) cible = input.planning_id;
    }
  }
  if (!cible && input.agence && dateIso) {
    const ctxPl = { baseId: AIRTABLE_BASE, headers: airtableHeaders(), finAt: Date.now() + 7000 };
    const ident = await identDepuisClientId(ctxPl, clientId);
    if (ident && !ident.bloque) {
      const dispo = await creneauxLibres(ctxPl, ident, { agence: input.agence, date: dateIso });
      let duJour = (dispo.creneaux || []).filter(function (c) { return c.date === dateIso; });
      // La période demandée est respectée : on ne bascule JAMAIS un client du matin vers l'après-midi sans qu'il le sache.
      const estMatin = function (c) { const t = String(c.creneau || ""); return t.indexOf("Matin") === 0 || (/^d{1,2}h/.test(t) && parseInt(t, 10) < 13); };
      const estAprem = function (c) { const t = String(c.creneau || ""); return t.indexOf("Après-midi") === 0 || (/^d{1,2}h/.test(t) && parseInt(t, 10) >= 13); };
      if (input.rdv_periode === "matin") duJour = duJour.filter(estMatin);
      else if (input.rdv_periode === "apres_midi") duJour = duJour.filter(estAprem);
      else if (duJour.some(estMatin) && duJour.some(estAprem)) {
        return { erreur: "Precise si le client veut le matin ou l'apres-midi (rdv_periode), puis rappelle creer_ticket : aucun ticket n'a ete cree." };
      }
      const h = String(input.rdv_horaire || input.horaire || "").toLowerCase();
      const choisi = (h && duJour.find(function (c) { return String(c.creneau || "").toLowerCase().indexOf(h) !== -1; })) || duJour[0];
      if (choisi) cible = choisi.id;
    }
  }
  if (!cible) return indispo;
  const r = await fetch(urlPlanning + encodeURIComponent(cible), { method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ fields: { Statut: "Pris" } }) });
  if (!r.ok) { const detail = await r.text().catch(function () { return ""; }); console.error("Airtable reserver creneau erreur:", r.status, detail); return indispo; }
  // Texte lisible du créneau réellement réservé (jamais celui que le modèle aurait pu inventer).
  let texte = "";
  try {
    const g2 = await fetch(urlPlanning + encodeURIComponent(cible), { headers: airtableHeaders() });
    const fp = g2.ok ? ((await g2.json()).fields || {}) : {};
    const jour = new Date(String(fp.Date || dateIso || "").slice(0, 10) + "T12:00:00");
    const lisible = isNaN(jour) ? "" : jour.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    texte = (lisible ? lisible + " — " : "") + (fp["Créneau"] || fp.Creneau || "");
  } catch (e) { /* texte de repli ci-dessous */ }
  return { ok: true, id: cible, texte: texte || String(input.rdv_date || input.date || "") };
}

async function executerOutil(nom, input, clientId, tradeId, agencesObjets, photosJointes, texteClient) {
  const agencesNoms = (agencesObjets && agencesObjets.length > 0) ? agencesObjets.map(function (a) { return a.nom; }) : AGENCES_VALIDES;
  try {
    if (nom === "lister_creneaux") {
      const valeurCreneau = CRENEAUX[input.periode];
      if (!agencesNoms.includes(input.agence) || !valeurCreneau) {
        return { erreur: "Agence ou periode invalide." };
      }
      // Creneaux du bon client ET de la bonne agence (module partage api/_planning.js :
      // lien client verifie par identifiant, generation a la demande, delai minimum du client).
      const ctxPlanning = { baseId: AIRTABLE_BASE, headers: airtableHeaders(), finAt: Date.now() + 7000 };
      const ident = await identDepuisClientId(ctxPlanning, clientId); // sans client = demo
      if (!ident) return { erreur: "Client introuvable." };
      if (ident.bloque) return { creneaux: [] };
      const dispo = await creneauxLibres(ctxPlanning, ident, { agence: input.agence, periode: input.periode });
      const parDate = {};
      dispo.creneaux.forEach(function (c) {
        if (!parDate[c.date]) parDate[c.date] = { date: c.date, planning_id: c.id, horaire: c.creneau, tous: [] };
        if (/^\d{1,2}h\d{2}/.test(c.creneau || "") && parDate[c.date].tous.length < 8) parDate[c.date].tous.push({ planning_id: c.id, horaire: c.creneau });
      });
      const debutMin = function (h) { const m = /^(\d{1,2})h(\d{2})/.exec(h || ""); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0; };
      Object.values(parDate).forEach(function (j) {
        j.tous.sort(function (a, b) { return debutMin(a.horaire) - debutMin(b.horaire); });
        if (j.tous.length) { j.planning_id = j.tous[0].planning_id; j.horaire = j.tous[0].horaire; }
      });
      const creneaux = Object.values(parDate).slice(0, 5).map(function (c) {
        const d = new Date(c.date + "T12:00:00");
        return {
          planning_id: c.planning_id,
          date_lisible: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
          horaire: c.horaire || "",
          // Mode heures precises : tous les horaires libres ce jour-la (chacun avec son planning_id).
          ...(c.tous.length > 1 ? { horaires_disponibles: c.tous } : {}),
        };
      });
      return { creneaux: creneaux };
    }

  if (nom === "creer_ticket") {
    if (!agencesNoms.includes(input.agence)) {
      return { erreur: "Agence invalide." };
    }
    // Le client a demandé un rendez-vous mais aucun créneau n'est choisi : on ne crée PAS de ticket sans rendez-vous à sa place.
    const veutRdv = /(rendez-vous|rdv|cr[ée]neau|matin|apr[eè]s-midi|quelle date|date)/i.test(String(texteClient || "")) && !/(rappel|recontact|appelez|appeler)/i.test(String(texteClient || ""));
    if (veutRdv && !input.rdv_date && !input.planning_id) {
      return { erreur: "Le client souhaite un rendez-vous : appelle lister_creneaux (agence + periode), propose les dates et fais-lui choisir une date AVANT creer_ticket. Aucun ticket n'a ete cree." };
    }
    // Réservation du créneau AVANT toute création : si le créneau n'est plus libre, aucun ticket n'est créé.
    let rdvReserve = null;
    if (input.rdv_date || input.planning_id) {
      rdvReserve = await reserverCreneauServeur(input, clientId);
      if (!rdvReserve.ok) return rdvReserve;
    }
    // Numéro tiré au hasard (4 chiffres) : on vérifie qu'il n'existe pas déjà pour éviter deux tickets
    // avec le même numéro (suivi client et recherche se baseraient sur le mauvais dossier).
    let numero = "";
    for (let essai = 0; essai < 6; essai++) {
      const candidat = "SAV-" + new Date().getFullYear() + "-" + (Math.floor(Math.random() * 9000) + 1000);
      numero = candidat;
      try {
        const rDoublon = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV?filterByFormula=" + encodeURIComponent('{Name}="' + candidat + '"') + "&maxRecords=1&fields%5B%5D=Name", { headers: airtableHeaders() });
        const jDoublon = await rDoublon.json();
        if (!(jDoublon.records || []).length) break;
      } catch (e) { break; }
    }
    const garantieTexte = input.garantie === "oui" ? "Oui - Facture " + (input.numero_facture || "") : input.garantie === "non" ? "Non / Hors garantie" : "N/A";
    const agenceInfo = (agencesObjets || []).find(function (a) { return a.nom === input.agence; });

    const payload = {
      marque: "iko",
      ticket: numero,
      agence: input.agence,
      nom: input.nom,
      tel: input.telephone,
      "e-mail": input.email,
      adresse: input.adresse,
      produit: input.produit,
      probleme: input.probleme,
      creneau: rdvReserve ? rdvReserve.texte : "A convenir",
      garantie: garantieTexte,
      facture: input.numero_facture || "",
      urgent: input.urgent ? "Oui" : "Non",
      photos: Array.isArray(photosJointes) ? photosJointes.join(",") : "",
      photos_html: photosHtml(Array.isArray(photosJointes) ? photosJointes.join(",") : ""),
      nb_photos: adressesPhotos(Array.isArray(photosJointes) ? photosJointes.join(",") : "").length,
      facture_photo: "",
      planningId: rdvReserve ? rdvReserve.id : "",
      source: "Amandine (IA)",
      // Lien de suivi personnel (jeton chiffre), a inserer dans le mail Make.
      // Jamais renvoye au navigateur : seul le numero de ticket l'est.
      lien_suivi: (input.email ? lienSuivi(null, { email: input.email, tel: input.telephone, ticket: numero }) : ""),
      // Emails specifiques a cette agence (table Agences), si ce client en a
      // configure. A brancher cote scenario Make pour le routage des
      // notifications par agence (mapping non fait dans cette session).
      email_agence: (agenceInfo && agenceInfo.emailAgence) || "",
      email_technicien: (agenceInfo && agenceInfo.emailTechnicien) || "",
    };

    ajouterMailsAuCorps(payload, undefined, await marqueClient(clientId)); // mail_objet / mail_html déjà prêts pour Make, aux couleurs du client
    const r = await fetch(MAKE_WEBHOOK, {
      method: "POST",
      headers: enteteMake({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      // Le créneau a été réservé juste avant : sans ticket, il resterait "Pris" pour rien. On le libère.
      if (rdvReserve && rdvReserve.id) {
        try {
          await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning/" + encodeURIComponent(rdvReserve.id), {
            method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ fields: { Statut: "Libre" } }),
          });
        } catch (e) { console.error("Libération du créneau après échec de création du ticket", e); }
      }
      alerter({ cle: "amandine-ticket-echec", client: clientId || null, titre: "IKO : un client n'a pas pu créer sa demande", message: "La création d'un ticket via Amandine a échoué (agence : " + String(input.agence || "?") + ", produit : " + String(input.produit || "?") + "). Vérifiez le scénario Make." });
      return { erreur: "La creation du ticket a echoue, merci de reessayer." };
    }

    if (clientId || input.reponses_questionnaire) {
      // Le ticket est cree de maniere asynchrone par le scenario Make (pas
      // directement par ce code). On attend un court instant puis on le
      // retrouve par son numero (genere ci-dessus, donc connu et unique)
      // pour lui attacher le lien "Compte client" et/ou les reponses du
      // questionnaire personnalise. Best-effort : si ca echoue, le ticket
      // existe deja et fonctionne, juste sans ces champs complementaires.
      try {
        await new Promise(function (resolve) { setTimeout(resolve, 2500); });
        const formuleTicket = encodeURIComponent('{Name}="' + numero + '"');
        const rTicket = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV?filterByFormula=" + formuleTicket + "&maxRecords=1", { headers: airtableHeaders() });
        const jsonTicket = await rTicket.json();
        const ticketRec = (jsonTicket.records || [])[0];
        if (ticketRec) {
          const champsMaj = {};
          if (clientId) champsMaj["Compte client"] = [clientId];
          if (input.reponses_questionnaire) champsMaj["Réponses questionnaire"] = String(input.reponses_questionnaire).slice(0, 5000);
          await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Tickets%20SAV/" + ticketRec.id, {
            method: "PATCH",
            headers: airtableHeaders(),
            body: JSON.stringify({ fields: champsMaj }),
          });
        }
      } catch (e) {
        console.error("Maj complementaire du ticket echouee (non bloquant):", e);
      }
    }

    // Confirmation rédigée par le serveur d'après les faits réels : le client reçoit toujours la même information, exacte.
    const confirmation = "Votre demande est enregistrée. Numéro de ticket : " + numero + ". "
      + (rdvReserve ? "Rendez-vous : " + rdvReserve.texte + ". " : "Aucun rendez-vous n'est fixé pour l'instant : un conseiller de l'agence vous rappellera pour convenir d'une date. ")
      + (input.email ? "Un e-mail de confirmation vous est envoyé à " + input.email + ", et l'agence est prévenue. " : "L'agence est prévenue. ")
      + "Vous pouvez suivre votre demande à tout moment avec « Suivre mes demandes ».";
    return { ok: true, ticket: numero, creneau: rdvReserve ? rdvReserve.texte : "A convenir", confirmation: confirmation };
  }

  if (nom === "consulter_historique_ouvertures") {
    const vocabCourant = loadTradeVocab(tradeId || TRADE_ID);
    if (!vocabCourant.historique.disponible) return { trouve: false };
    const recherche = String(input.recherche || "").trim().slice(0, 100);
    if (!recherche) return { trouve: false };
    try {
      const formuleFicheBase = "OR(FIND(LOWER(\"" + recherche.replace(/"/g, '\\"') + "\"),LOWER({Client})),FIND(\"" + recherche.replace(/"/g, '\\"') + "\",{Téléphone}))";
      const formuleFiche = filtreAvecClientServeur(formuleFicheBase, clientId);
      const urlFiches = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent("Métrés") +
        "?filterByFormula=" + encodeURIComponent(formuleFiche) +
        "&sort[0][field]=Date&sort[0][direction]=desc&maxRecords=3";
      const rFiches = await fetch(urlFiches, { headers: airtableHeaders() });
      const jsonFiches = await rFiches.json();
      if (!rFiches.ok || !jsonFiches.records || jsonFiches.records.length === 0) {
        return { trouve: false };
      }

      const resultats = [];
      for (const fiche of jsonFiches.records) {
        const formuleOuv = "FIND(\"" + fiche.id + "\",ARRAYJOIN({Métré}))";
        const urlOuv = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent("Ouvertures Métré") +
          "?filterByFormula=" + encodeURIComponent(formuleOuv) + "&maxRecords=20";
        const rOuv = await fetch(urlOuv, { headers: airtableHeaders() });
        const jsonOuv = await rOuv.json();
        const ouvertures = (jsonOuv.records || []).map(function (o) {
          return {
            repere: o.fields["Repère"] || "",
            type: o.fields["Type"] || "",
            pose: o.fields["Pose"] || "",
            dimensions: (o.fields["Largeur mm"] || "?") + "x" + (o.fields["Hauteur mm"] || "?") + " mm",
            couleur: o.fields["Couleur / RAL"] || "",
          };
        });
        resultats.push({
          client: fiche.fields["Client"] || "",
          adresse: fiche.fields["Adresse"] || "",
          date_mesure: fiche.fields["Date"] || "",
          ouvertures: ouvertures,
        });
      }
      return { trouve: true, dossiers: resultats };
    } catch (e) {
      console.error("Erreur consulter_historique_ouvertures:", e);
      return { trouve: false };
    }
  }

  return { erreur: "Outil inconnu." };
  } catch (e) {
    console.error("Erreur execution outil " + nom + ":", e);
    return { erreur: "Une erreur technique est survenue." };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Methode non autorisee" });
  }

  if (limiterChat(req, res)) return;

const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    console.error("ANTHROPIC_API_KEY absente des variables d'environnement");
    return res.status(500).json({ error: "Configuration serveur incomplete" });
  }

try {
  await synchroniserAgences();
  const clientSlug = (req.body || {}).client_slug || null;
  const contexteClient = await resoudreClient(clientSlug);
  if (contexteClient && contexteClient.bloque) {
    return res.status(200).json({ reponse: "Ce service est temporairement suspendu. Merci de contacter votre interlocuteur pour régulariser la situation." });
  }
  const clientIdActuel = contexteClient ? contexteClient.id : null;
  const nomAssistantActuel = (contexteClient && contexteClient.nomAssistant) || NOMS_PAR_DEFAUT.amandine;
  const tradeIdActuel = (contexteClient && contexteClient.tradeId) || TRADE_ID;
  const vocabActuel = loadTradeVocab(tradeIdActuel);
  // Agences de ce client si configurees (table Agences), sinon repli sur le
  // reglage demo global (Planning/CONFIG, mode concepteur du dashboard).
  const agencesObjetsActuels = (contexteClient && contexteClient.agences) || AGENCES_VALIDES.map(function (n) { return { nom: n, emailAgence: "", emailTechnicien: "" }; });
  const agencesNomsActuels = agencesObjetsActuels.map(function (a) { return a.nom; });
  const questionnaireActuel = contexteClient ? contexteClient.questionnaire : null;
  const toolsActuels = buildTools(agencesNomsActuels, vocabActuel);
  const messages = (req.body || {}).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Aucun message recu" });
  }
  let messagesUtiles = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
  // Photos jointes par le client (adresses d'images déjà téléversées par le navigateur). Jamais fournies par le modèle.
  let ticketCreeActuel = null;
  let confirmationCreation = null;
  let propositionsDates = []; // dates annoncées par lister_creneaux dans cette requête (affichées en boutons côté client)
  let correctionFaite = false;
  const photosJointesActuelles = (Array.isArray((req.body || {}).photos) ? req.body.photos : [])
    .filter(function (u) { return typeof u === "string" && u.length < 400 && /^https:\/\/res\.cloudinary\.com\/|^http:\/\/localhost:\d+\/__iko-local\/fichier\//.test(u); })
    .slice(0, 5);
  if (photosJointesActuelles.length) {
    // Le modèle doit savoir que des photos sont déjà jointes (elles partiront avec le ticket) : il n'en redemande pas.
    messagesUtiles = messagesUtiles.map(function (m, i) {
      return i === messagesUtiles.length - 1 && m && m.role !== "assistant"
        ? Object.assign({}, m, { texte: String(m.texte || "") + " [Le client a joint " + photosJointesActuelles.length + " photo(s) : elles seront rattachées automatiquement au ticket, ne les redemande pas.]" }) : m;
    });
  }
  // Dernier message du client (deja dans req.body, aucun appel
  // supplementaire) : sert uniquement a prioriser la connaissance la plus
  // pertinente pour SA question dans le budget de contexte transmis.
  const dernierMessageClient = [...messagesUtiles].reverse().find(function (m) { return m && m.role !== "assistant" && m.texte; });
  const connaissanceActuelle = contexteClient
    ? affinerPourPrompt(contexteClient.connaissance, dernierMessageClient ? dernierMessageClient.texte : "")
    : null;

  const convertis = [];
  for (const m of messagesUtiles) {
    const texte = String(m && m.texte ? m.texte : "").slice(0, MAX_CHARS_MESSAGE);
    if (!texte.trim()) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    if (convertis.length === 0 && role !== "user") continue;
    convertis.push({ role: role, content: texte });
  }
  if (convertis.length === 0) {
    return res.status(400).json({ error: "Message vide" });
  }

  let dernierData = null;
  const BLOC_REUNION_AMANDINE = `

MODE REUNION D'EQUIPE (contexte special)
Tu es actuellement dans la salle de reunion virtuelle interne avec
Stephane, IKO, Max et Toise — PAS dans une conversation avec un
client. Dans ce contexte precis, oublie le deroule de creation de
ticket : tu n'es pas en train d'aider un client.

EXEMPLE OBLIGATOIRE A SUIVRE quand Stephane dit "bonjour" ou "bonjour a tous" :
- MAUVAIS (interdit) : "Bonjour ! Je suis ${nomAssistantActuel}, l'assistante SAV d'Iko Suite. Comment puis-je vous aider aujourd'hui ?"
- BON (a faire) : "Bonjour !"
C'est tout. Une seule fois "Bonjour !", rien d'autre. Tout le monde
sait deja qui tu es, ce n'est pas ta premiere reunion avec eux.

- Personnalite : professionnelle, chaleureuse, directe entre
  collegues. Tu peux tutoyer Stephane et les autres assistants ici
  (contrairement au vouvoiement avec les clients).
- MAXIMUM 2 phrases courtes, toujours. Jamais de formule d'accueil
  du type "je suis l'assistante SAV, je gere...", jamais d'explication
  de ton propre role.
- Si la question ne concerne pas ton domaine (comptage de tickets,
  planning technicien, mesures) : dis-le en une phrase et renvoie
  vers IKO ou Max, ne te lance jamais dans une explication.
- Ta mission en reunion : faire remonter a IKO les problemes de ton
  domaine que tu detectes ou que tu soupconnes : messages clients
  restes sans reponse, demandes urgentes mal traitees, delais
  anormaux, rendez-vous que des clients ont signale comme non
  honores. Sois precise et honnete, sans exagerer ni minimiser.
- Reponses orales, sans markdown ni emoji (lues a voix haute).`;

  for (let tour = 0; tour < MAX_TOOL_ROUNDS; tour++) {
    const reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELE,
        max_tokens: 800,
        temperature: 0.6,
        system: [{ type: "text", text: buildSystemPrompt(vocabActuel, agencesNomsActuels, questionnaireActuel, connaissanceActuelle, nomAssistantActuel) + (req.body.reunion ? BLOC_REUNION_AMANDINE : ""), cache_control: { type: "ephemeral" } }],
        tools: toolsActuels,
        messages: convertis,
      }),
    });

  if (!reponse.ok) {
    const detail = await reponse.text();
    console.error("Erreur API Anthropic:", reponse.status, detail);
    return res.status(502).json({ error: "Le service de conversation est momentanement indisponible." });
  }

  const data = await reponse.json();
    dernierData = data;
    const blocs = Array.isArray(data.content) ? data.content : [];
    const appelsOutils = blocs.filter(function(b) { return b.type === "tool_use"; });

  if (data.stop_reason !== "tool_use" || appelsOutils.length === 0) {
    const texte = blocs.filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text || ""; }).join("").trim();
    if (!texte) {
      console.error("Reponse Anthropic vide:", JSON.stringify(data).slice(0, 500));
      return res.status(200).json({
        reponse: "Desole, je n'ai pas pu formuler de reponse. Pouvez-vous reformuler votre question ?",
      });
    }
    // 1) Ticket créé pendant cette requête : la réponse est la confirmation exacte du serveur.
    if (ticketCreeActuel && confirmationCreation) {
      return res.status(200).json({ reponse: confirmationCreation, ticket_cree: ticketCreeActuel });
    }
    // 2) Garde-fou : l'assistante ne doit jamais confirmer une réservation / un ticket qui n'existe pas.
    const dejaUnTicket = convertis.some(function (c) { return c.role === "assistant" && typeof c.content === "string" && /SAV-\d{4}-\d{3,}/.test(c.content); });
    const annonceSucces = /(r[ée]serv[ée]e?|enregistr[ée]e?|confirm[ée]e?|bien not[ée]e?|ticket|num[ée]ro de (dossier|demande)|rendez-vous (est|a [ée]t[ée]|sera))/i.test(texte) && !/(souhaitez-vous|voulez-vous|pouvez-vous|quel|quelle|\?\s*$)/i.test(texte);
    if (!req.body.reunion && annonceSucces && !dejaUnTicket && !ticketCreeActuel) {
      if (!correctionFaite && tour < MAX_TOOL_ROUNDS - 1) {
        correctionFaite = true;
        convertis.push({ role: "assistant", content: texte });
        convertis.push({ role: "user", content: "[Consigne interne, ne pas citer au client] Tu viens d'annoncer une confirmation alors qu'AUCUN ticket n'a ete cree : rien n'est enregistre. Si tu as toutes les informations (agence, nom, telephone, e-mail, adresse, produit, probleme, garantie) et que le client a confirme le recapitulatif, appelle creer_ticket maintenant. Sinon, demande simplement l'information manquante, sans rien confirmer." });
        continue;
      }
      return res.status(200).json({ reponse: "Je n'ai pas encore enregistré votre demande. Pouvez-vous me confirmer vos coordonnées (nom, téléphone, e-mail, adresse) pour que je la crée ?" });
    }
    // Boutons de réponse rapide : oui/non si l'assistante demande une confirmation, sinon les dates qu'elle vient de citer.
    let suggestionsReponse = [];
    const bas = texte.toLowerCase();
    if (!ticketCreeActuel) {
      if (/(convient|je l'enregistre|je confirme|c'est bien ça|est-ce correct|d'accord)[^.?!]*?s*$/i.test(texte)) suggestionsReponse = ["Oui, c'est parfait", "Non, je veux modifier"];
      else {
        const citees = propositionsDates.filter(function (d) { return bas.indexOf(d.toLowerCase()) !== -1; });
        if (citees.length >= 2) suggestionsReponse = citees;
      }
    }
    return res.status(200).json({ reponse: texte, ...(suggestionsReponse.length ? { suggestions: suggestionsReponse } : {}), ...(ticketCreeActuel ? { ticket_cree: ticketCreeActuel } : {}) });
  }

  convertis.push({ role: "assistant", content: blocs });
    const resultats = [];
    for (const appel of appelsOutils) {
      const resultat = await executerOutil(appel.name, appel.input || {}, clientIdActuel, tradeIdActuel, agencesObjetsActuels, photosJointesActuelles, convertis.filter(function (c) { return c.role === "user" && typeof c.content === "string"; }).map(function (c) { return c.content; }).join(" | "));
      if (appel.name === "lister_creneaux" && resultat && Array.isArray(resultat.creneaux)) {
        propositionsDates = resultat.creneaux.filter(function (c) { return !c.horaires_disponibles; }).map(function (c) { return String(c.date_lisible || "").replace(/^./, function (x) { return x.toUpperCase(); }); }).filter(Boolean).slice(0, 5);
      }
      if (appel.name === "creer_ticket" && resultat && resultat.ok) { ticketCreeActuel = resultat.ticket; confirmationCreation = resultat.confirmation || null; }
      resultats.push({
        type: "tool_result",
        tool_use_id: appel.id,
        content: JSON.stringify(resultat),
      });
    }
    convertis.push({ role: "user", content: resultats });
  }

  console.error("Boucle d'outils non terminee:", JSON.stringify(dernierData).slice(0, 500));
  return res.status(200).json({
    reponse: "Desole, j'ai eu un souci pour finaliser votre demande. Un conseiller va reprendre la main, ou vous pouvez reessayer.",
  });
} catch (e) {
  console.error("Erreur chat-amandine:", e);
  return res.status(500).json({ error: "Une erreur est survenue. Merci de reessayer." });
}
}
