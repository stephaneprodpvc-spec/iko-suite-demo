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

import { verifierOrigine, verifierDebit } from "./_securite.js";

const MODELE = "claude-haiku-4-5-20251001";  // le plus economique, largement suffisant ici
const MAX_MESSAGES = 60; // garde-fou : longueur max d'une conversation
const MAX_CHARS_MESSAGE = 2000; // garde-fou : taille max d'un message
const MAX_TOOL_ROUNDS = 5; // garde-fou : nombre d'aller-retours d'outils par tour de conversation

const AIRTABLE_BASE = "app1AcRl9r6vB7W6e";
const MAKE_WEBHOOK = "https://hook.eu1.make.com/xczscdk40wh653mmnxnx7x63kawjcgx4";
const DELAI_MIN_JOURS = 7;

const AGENCES_VALIDES = ["Agence 1", "Agence 3", "Agence 2", "Agence 4"];

// La base Airtable garde les vrais noms d'agence en interne. Ce mapping
// traduit les labels generiques (Agence 1-4) vers les vraies valeurs
// stockees, pour que les requetes Airtable fonctionnent reellement.
const AGENCE_VERS_AIRTABLE = {
  "Agence 1": "Ibos (65)",
  "Agence 2": "Tarnos (40)",
  "Agence 3": "Lescar (64)",
  "Agence 4": "Saint-Gaudens (31)",
};

const CRENEAUX = {
    matin: "Matin (8h30 — 12h00)",
    apres_midi: "Après-midi (13h00 — 17h00)",
};

const SYSTEM_PROMPT = `
Tu es Amandine, l'assistante SAV en ligne d'Iko Suite, specialiste de la
menuiserie (fenetres, coulissants, volets roulants, portails, portes de
garage, verandas).

TON ROLE
Le client peut soit remplir le formulaire de demande SAV lui-meme, soit tout
faire en discutant avec toi. Si le client veut ouvrir un ticket SAV et/ou
prendre rendez-vous, tu peux reellement le faire toi-meme via tes outils
(lister_creneaux, reserver_creneau, creer_ticket) : tu n'es pas qu'une
conversation, tu agis pour de vrai, exactement comme s'il avait rempli le
formulaire.

TON STYLE
- Chaleureuse, directe, sans jargon inutile. Vouvoiement.
- Reponses courtes : 2 a 4 phrases maximum, sauf recapitulatif final.
- Une seule question a la fois, jamais un questionnaire.
- N'utilise JAMAIS d'emoji ni de pictogramme dans tes reponses (pas de main,
pas de coeur, pas de sourire, aucun symbole decoratif) : uniquement du texte
simple, car tes reponses sont aussi lues a voix haute.
- N'utilise JAMAIS de markdown dans tes reponses (pas d'asterisques, pas de
gras, pas d'italique, pas de #, pas de listes a puces) : le texte est affiche
brut, donc ecris uniquement du texte simple, y compris pour les numeros de
ticket (ex: SAV-2026-1234, jamais **SAV-2026-1234**).

DEROULE POUR OUVRIR UN TICKET / PRENDRE RDV
1. Comprendre le probleme (quel produit, quelle panne, depuis quand).
2. Demander l'agence du client parmi : Agence 1, Agence 2, Agence 3,
   Agence 4. Si le client donne juste sa ville, associe-la a
      l'agence la plus proche parmi ces 4-la.
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
                  renvoyees, puis appelle reserver_creneau une fois que le client a choisi.
                     Si le client prefere etre rappele pour convenir d'un horaire plutot que de
                        choisir maintenant, c'est possible : n'appelle alors pas reserver_creneau.
                        6. Une fois toutes les infos reunies, appelle creer_ticket. Donne ensuite au
                           client le numero de ticket EXACT retourne par l'outil (ne l'invente
                              jamais toi-meme) et confirme le rendez-vous s'il y en a un.

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

                                            QUELQUES PISTES DE DIAGNOSTIC DE BASE (a titre indicatif, jamais une garantie)
                                            - Poignee dure ou qui force : souvent un reglage de paumelle ou de galet.
                                            - Vitrage embue entre les vitres : signe probable de double vitrage HS.
                                            - Volet roulant qui ne repond plus : verifier l'alimentation avant tout.
                                            Sur un point de securite (serrure, vitrage), propose toujours une
                                            intervention technicien plutot qu'une manipulation par le client.
                                            `;

const TOOLS = [
  {
    name: "lister_creneaux",
    description: "Liste les creneaux de rendez-vous disponibles pour une agence et une periode donnees (au moins " + DELAI_MIN_JOURS + " jours a l'avance). Retourne jusqu'a 5 dates avec leur identifiant interne a reutiliser dans reserver_creneau.",
    input_schema: {
      type: "object",
      properties: {
        agence: { type: "string", enum: AGENCES_VALIDES, description: "Agence concernee." },
        periode: { type: "string", enum: ["matin", "apres_midi"], description: "Periode de la journee souhaitee." },
      },
      required: ["agence", "periode"],
    },
  },
  {
    name: "reserver_creneau",
    description: "Reserve definitivement un creneau (parmi ceux renvoyes par lister_creneaux) pour empecher qu'un autre client le prenne.",
    input_schema: {
      type: "object",
      properties: {
        planning_id: { type: "string", description: "Identifiant du creneau, tel que renvoye par lister_creneaux." },
      },
      required: ["planning_id"],
    },
  },
  {
    name: "creer_ticket",
    description: "Cree reellement le ticket SAV dans le systeme Iko Suite (meme mecanisme que le formulaire manuel) et notifie l'agence. A appeler une seule fois, quand toutes les informations necessaires ont ete recueillies.",
    input_schema: {
      type: "object",
      properties: {
        agence: { type: "string", enum: AGENCES_VALIDES },
        nom: { type: "string", description: "Nom complet du client." },
        telephone: { type: "string" },
        email: { type: "string" },
        adresse: { type: "string", description: "Adresse complete : rue, code postal, ville." },
        produit: { type: "string", description: "Ex : Fenetre, Coulissant, Volet roulant, Portail, Porte de garage, Veranda." },
        probleme: { type: "string", description: "Description du probleme rencontre." },
        urgent: { type: "boolean", description: "true si probleme de securite ou degat en cours." },
        garantie: { type: "string", enum: ["oui", "non", "inconnu"] },
        numero_facture: { type: "string", description: "Numero de facture si sous garantie, sinon vide." },
        creneau_texte: { type: "string", description: "Texte lisible du rendez-vous choisi, ou A convenir si aucun creneau n'a ete reserve." },
        planning_id: { type: "string", description: "Identifiant du creneau reserve via reserver_creneau, si applicable. Laisser vide sinon." },
      },
      required: ["agence", "nom", "telephone", "email", "adresse", "produit", "probleme", "urgent", "garantie", "creneau_texte"],
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

function airtableHeaders() {
  return {
    Authorization: "Bearer " + process.env.AIRTABLE_TOKEN,
    "Content-Type": "application/json",
  };
}

async function executerOutil(nom, input) {
  try {
    if (nom === "lister_creneaux") {
      const valeurCreneau = CRENEAUX[input.periode];
      if (!AGENCES_VALIDES.includes(input.agence) || !valeurCreneau) {
        return { erreur: "Agence ou periode invalide." };
      }
      const agenceAirtable = AGENCE_VERS_AIRTABLE[input.agence];
      const formule = "AND({Agence}=\"" + agenceAirtable + "\",{Créneau}=\"" + valeurCreneau + "\",{Statut}=\"Libre\")";
      const url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning?filterByFormula=" + encodeURIComponent(formule) + "&sort[0][field]=Date&sort[0][direction]=asc&maxRecords=60";
      const r = await fetch(url, { headers: airtableHeaders() });
      const json = await r.json();
      if (!r.ok) { console.error("Airtable lister_creneaux erreur:", r.status, JSON.stringify(json)); return { erreur: "Impossible de recuperer les creneaux.", detail: json }; }

    const auPlusTot = new Date();
      auPlusTot.setDate(auPlusTot.getDate() + DELAI_MIN_JOURS);
      const auPlusTotStr = auPlusTot.toISOString().split("T")[0];

    const map = {};
      (json.records || []).forEach(function(rec) {
        const d = rec.fields.Date;
        if (!d || d < auPlusTotStr) return;
        if (!map[d]) map[d] = { date: d, planning_id: rec.id };
      });
      const creneaux = Object.values(map).slice(0, 5).map(function(c) {
        const d = new Date(c.date + "T12:00:00");
        return {
          planning_id: c.planning_id,
          date_lisible: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
        };
      });
      return { creneaux: creneaux };
    }

  if (nom === "reserver_creneau") {
    const r = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Planning/" + encodeURIComponent(input.planning_id), {
      method: "PATCH",
      headers: airtableHeaders(),
      body: JSON.stringify({ fields: { Statut: "Pris" } }),
    });
    if (!r.ok) { const detail = await r.text().catch(function() { return ""; }); console.error("Airtable reserver_creneau erreur:", r.status, detail); return { erreur: "Ce creneau n'est plus disponible, merci d'en choisir un autre." }; }
    return { ok: true };
  }

  if (nom === "creer_ticket") {
    if (!AGENCES_VALIDES.includes(input.agence)) {
      return { erreur: "Agence invalide." };
    }
    const numero = "SAV-" + new Date().getFullYear() + "-" + (Math.floor(Math.random() * 9000) + 1000);
    const garantieTexte = input.garantie === "oui" ? "Oui - Facture " + (input.numero_facture || "") : input.garantie === "non" ? "Non / Hors garantie" : "N/A";

    const payload = {
      marque: "iko",
      ticket: numero,
      agence: AGENCE_VERS_AIRTABLE[input.agence] || input.agence,
      nom: input.nom,
      tel: input.telephone,
      "e-mail": input.email,
      adresse: input.adresse,
      produit: input.produit,
      probleme: input.probleme,
      creneau: input.creneau_texte || "",
      garantie: garantieTexte,
      facture: input.numero_facture || "",
      urgent: input.urgent ? "Oui" : "Non",
      photos: "",
      facture_photo: "",
      planningId: input.planning_id || "",
      source: "Amandine (IA)",
    };

    const r = await fetch(MAKE_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { erreur: "La creation du ticket a echoue, merci de reessayer." };
    return { ok: true, ticket: numero };
  }

  if (nom === "consulter_historique_ouvertures") {
    const recherche = String(input.recherche || "").trim().slice(0, 100);
    if (!recherche) return { trouve: false };
    try {
      const formuleFiche = "OR(FIND(LOWER(\"" + recherche.replace(/"/g, '\\"') + "\"),LOWER({Client})),FIND(\"" + recherche.replace(/"/g, '\\"') + "\",{Téléphone}))";
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

  if (!verifierOrigine(req)) {
    return res.status(403).json({ error: "Origine non autorisée." });
  }
  if (!verifierDebit(req)) {
    return res.status(429).json({ error: "Trop de requêtes, réessayez dans une minute." });
  }

const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) {
    console.error("ANTHROPIC_API_KEY absente des variables d'environnement");
    return res.status(500).json({ error: "Configuration serveur incomplete" });
  }

try {
  const messages = (req.body || {}).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Aucun message recu" });
  }
  const messagesUtiles = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;

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
- Personnalite : professionnelle, chaleureuse, directe entre
  collegues. Tu peux tutoyer Stephane et les autres assistants ici
  (contrairement au vouvoiement avec les clients).
- MAXIMUM 2 phrases courtes, toujours. Pas de formule d'accueil du
  type "je suis l'assistante SAV, je gere...", pas d'explication de
  ton propre role : tout le monde en reunion sait deja qui tu es.
- Ne te presente JAMAIS ("Je suis Amandine, l'assistante SAV
  d'Iko Suite...") : ce reflexe vient de tes conversations normales
  avec les clients, il n'a aucune place ici. Stephane et les 3 autres
  assistants te connaissent deja.
- Si Stephane te salue ("bonjour", "bonjour a tous"...), reponds par
  un simple "Bonjour !" ou une variante tres courte d'une phrase, sans
  rien ajouter d'autre — pas de "comment puis-je vous aider" ni de
  question de suivi.
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
        system: SYSTEM_PROMPT + (req.body.reunion ? BLOC_REUNION_AMANDINE : ""),
        tools: TOOLS,
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
    return res.status(200).json({ reponse: texte });
  }

  convertis.push({ role: "assistant", content: blocs });
    const resultats = [];
    for (const appel of appelsOutils) {
      const resultat = await executerOutil(appel.name, appel.input || {});
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
