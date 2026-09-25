// analytics-sav.js
// Extraction pure des calculs d'analytics SAV de dashboard.html
// (calculerAnalyticsSAV, calculerPerformanceEtResolution,
// calculerAgregatsPredictifs, detecterAlertesSAV et leurs dépendances
// directes) — module ES (export/import) à la RACINE du repo, pas dans
// api/, volontairement : les fichiers api/_*.js (comme _connaissance.js,
// _securite.js) ne sont accessibles qu'au serveur (convention Vercel :
// tout fichier préfixé "_" sous api/ n'est jamais exposé comme route HTTP
// — dashboard.html est une page statique, sans chargeur de module, elle
// ne peut donc pas les importer). Ce repo a déjà une convention pour du JS
// partagé accessible au NAVIGATEUR : un fichier .js à la racine, servi tel
// quel par Vercel comme n'importe quel .html du repo (voir stef-widget.js,
// chargé via <script type="module" src="stef-widget.js">). Un module ES
// standard fonctionne nativement dans les deux runtimes sans aucune
// transpilation supplémentaire :
// - Navigateur (dashboard.html) : <script type="module"> import ... from
//   "/analytics-sav.js" — chargé une fois au démarrage de la page, aucun
//   nouvel appel réseau à l'usage (les fonctions sont déjà en mémoire
//   quand un panneau Analytics s'ouvre).
// - Serveur (futurs assistants) : import ... from "../analytics-sav.js"
//   depuis un fichier api/*.js — Node ESM résout un chemin relatif
//   indépendamment de la convention de routage Vercel, qui ne s'applique
//   qu'aux fichiers PHYSIQUEMENT situés sous api/.

// Pour d'autres assistants IKO à l'avenir (Amandine, Max, Stef — non
// branchés dans cette mission), sans dupliquer la logique.
//
// PUR : aucune requête réseau, aucune dépendance UI/DOM/React. Toutes les
// fonctions ci-dessous prennent des données déjà chargées par l'appelant
// (tableaux de tickets/interventions Airtable bruts) et renvoient des
// objets de résultats — jamais l'inverse. Le chargement réseau
// (chargerInterventionsSAV, qui fait un fetch) reste volontairement dans
// dashboard.html : ce n'est pas un calcul, c'est un accès réseau, hors du
// périmètre "pur" de ce module.
//
// ISOLATION TENANT : ce module ne résout, ne filtre et ne connaît AUCUN
// identifiant de tenant — il calcule uniquement sur les tableaux qui lui
// sont passés. L'isolation est donc entièrement garantie par l'appelant
// (dashboard.html ne charge déjà que les tickets/interventions de son
// propre tenant, via la route "/api/airtable/tenant/..." et le JWT/session
// existant) : ce module ne peut ni renforcer ni affaiblir cette isolation,
// il ne fait que transformer les données qu'on lui donne.

// ---- Dépendance : analyse d'une date de créneau ----
// Copie intentionnelle (pas un import) de la fonction du même nom définie
// dans dashboard.html : celle-ci y est utilisée pour de nombreux usages
// hors analytics (tri de listes de tickets dans l'UI, etc.), hors du
// périmètre de cette extraction — la dupliquer ici évite de toucher à ces
// usages non liés à la mission (voir rapport de mission : dashboard.html
// est une page statique sans chargeur de module, elle ne peut de toute
// façon pas importer ce fichier — voir section 4 du rapport). Les deux
// copies doivent être maintenues identiques si ce format de date évolue.
const MOIS = { janvier: 1, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12 };

// Retire les accents et met en minuscule, pour comparer deux textes sans
// tenir compte de la casse/des accents (utilisé par
// genererRecommandationsSAV pour le rapprochement textuel avec la
// Connaissance entreprise). Copie volontaire du même utilitaire présent
// dans _connaissance.js : trivial (4 lignes), pas d'import croisé entre
// modules pour ça, chaque module reste autonome.
function normaliserTexte(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim();
}
function parseDateCreneau(creneau) {
  if (!creneau) return new Date(9999, 0, 1);
  const match = creneau.match(/(\d+)\s+(\p{L}+)(?:\s+(\d{4}))?/gu);
  if (!match) return new Date(9999, 0, 1);
  const last = match[match.length - 1];
  const parts = last.match(/(\d+)\s+(\p{L}+)(?:\s+(\d{4}))?/u);
  if (!parts) return new Date(9999, 0, 1);
  const day = parseInt(parts[1]);
  const month = MOIS[parts[2].toLowerCase()] || 1;
  const year = parts[3] ? parseInt(parts[3]) : new Date().getFullYear();
  return new Date(year, month - 1, day);
}

// ---- Calcul pur des indicateurs Analytics SAV, source unique de vérité
// pour le panneau Analytics (ModalAnalyticsSAV) et le Tableau de bord
// dirigeant (ModalTableauBordDirigeant) : mêmes chiffres partout. Aucun
// appel réseau, uniquement calculé à partir des tickets déjà chargés.
export function calculerAnalyticsSAV(tickets) {
  const parProduit = {};
  const parAgence = {};
  const parStatut = {};
  const parCause = {};
  const coutParProduit = {};
  const coutParAgence = {};
  // Détail "Produits générant le plus de SAV" (clients/causes distincts) :
  // Sets indexés par produit, alimentés dans la même boucle que parProduit
  // pour ne rien recalculer en plus (aucun nouvel appel réseau, aucune
  // boucle supplémentaire sur tickets).
  const clientsParProduit = {};
  const causesParProduit = {};
  let nbUrgents = 0;
  let coutSAVGlobal = 0;
  tickets.forEach(t => {
    const produit = (t.fields?.Produit || "").trim();
    if (produit) {
      parProduit[produit] = (parProduit[produit] || 0) + 1;
      const clientNom = (t.fields?.Client || "").trim();
      if (clientNom) {
        if (!clientsParProduit[produit]) clientsParProduit[produit] = new Set();
        clientsParProduit[produit].add(clientNom);
      }
      const causeProduit = t.fields?.["Cause SAV"];
      if (causeProduit) {
        if (!causesParProduit[produit]) causesParProduit[produit] = new Set();
        causesParProduit[produit].add(causeProduit);
      }
    }
    const agence = (t.fields?.Agence || "").trim();
    if (agence) parAgence[agence] = (parAgence[agence] || 0) + 1;
    const statut = t.fields?.Statut || "Nouveau";
    parStatut[statut] = (parStatut[statut] || 0) + 1;
    if (t.fields?.Qualification === "Oui") nbUrgents += 1;
    const cause = t.fields?.["Cause SAV"];
    if (cause) parCause[cause] = (parCause[cause] || 0) + 1;
    // Coût SAV Réel : rollup Airtable (somme des interventions liées à ce
    // ticket), déjà présent dans t.fields sans appel supplémentaire — 0/
    // absent tant qu'aucune intervention n'a de coût saisi (honnête, pas
    // une absence de données à combler).
    const cout = Number(t.fields?.["Coût SAV Réel"]) || 0;
    if (cout > 0) {
      coutSAVGlobal += cout;
      if (produit) coutParProduit[produit] = (coutParProduit[produit] || 0) + cout;
      if (agence) coutParAgence[agence] = (coutParAgence[agence] || 0) + cout;
    }
  });

  const topProduits = Object.entries(parProduit).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const totalAvecAgence = Object.values(parAgence).reduce((s, n) => s + n, 0);
  const repartitionAgences = Object.entries(parAgence).sort((a, b) => b[1] - a[1]);
  const repartitionStatuts = Object.entries(parStatut).sort((a, b) => b[1] - a[1]);
  const tauxUrgents = tickets.length ? Math.round(nbUrgents / tickets.length * 100) : 0;
  // Top causes SAV : uniquement sur les tickets où Cause SAV a été
  // renseignée (champ facultatif, saisi manuellement) — pas de "Non
  // renseigné" comptabilisé comme une cause.
  const topCauses = Object.entries(parCause).sort((a, b) => b[1] - a[1]);
  const coutSAVParProduit = Object.entries(coutParProduit).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const coutSAVParAgence = Object.entries(coutParAgence).sort((a, b) => b[1] - a[1]);

  // Tendance mensuelle : basée sur le champ Créneau réel (parseDateCreneau
  // ci-dessus). Regroupement AAAA-MM sur les 6 derniers mois calendaires
  // uniquement (pas d'extrapolation au-delà de ce que les tickets réels
  // couvrent).
  const maintenant = new Date();
  const moisLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    moisLabels.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const parMois = {};
  tickets.forEach(t => {
    const d = parseDateCreneau(t.fields?.Créneau);
    if (!d || d.getFullYear() === 9999) return;
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    parMois[key] = (parMois[key] || 0) + 1;
  });
  const tendance = moisLabels.map(m => ({ label: m.label, valeur: parMois[m.key] || 0 }));
  const maxTendance = Math.max(1, ...tendance.map(m => m.valeur));

  // Estimation simple du mois suivant : moyenne des 3 derniers mois réels.
  // Déterministe, sans IA, clairement présentée comme une estimation de
  // tendance et non une prédiction causale (aucune cause n'est inventée).
  const derniers3 = tendance.slice(-3).map(m => m.valeur);
  const estimationMoisSuivant = derniers3.length ? Math.round(derniers3.reduce((s, v) => s + v, 0) / derniers3.length) : null;

  // ---- Socle prédictif (1/3) : "produits à risque" par tendance de volume.
  // Signal purement statistique et déterministe (aucune IA, aucune cause
  // inventée) : compare, pour chaque produit du top, le nombre de tickets
  // sur les 3 derniers mois vs les 3 mois précédents (fenêtre des 6 mois
  // déjà calculée ci-dessus).
  const parProduitParMois = {};
  tickets.forEach(t => {
    const produit = (t.fields?.Produit || "").trim();
    if (!produit) return;
    const d = parseDateCreneau(t.fields?.Créneau);
    if (!d || d.getFullYear() === 9999) return;
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    if (!parProduitParMois[produit]) parProduitParMois[produit] = {};
    parProduitParMois[produit][key] = (parProduitParMois[produit][key] || 0) + 1;
  });
  const clesMois = moisLabels.map(m => m.key);
  const clesRecentes = clesMois.slice(-3);
  const clesPrecedentes = clesMois.slice(0, 3);
  const produitsRisque = topProduits.slice(0, 5).map(([produit, total]) => {
    const parMoisProduit = parProduitParMois[produit] || {};
    const recent = clesRecentes.reduce((s, k) => s + (parMoisProduit[k] || 0), 0);
    const precedent = clesPrecedentes.reduce((s, k) => s + (parMoisProduit[k] || 0), 0);
    const tendanceProduit = recent > precedent ? "hausse" : recent < precedent ? "baisse" : "stable";
    return { produit, total, recent, precedent, tendanceProduit };
  });

  // Détail table "Produits générant le plus de SAV" : tickets/clients/
  // causes distincts + tendance, réutilisée sans invention — évolution
  // affichée seulement si assez de tickets datés fiables sur la fenêtre 6
  // mois (seuil bas pour éviter un "hausse/baisse" trompeur sur 1-2
  // tickets), sinon non affichée plutôt qu'estimée. Try/catch : protège
  // contre un cas de champ inattendu sans faire planter tout l'appelant.
  let topProduitsDetail = [];
  let erreurTopProduitsDetail = "";
  try {
    topProduitsDetail = topProduits.map(([produit, total]) => {
      const nbClients = clientsParProduit[produit] ? clientsParProduit[produit].size : 0;
      const nbCauses = causesParProduit[produit] ? causesParProduit[produit].size : 0;
      const parMoisProduit = parProduitParMois[produit] || {};
      const recent = clesRecentes.reduce((s, k) => s + (parMoisProduit[k] || 0), 0);
      const precedent = clesPrecedentes.reduce((s, k) => s + (parMoisProduit[k] || 0), 0);
      const evolution = (recent + precedent) >= 3 ? (recent > precedent ? "hausse" : recent < precedent ? "baisse" : "stable") : null;
      return { produit, total, nbClients, nbCauses, evolution };
    });
  } catch (e) {
    erreurTopProduitsDetail = "Erreur de calcul — section indisponible pour l'instant.";
  }

  return { topProduits, topProduitsDetail, erreurTopProduitsDetail, totalAvecAgence, repartitionAgences, repartitionStatuts, tauxUrgents, nbUrgents, tendance, maxTendance, estimationMoisSuivant, produitsRisque, topCauses, coutSAVGlobal, coutSAVParProduit, coutSAVParAgence };
}

// ---- Taux de résolution au premier passage + performance techniciens.
// Contrairement au reste de calculerAnalyticsSAV, ces indicateurs ne sont
// PAS lisibles depuis les rollups au niveau ticket (ceux-ci donnent un
// total/compte, pas le détail par passage ni par technicien) — nécessite
// les enregistrements bruts de la table Interventions SAV, chargés à la
// demande par l'appelant (voir chargerInterventionsSAV dans
// dashboard.html, hors de ce module puisque ce n'est pas un calcul mais un
// accès réseau).
export function calculerPerformanceEtResolution(interventions, tickets) {
  const parTicket = {};
  interventions.forEach(iv => {
    const ticketId = Array.isArray(iv.fields?.["Ticket SAV"]) ? iv.fields["Ticket SAV"][0] : null;
    if (!ticketId) return;
    if (!parTicket[ticketId]) parTicket[ticketId] = [];
    parTicket[ticketId].push(iv);
  });
  // Définition retenue, explicite : un ticket compte comme "résolu au
  // premier passage" s'il n'a QU'UNE SEULE intervention enregistrée et
  // que celle-ci a le statut "Résolu". Un ticket avec 2+ interventions
  // n'est jamais compté, même si la dernière est résolue.
  const ticketsAvecIntervention = Object.keys(parTicket);
  let ticketsResolusPremierPassage = 0;
  ticketsAvecIntervention.forEach(id => {
    const ivs = parTicket[id];
    if (ivs.length === 1 && ivs[0].fields?.["Statut intervention"] === "Résolu") {
      ticketsResolusPremierPassage += 1;
    }
  });
  const nbTicketsAvecIntervention = ticketsAvecIntervention.length;
  // "Nécessitant un retour" = complément exact de la définition ci-dessus
  // (2+ interventions, OU 1 seule intervention non "Résolu") — pas une
  // notion distincte inventée à côté.
  const ticketsNecessitantRetour = nbTicketsAvecIntervention - ticketsResolusPremierPassage;
  const tauxResolutionPremierPassage = nbTicketsAvecIntervention
    ? Math.round(ticketsResolusPremierPassage / nbTicketsAvecIntervention * 100)
    : null; // null = non calculable, aucune intervention enregistrée

  // Détail par agence : réutilise les tickets déjà chargés (aucun nouvel
  // appel réseau) pour retrouver l'agence de chaque ticket ayant une
  // intervention. Un ticket dont l'id n'est plus dans les tickets
  // actuellement chargés, ou sans Agence renseignée, est simplement exclu
  // du détail par agence (jamais rattaché à une agence inventée) — il
  // reste comptabilisé dans le taux global ci-dessus.
  const agenceParTicket = {};
  (tickets || []).forEach(t => {
    const agence = (t.fields?.Agence || "").trim();
    if (agence) agenceParTicket[t.id] = agence;
  });
  const parAgenceStats = {};
  ticketsAvecIntervention.forEach(id => {
    const agence = agenceParTicket[id];
    if (!agence) return;
    if (!parAgenceStats[agence]) parAgenceStats[agence] = { total: 0, resolus: 0 };
    parAgenceStats[agence].total += 1;
    const ivs = parTicket[id];
    if (ivs.length === 1 && ivs[0].fields?.["Statut intervention"] === "Résolu") {
      parAgenceStats[agence].resolus += 1;
    }
  });
  const resolutionParAgence = Object.entries(parAgenceStats)
    .map(([agence, s]) => ({ agence, total: s.total, resolus: s.resolus, taux: Math.round(s.resolus / s.total * 100) }))
    .sort((a, b) => b.total - a.total);

  const parTechnicien = {};
  interventions.forEach(iv => {
    const idTech = Array.isArray(iv.fields?.["Technicien"]) ? iv.fields["Technicien"][0] : null;
    if (!idTech) return; // intervention sans technicien lié (ex. créée par SUPER_ADMIN_IKO en test) : exclue du classement, pas inventée
    const nom = iv.fields?.["_technicienIdentifiant"] || idTech;
    if (!parTechnicien[idTech]) parTechnicien[idTech] = { nom, total: 0, resolus: 0, cout: 0 };
    parTechnicien[idTech].total += 1;
    if (iv.fields?.["Statut intervention"] === "Résolu") parTechnicien[idTech].resolus += 1;
    parTechnicien[idTech].cout += Number(iv.fields?.["Coût total intervention"]) || 0;
  });
  const performanceTechniciens = Object.values(parTechnicien)
    .map(p => ({ ...p, tauxResolution: p.total ? Math.round(p.resolus / p.total * 100) : 0 }))
    .sort((a, b) => b.total - a.total);

  return { tauxResolutionPremierPassage, ticketsResolusPremierPassage, ticketsNecessitantRetour, nbTicketsAvecIntervention, resolutionParAgence, performanceTechniciens, totalInterventions: interventions.length };
}

// ---- Agrégats prêts pour de futures fonctionnalités (évolution des coûts
// SAV, estimation de durée d'intervention) — calculés à partir des VRAIES
// interventions déjà enregistrées, mais qui resteront vides/nulles tant
// que peu ou pas de données réelles n'existent. Rien n'est estimé ni
// inventé ici : une valeur nulle ou un tableau vide signifie honnêtement
// "pas encore assez de données", jamais une approximation.
export function calculerAgregatsPredictifs(interventions) {
  const maintenant = new Date();
  const moisLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    moisLabels.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const coutParMois = {};
  const durees = [];
  interventions.forEach(iv => {
    const dateStr = iv.fields?.["Date intervention"];
    if (dateStr) {
      const d = new Date(dateStr + "T12:00:00");
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      const cout = Number(iv.fields?.["Coût total intervention"]) || 0;
      coutParMois[key] = (coutParMois[key] || 0) + cout;
    }
    const duree = Number(iv.fields?.["Durée (min)"]);
    if (duree > 0) durees.push(duree);
  });
  const evolutionCoutSAVMensuel = moisLabels.map(m => ({ label: m.label, valeur: coutParMois[m.key] || 0 }));
  const dureeMoyenneMin = durees.length ? Math.round(durees.reduce((s, v) => s + v, 0) / durees.length) : null;

  return { evolutionCoutSAVMensuel, dureeMoyenneMin, nbEchantillonsDuree: durees.length };
}

// ---- Alertes SAV : détection purement déterministe à partir des
// agrégats déjà calculés ci-dessus. Aucune IA, aucune prédiction, aucun
// appel réseau, aucun seuil inventé au hasard :
// - Taux urgent élevé : seuil déjà en place ailleurs dans le dashboard
//   (tauxUrgents>20, cf. carte "Taux de tickets urgents").
// - Évolution récente : réutilise topProduitsDetail.evolution déjà calculé
//   (seuil >=3 tickets datés sur la fenêtre 6 mois, déjà en place).
// - Cause / produit / agence "anormalement élevé(e)" : détection
//   statistique explicite (moyenne + 1 écart-type de la distribution
//   concernée) — méthode standard, pas un pourcentage choisi au hasard.
//   Nécessite au moins 3 éléments distincts pour être significative,
//   sinon l'alerte correspondante est simplement absente (pas de faux
//   positif sur un jeu de données trop petit).
export function ecartTypeMoyenne(valeurs) {
  const moyenne = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
  const variance = valeurs.reduce((s, v) => s + (v - moyenne) ** 2, 0) / valeurs.length;
  return { moyenne, ecartType: Math.sqrt(variance) };
}

export function detecterAlertesSAV({ tauxUrgents, topCauses, topProduitsDetail, resolutionParAgence }) {
  const alertes = [];

  if (tauxUrgents > 20) {
    alertes.push({ type: "urgent", texte: `Taux de tickets urgents élevé : ${tauxUrgents}%.` });
  }

  if (topCauses.length >= 3) {
    const { moyenne, ecartType } = ecartTypeMoyenne(topCauses.map(([, n]) => n));
    const [causeTop, nTop] = topCauses[0];
    if (ecartType > 0 && nTop > moyenne + ecartType) {
      alertes.push({ type: "cause", texte: `Cause SAV en forte récurrence : "${causeTop}" (${nTop} tickets, nettement au-dessus de la moyenne des causes).` });
    }
  }

  if (topProduitsDetail.length >= 3) {
    const { moyenne, ecartType } = ecartTypeMoyenne(topProduitsDetail.map(p => p.total));
    const top = topProduitsDetail[0];
    if (ecartType > 0 && top.total > moyenne + ecartType) {
      alertes.push({ type: "produit", texte: `Volume SAV anormalement élevé sur "${top.produit}" (${top.total} tickets, nettement au-dessus de la moyenne des produits).` });
    }
  }

  if (resolutionParAgence && resolutionParAgence.length >= 3) {
    const tauxRetourParAgence = resolutionParAgence.map(a => ({ agence: a.agence, tauxRetour: 100 - a.taux }));
    const { moyenne, ecartType } = ecartTypeMoyenne(tauxRetourParAgence.map(a => a.tauxRetour));
    const pire = [...tauxRetourParAgence].sort((a, b) => b.tauxRetour - a.tauxRetour)[0];
    if (ecartType > 0 && pire.tauxRetour > moyenne + ecartType) {
      alertes.push({ type: "agence", texte: `Taux de retour élevé pour l'agence ${pire.agence} (${pire.tauxRetour}%, nettement au-dessus de la moyenne des agences).` });
    }
  }

  topProduitsDetail.forEach(p => {
    if (p.evolution === "hausse") {
      alertes.push({ type: "evolution", texte: `Évolution en hausse récente pour "${p.produit}".` });
    }
  });

  return alertes;
}

// ---- Détection prédictive SAV V1 : "Signaux prédictifs SAV" du dashboard
// IKO. Réutilise EXACTEMENT les mêmes agrégats déjà calculés ci-dessus
// (topCauses, topProduitsDetail, resolutionParAgence, performanceTechniciens,
// tauxUrgents) — aucun nouveau calcul de fond, aucun nouvel appel Airtable,
// fonction séparée de detecterAlertesSAV pour ne jamais modifier son
// comportement existant (déjà affiché tel quel dans ModalAnalyticsSAV).
//
// Comme detecterAlertesSAV : purement statistique et déterministe (moyenne +
// écart-type), aucune IA, aucune cause inventée. Ajoute par rapport à
// detecterAlertesSAV :
// - un niveau de signal explicite (faible/moyen/fort), selon la distance à
//   la moyenne en écarts-types — jamais un pourcentage choisi au hasard ;
// - une distinction explicite donnée observée (faits bruts) / signal
//   (l'écart statistique) / hypothèse (une piste prudente, jamais présentée
//   comme acquise) / action de vérification recommandée ;
// - un signal "technicien" (symétrique du signal "agence" déjà existant,
//   même logique de taux de retour anormal) ;
// - un signal "faible" dédié à une évolution récente en hausse (réutilise
//   topProduitsDetail.evolution déjà calculé), pour repérer un problème qui
//   COMMENCE à devenir récurrent avant qu'il ne franchisse un seuil fort.
//
// Garde-fous anti faux-positif (mêmes seuils minimums que detecterAlertesSAV,
// plus stricts sur le niveau "faible") :
// - toujours >= 3 éléments distincts (causes/produits/agences/techniciens)
//   avant tout calcul d'écart-type — sinon aucun signal de ce type, jamais
//   un signal forcé sur un échantillon trop petit ;
// - un plancher de volume absolu (>= 2 tickets) en plus de l'écart-type,
//   pour ignorer un écart statistiquement "significatif" mais construit sur
//   1 seul ticket ;
// - un technicien/agence n'entre dans le calcul que s'il a un volume minimal
//   (>= 3 interventions) pour que son taux ne soit pas dominé par 1 ou 2 cas.
function niveauSignalDepuisEcart(valeur, moyenne, ecartType) {
  if (!(ecartType > 0)) return null;
  const z = (valeur - moyenne) / ecartType;
  if (z > 2) return "fort";
  if (z > 1) return "moyen";
  if (z > 0.5) return "faible";
  return null;
}

export function genererSignauxPredictifsSAV({ tauxUrgents, topCauses, topProduitsDetail, resolutionParAgence, performanceTechniciens }) {
  const signaux = [];

  // ---- Cause SAV en récurrence anormale ----
  if (topCauses && topCauses.length >= 3) {
    const { moyenne, ecartType } = ecartTypeMoyenne(topCauses.map(([, n]) => n));
    const [causeTop, nTop] = topCauses[0];
    const niveau = nTop >= 2 ? niveauSignalDepuisEcart(nTop, moyenne, ecartType) : null;
    if (niveau) {
      signaux.push({
        type: "cause",
        probleme: `Cause SAV en récurrence anormale : "${causeTop}".`,
        donneeObservee: `${nTop} tickets portent cette cause, contre une moyenne de ${moyenne.toFixed(1)} tickets par cause sur les causes renseignées.`,
        produit: null, agence: null, technicien: null,
        niveau,
        hypothese: "Cela peut indiquer un problème récurrent lié à cette cause (produit, fournisseur, pose) — pas encore confirmé.",
        action: "Vérifier les tickets récents portant cette cause pour un point commun (produit, lot, fournisseur, pose).",
      });
    }
  }

  // ---- Produit générant plusieurs SAV similaires ----
  if (topProduitsDetail && topProduitsDetail.length >= 3) {
    const { moyenne, ecartType } = ecartTypeMoyenne(topProduitsDetail.map(p => p.total));
    const top = topProduitsDetail[0];
    const niveau = top.total >= 2 ? niveauSignalDepuisEcart(top.total, moyenne, ecartType) : null;
    if (niveau) {
      signaux.push({
        type: "produit",
        probleme: `Volume SAV anormalement élevé sur le produit "${top.produit}".`,
        donneeObservee: `${top.total} tickets sur ce produit (${top.nbClients} client(s) distinct(s), ${top.nbCauses} cause(s) distincte(s)), contre une moyenne de ${moyenne.toFixed(1)} tickets par produit.`,
        produit: top.produit, agence: null, technicien: null,
        niveau,
        hypothese: "Cela peut indiquer un défaut récurrent sur ce produit (référence, lot, pose) — à confirmer sur le terrain.",
        action: "Vérifier si les tickets de ce produit partagent une cause, un lot ou une période de pose commune.",
      });
    }
  }

  // ---- Agence avec taux de retour anormal ----
  if (resolutionParAgence && resolutionParAgence.length >= 3) {
    const tauxRetourParAgence = resolutionParAgence.map(a => ({ agence: a.agence, total: a.total, tauxRetour: 100 - a.taux }));
    const { moyenne, ecartType } = ecartTypeMoyenne(tauxRetourParAgence.map(a => a.tauxRetour));
    const pire = [...tauxRetourParAgence].sort((a, b) => b.tauxRetour - a.tauxRetour)[0];
    const niveau = pire.total >= 3 ? niveauSignalDepuisEcart(pire.tauxRetour, moyenne, ecartType) : null;
    if (niveau) {
      signaux.push({
        type: "agence",
        probleme: `Taux de retour anormal pour l'agence ${pire.agence}.`,
        donneeObservee: `${pire.tauxRetour}% des tickets avec intervention de cette agence nécessitent un retour, contre une moyenne de ${moyenne.toFixed(1)}% entre agences (sur ${pire.total} tickets avec intervention).`,
        produit: null, agence: pire.agence, technicien: null,
        niveau,
        hypothese: "Cela peut indiquer une difficulté de suivi ou de diagnostic au premier passage dans cette agence — à vérifier avec l'équipe.",
        action: "Passer en revue avec l'agence les tickets nécessitant un retour pour identifier un point commun.",
      });
    }
  }

  // ---- Technicien avec taux de retour anormal (symétrique du signal agence) ----
  if (performanceTechniciens && performanceTechniciens.length >= 3) {
    const eligibles = performanceTechniciens.filter(t => t.total >= 3);
    if (eligibles.length >= 3) {
      const tauxRetourParTech = eligibles.map(t => ({ nom: t.nom, total: t.total, tauxRetour: 100 - t.tauxResolution }));
      const { moyenne, ecartType } = ecartTypeMoyenne(tauxRetourParTech.map(t => t.tauxRetour));
      const pire = [...tauxRetourParTech].sort((a, b) => b.tauxRetour - a.tauxRetour)[0];
      const niveau = niveauSignalDepuisEcart(pire.tauxRetour, moyenne, ecartType);
      if (niveau) {
        signaux.push({
          type: "technicien",
          probleme: `Taux de retour anormal pour un technicien (${pire.nom}).`,
          donneeObservee: `${pire.tauxRetour}% des interventions de ce technicien nécessitent un retour, contre une moyenne de ${moyenne.toFixed(1)}% entre techniciens (sur ${pire.total} interventions).`,
          produit: null, agence: null, technicien: pire.nom,
          niveau,
          hypothese: "Cela peut indiquer un besoin d'accompagnement sur un type d'intervention précis — pas une évaluation de compétence générale.",
          action: "Vérifier avec ce technicien les cas nécessitant un retour (type d'intervention, outillage, besoin de formation).",
        });
      }
    }
  }

  // ---- Taux de tickets urgents élevé (même seuil que detecterAlertesSAV,
  // avec un niveau selon l'ampleur du dépassement) ----
  if (tauxUrgents > 20) {
    signaux.push({
      type: "urgence",
      probleme: "Taux de tickets urgents élevé.",
      donneeObservee: `${tauxUrgents}% des tickets actuels sont qualifiés urgents (seuil de vigilance : 20%).`,
      produit: null, agence: null, technicien: null,
      niveau: tauxUrgents > 40 ? "fort" : tauxUrgents > 28 ? "moyen" : "faible",
      hypothese: "Cela peut indiquer une dégradation ponctuelle ou un problème émergent commun à plusieurs tickets urgents — à confirmer.",
      action: "Vérifier si les tickets urgents récents partagent une cause commune avant qu'elle ne se généralise.",
    });
  }

  // ---- Signal faible : évolution récente en hausse sur un produit ----
  // Réutilise topProduitsDetail.evolution déjà calculé (fenêtre 3 mois vs 3
  // mois précédents, seuil >=3 tickets datés déjà appliqué en amont) : un
  // signal volontairement classé "faible" — c'est une tendance qui débute,
  // pas encore une anomalie statistique confirmée comme les signaux ci-dessus.
  if (topProduitsDetail) {
    topProduitsDetail.forEach(p => {
      if (p.evolution === "hausse") {
        signaux.push({
          type: "evolution",
          probleme: `Évolution récente en hausse sur le produit "${p.produit}".`,
          donneeObservee: `Nombre de tickets en hausse sur les 3 derniers mois par rapport aux 3 mois précédents, pour ce produit.`,
          produit: p.produit, agence: null, technicien: null,
          niveau: "faible",
          hypothese: "Ce problème pourrait devenir récurrent s'il se confirme sur les prochaines semaines — pas encore une anomalie établie.",
          action: "Surveiller ce produit sur les prochaines semaines et vérifier les nouveaux tickets dès leur ouverture.",
        });
      }
    });
  }

  return signaux;
}

// ---- Intelligence entreprise V2 : croisements SAV, calculés à partir des
// mêmes tickets déjà chargés (aucun nouveau fetch, aucune nouvelle donnée
// Airtable). Fonction pure séparée de calculerAnalyticsSAV (qui reste
// inchangée) pour ne pas alourdir son résultat déjà volumineux quand ces
// croisements ne sont pas nécessaires (ex. panneau Analytics classique).
// - Produit × Agence : les paires les plus fréquentes, pour repérer une
//   concentration de SAV sur un produit dans UNE agence en particulier
//   (piste "problème de pose/agence" plutôt que "problème de produit").
// - Agence × Cause dominante : pour chaque agence ayant au moins une cause
//   SAV renseignée, la cause la plus fréquente chez elle — jamais une
//   cause "moyenne" ou inventée, uniquement celle réellement la plus
//   citée sur les tickets de cette agence.
// Le troisième croisement demandé (Produit × Coût) n'a pas besoin de cette
// fonction : coutSAVParProduit existe déjà dans calculerAnalyticsSAV,
// réutilisé tel quel par resumerAnalyticsSAV ci-dessous (pas de nouveau
// calcul, pas de duplication).
export function calculerCroisementsSAV(tickets) {
  const parProduitAgence = {};
  const parAgenceCause = {};
  (tickets || []).forEach(t => {
    const produit = (t.fields?.Produit || "").trim();
    const agence = (t.fields?.Agence || "").trim();
    const cause = t.fields?.["Cause SAV"];
    if (produit && agence) {
      if (!parProduitAgence[produit]) parProduitAgence[produit] = {};
      parProduitAgence[produit][agence] = (parProduitAgence[produit][agence] || 0) + 1;
    }
    if (agence && cause) {
      if (!parAgenceCause[agence]) parAgenceCause[agence] = {};
      parAgenceCause[agence][cause] = (parAgenceCause[agence][cause] || 0) + 1;
    }
  });

  const topProduitAgence = [];
  Object.entries(parProduitAgence).forEach(([produit, agences]) => {
    Object.entries(agences).forEach(([agence, n]) => {
      topProduitAgence.push({ produit, agence, tickets: n });
    });
  });
  topProduitAgence.sort((a, b) => b.tickets - a.tickets);

  const causeDominanteParAgence = Object.entries(parAgenceCause).map(([agence, causes]) => {
    const [causeDominante, n] = Object.entries(causes).sort((a, b) => b[1] - a[1])[0];
    const totalCausesAgence = Object.values(causes).reduce((s, v) => s + v, 0);
    return { agence, causeDominante, tickets: n, totalCausesAgence };
  });
  causeDominanteParAgence.sort((a, b) => b.tickets - a.tickets);

  return { topProduitAgence, causeDominanteParAgence };
}

// ---- Intelligence entreprise V1 : résumé compact pour injection dans le
// prompt d'un assistant conversationnel (IKO/Dashboard, Max/Technicien).
// Ne garde que les indicateurs les plus utiles pour répondre à une
// question orale — jamais la structure complète de calculerAnalyticsSAV
// (trop volumineuse, pas faite pour un prompt). Fonction pure, aucun appel
// réseau, s'utilise aussi bien côté navigateur (calcul, avant envoi dans
// le body existant d'un fetch déjà présent) que côté serveur (formatage
// uniquement, voir blocPromptAnalyticsSAV ci-dessous — pas besoin
// d'importer calculerAnalyticsSAV côté serveur, le résumé arrive déjà
// calculé dans la requête). nbTickets (le nombre de tickets réellement
// analysés, généralement tickets.length côté appelant) est requis : sans
// lui, impossible de distinguer "aucun ticket urgent sur 40" de "aucune
// donnée chargée" — retourne null si absent/nul, pour que
// blocPromptAnalyticsSAV n'affiche jamais un "0%" trompeur en l'absence
// réelle de données.
// V2 : croisements (résultat optionnel de calculerCroisementsSAV) est un
// 3e paramètre OPTIONNEL — omis, le comportement est strictement celui de
// la V1 (non-régression garantie, aucune fonction/signature existante
// cassée) ; fourni, ajoute au résumé les produits les plus coûteux
// (réutilise coutSAVParProduit déjà calculé, aucun nouveau calcul) et les
// concentrations produit×agence / agence×cause, toujours plafonnées à 3
// pour garder le résumé compact.
export function resumerAnalyticsSAV(analytics, nbTickets, croisements) {
  if (!analytics || !nbTickets) return null;
  const dernierMois = analytics.tendance[analytics.tendance.length - 1];
  const moisPrecedent = analytics.tendance[analytics.tendance.length - 2];
  const tendanceRecente = (dernierMois && moisPrecedent)
    ? (dernierMois.valeur > moisPrecedent.valeur ? "hausse" : dernierMois.valeur < moisPrecedent.valeur ? "baisse" : "stable")
    : null;
  const resume = {
    topProduits: analytics.topProduits.slice(0, 3).map(([produit, n]) => ({ produit, tickets: n })),
    topCauses: analytics.topCauses.slice(0, 3).map(([cause, n]) => ({ cause, tickets: n })),
    tauxUrgents: analytics.tauxUrgents,
    coutSAVGlobal: Math.round(analytics.coutSAVGlobal),
    tendanceRecente,
    // V2 : produits les plus coûteux — réutilise coutSAVParProduit déjà
    // calculé par calculerAnalyticsSAV (aucun nouveau calcul), disponible
    // même sans passer croisements (pas besoin de calculerCroisementsSAV
    // pour celui-ci).
    topProduitsCouteux: (analytics.coutSAVParProduit || []).slice(0, 3).map(([produit, cout]) => ({ produit, cout: Math.round(cout) })),
  };
  // V2 : concentrations produit×agence et cause dominante par agence —
  // uniquement si l'appelant fournit croisements (calculerCroisementsSAV(tickets)
  // déjà exécuté à côté). Absent, le résumé reste strictement celui de la V1
  // (mêmes champs qu'avant + topProduitsCouteux), aucune régression pour un
  // appelant qui n'a pas encore été mis à jour.
  if (croisements) {
    resume.concentrationsProduitAgence = (croisements.topProduitAgence || []).slice(0, 3);
    resume.causesDominantesParAgence = (croisements.causeDominanteParAgence || []).slice(0, 3);
  }
  return resume;
}

// Formate resumerAnalyticsSAV() en bloc de prompt, identique pour tous les
// assistants qui l'utilisent. N'a besoin QUE du résumé (pas de
// calculerAnalyticsSAV) — c'est pourquoi le serveur peut l'importer seul,
// sans jamais recalculer côté serveur ce que le navigateur a déjà calculé
// avec les mêmes données déjà chargées.
export function blocPromptAnalyticsSAV(resume) {
  if (!resume) return "";
  try {
    const lignes = [];
    if (resume.topProduits && resume.topProduits.length) {
      lignes.push("Produits générant le plus de SAV : " + resume.topProduits.map(p => p.produit + " (" + p.tickets + " tickets)").join(", "));
    }
    if (resume.topCauses && resume.topCauses.length) {
      lignes.push("Causes SAV les plus fréquentes : " + resume.topCauses.map(c => c.cause + " (" + c.tickets + " tickets)").join(", "));
    }
    if (typeof resume.tauxUrgents === "number") {
      lignes.push("Taux de tickets urgents actuel : " + resume.tauxUrgents + "%.");
    }
    if (resume.coutSAVGlobal > 0) {
      lignes.push("Coût SAV total sur les interventions chiffrées : " + resume.coutSAVGlobal + " €.");
    }
    if (resume.topProduitsCouteux && resume.topProduitsCouteux.length) {
      lignes.push("Produits les plus coûteux en SAV : " + resume.topProduitsCouteux.map(p => p.produit + " (" + p.cout + " €)").join(", ") + ".");
    }
    if (resume.concentrationsProduitAgence && resume.concentrationsProduitAgence.length) {
      lignes.push("Concentrations produit × agence : " + resume.concentrationsProduitAgence.map(c => c.produit + " chez " + c.agence + " (" + c.tickets + " tickets)").join(", ") + ".");
    }
    if (resume.causesDominantesParAgence && resume.causesDominantesParAgence.length) {
      lignes.push("Cause SAV dominante par agence : " + resume.causesDominantesParAgence.map(c => c.agence + " → " + c.causeDominante + " (" + c.tickets + "/" + c.totalCausesAgence + ")").join(", ") + ".");
    }
    if (resume.tendanceRecente) {
      lignes.push("Tendance du volume SAV sur le dernier mois : " + resume.tendanceRecente + ".");
    }
    if (lignes.length === 0) return "";
    return `

ANALYTICS SAV DE CETTE ENTREPRISE
Données réelles, calculées à partir des tickets actuellement chargés —
jamais une estimation ni une invention. Utilise-les pour répondre à une
question sur les tendances/chiffres SAV, sans les recalculer toi-même
(risque d'erreur de comptage) :
${lignes.map(l => "- " + l).join("\n")}`;
  } catch (e) {
    return "";
  }
}

// ---- Intelligence entreprise V3 : recommandations métier factuelles,
// déduites du résumé déjà calculé (resumerAnalyticsSAV) et, si fournie, de
// la connaissance entreprise déjà normalisée (voir _connaissance.js —
// aucun import croisé ici : ce module reçoit un tableau simple, il ne
// connaît rien de la façon dont il a été produit, pour rester découplé).
// Fonction pure, 0 appel réseau, 0 nouvelle donnée : uniquement du texte
// dérivé des chiffres déjà présents dans resume.
//
// RÈGLE CENTRALE (voir mission) : chaque recommandation énonce un FAIT
// déjà calculé puis propose une VÉRIFICATION ("vérifier X peut être
// pertinent"), jamais une causalité affirmée ("X est responsable de Y").
// Aucune recommandation n'est produite si la donnée sous-jacente est
// absente ou insuffisante pour être significative (mêmes seuils de
// significativité que detecterAlertesSAV : au moins 3 éléments comparables
// pour une comparaison statistique, jamais un chiffre inventé).
export function genererRecommandationsSAV(resume, connaissanceEntrees) {
  if (!resume) return [];
  const recommandations = [];

  // 1. Produit générant le plus de coûts SAV — fait direct, toujours
  // significatif dès qu'un coût réel existe (pas de seuil arbitraire
  // nécessaire : c'est déjà LE plus coûteux parmi ceux calculés).
  if (resume.topProduitsCouteux && resume.topProduitsCouteux.length > 0 && resume.topProduitsCouteux[0].cout > 0) {
    const top = resume.topProduitsCouteux[0];
    recommandations.push({
      type: "cout",
      texte: `Le produit "${top.produit}" représente la part la plus importante des coûts SAV connus (${top.cout} €) ; vérifier sa procédure de pose/installation peut être pertinent.`,
    });
  }

  // 2. Concentration produit × agence anormale — détection statistique
  // (moyenne + 1 écart-type), même méthode et même seuil (≥3 éléments)
  // que detecterAlertesSAV : pas de nouveau seuil inventé.
  if (resume.concentrationsProduitAgence && resume.concentrationsProduitAgence.length >= 3) {
    const { moyenne, ecartType } = ecartTypeMoyenne(resume.concentrationsProduitAgence.map(c => c.tickets));
    const top = resume.concentrationsProduitAgence[0];
    if (ecartType > 0 && top.tickets > moyenne + ecartType) {
      recommandations.push({
        type: "concentration",
        texte: `Le produit "${top.produit}" est nettement plus représenté en SAV chez l'agence "${top.agence}" (${top.tickets} tickets) que la moyenne des autres associations produit/agence connues ; vérifier un facteur local (pose, stock, formation) peut être pertinent.`,
      });
    }
  }

  // 3. Cause dominante d'une agence — seuil minimal de 3 tickets avec
  // cause connue dans cette agence pour que "dominante" ait un sens (sinon
  // 1 ticket sur 1 serait toujours "100% dominant", trompeur).
  if (resume.causesDominantesParAgence && resume.causesDominantesParAgence.length > 0) {
    const top = resume.causesDominantesParAgence[0];
    if (top.totalCausesAgence >= 3) {
      recommandations.push({
        type: "cause_agence",
        texte: `Chez l'agence "${top.agence}", la cause SAV la plus fréquente est "${top.causeDominante}" (${top.tickets}/${top.totalCausesAgence} tickets avec cause connue) ; vérifier si une procédure existe déjà pour ce cas peut être pertinent.`,
      });
    }
  }

  // 4. Lien textuel avec la Connaissance entreprise — correspondance de
  // mots UNIQUEMENT (jamais une causalité), sur les sujets déjà identifiés
  // ci-dessus (produit le plus coûteux, cause dominante). Sujet trop court
  // (<3 caractères utiles) ignoré pour éviter un faux rapprochement.
  if (Array.isArray(connaissanceEntrees) && connaissanceEntrees.length > 0) {
    const sujets = [];
    if (resume.topProduitsCouteux && resume.topProduitsCouteux[0]) sujets.push(resume.topProduitsCouteux[0].produit);
    if (resume.causesDominantesParAgence && resume.causesDominantesParAgence[0]) sujets.push(resume.causesDominantesParAgence[0].causeDominante);
    sujets.forEach(sujet => {
      const sujetNorm = normaliserTexte(sujet);
      if (sujetNorm.length < 3) return;
      const trouve = connaissanceEntrees.find(e =>
        (e.categorie === "Procédure" || e.categorie === "Règle interne") &&
        (normaliserTexte(e.titre).includes(sujetNorm) || normaliserTexte(e.contenu).includes(sujetNorm))
      );
      if (trouve) {
        recommandations.push({
          type: "connaissance",
          texte: `Une entrée de connaissance interne existe déjà en lien avec "${sujet}" ([${trouve.categorie}] ${trouve.titre}) ; s'y référer peut être pertinent avant d'agir.`,
        });
      }
    });
  }

  // Plafond compact : jamais plus de 4 recommandations dans le prompt.
  return recommandations.slice(0, 4);
}

// Formate genererRecommandationsSAV() en bloc de prompt distinct des
// Analytics SAV et de la Connaissance entreprise (jamais fusionnés).
export function blocPromptRecommandationsSAV(recommandations) {
  if (!recommandations || recommandations.length === 0) return "";
  return `

RECOMMANDATIONS MÉTIER (déduites des faits ci-dessus, jamais une causalité certaine)
Ce sont des pistes à vérifier, pas des conclusions. Si on te les demande,
présente-les comme telles ("il pourrait être utile de vérifier...", jamais
"c'est la cause de...") :
${recommandations.map(r => "- " + r.texte).join("\n")}`;
}

// ==================== Intelligence Commerciale V1 — mission #1 ====================
// Taux de conversion des devis. Fonction PURE (aucun fetch, aucun effet de
// bord) : le chargement (chargerDevisPourAnalytics) et la résolution des
// noms d'agence (resoudreNomsAgences) vivent dans dashboard.html, jamais
// ici — même séparation que calculerAnalyticsSAV (pur) / chargerInterventionsSAV
// (fetch), déjà utilisée dans ce projet.
//
// Définition retenue (vérifiée sur le code réel de devis.html / dashboard.html,
// la table Devis n'a que 3 états observables — aucun 4e statut inventé) :
//   - Convertis   : Statut === "Validé"
//   - Refusés     : "Devis refusé" === true
//   - En attente  : Statut === "Envoyé" et non refusé (décision pas encore prise)
//   - Éligibles   : Convertis + Refusés (les devis en attente n'ont pas encore
//                   d'issue, donc jamais comptés dans le taux)
//   - Formule     : taux = convertis / (convertis + refusés) × 100, arrondi à
//                   l'entier le plus proche (même convention que le reste du
//                   dashboard, ex. tauxUrgents/tauxResolutionPremierPassage) ;
//                   null (jamais 0 ni NaN) si éligibles === 0.
//
// agencesMap : { [recordIdAgence]: "Nom agence" | null }, déjà résolu par
// l'appelant (resoudreNomsAgences) — cette fonction ne fait aucune résolution
// de nom elle-même. Un devis sans agence (champ vide/absent) est regroupé
// sous "Non renseignée" ; un devis avec un ID d'agence non résolu (absent de
// agencesMap ou résolution en échec) est regroupé sous "Agence inconnue"
// plutôt que silencieusement fusionné avec "Non renseignée" (jamais la même
// réalité métier).
export function calculerTauxConversionDevis(devisRecords, agencesMap) {
  const map = agencesMap || {};
  const parAgenceAcc = {}; // clé = libellé d'agence affiché

  let convertis = 0, refuses = 0, enAttente = 0;
  const statutsInconnusCompte = {};

  const enregistrerAgence = (label, categorie) => {
    if (!parAgenceAcc[label]) parAgenceAcc[label] = { convertis: 0, refuses: 0 };
    if (categorie === "converti") parAgenceAcc[label].convertis += 1;
    else if (categorie === "refuse") parAgenceAcc[label].refuses += 1;
  };

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    const statut = f.Statut;
    const estRefuse = f["Devis refusé"] === true;

    let categorie = null;
    if (estRefuse) { refuses += 1; categorie = "refuse"; }
    else if (statut === "Validé") { convertis += 1; categorie = "converti"; }
    else if (statut === "Envoyé") { enAttente += 1; }
    else {
      // Statut inattendu (jamais vu dans le code existant) : ignoré
      // proprement, jamais compté ni comme converti ni comme refusé ni
      // comme en attente — signalé à l'appelant pour diagnostic uniquement.
      const cle = statut === undefined || statut === null || statut === "" ? "(vide)" : String(statut);
      statutsInconnusCompte[cle] = (statutsInconnusCompte[cle] || 0) + 1;
    }

    if (categorie) {
      const idsAgence = Array.isArray(f.Agence) ? f.Agence : [];
      const idAgence = idsAgence[0] || null;
      let label;
      if (!idAgence) label = "Non renseignée";
      else if (map[idAgence]) label = map[idAgence];
      else label = "Agence inconnue";
      enregistrerAgence(label, categorie);
    }
  });

  const eligibles = convertis + refuses;
  const tauxGlobal = eligibles > 0 ? Math.round((convertis / eligibles) * 100) : null;

  const parAgence = Object.keys(parAgenceAcc).map(agence => {
    const a = parAgenceAcc[agence];
    const eligiblesAgence = a.convertis + a.refuses;
    return {
      agence,
      convertis: a.convertis,
      refuses: a.refuses,
      eligibles: eligiblesAgence,
      taux: eligiblesAgence > 0 ? Math.round((a.convertis / eligiblesAgence) * 100) : null,
    };
  }).sort((a, b) => b.eligibles - a.eligibles);

  const statutsInconnus = Object.keys(statutsInconnusCompte).map(statut => ({
    statut, count: statutsInconnusCompte[statut],
  }));

  return {
    global: { convertis, refuses, enAttente, eligibles, taux: tauxGlobal },
    parAgence,
    statutsInconnus,
  };
}

// ==================== Intelligence Commerciale V1 — mission #2 ====================
// Panier moyen des devis convertis + tendance mensuelle. Fonction PURE,
// aucun fetch : reçoit exactement le même tableau `devisRecords` déjà
// chargé/mis en cache par chargerDevisPourAnalytics() (mission #1) — aucune
// deuxième source de données, aucun nouvel appel Airtable.
//
// Champ montant retenu : "Montant HT" (montant commercial hors taxes,
// déjà stocké sur chaque Devis à la création dans dashboard.html/ModalDevis
// — champ réellement utilisé par le projet pour le calcul commercial).
// Champ date retenu : "Date validation client" (date réelle de conversion,
// déjà affichée dans l'onglet "Signés" de ModalGestionDevis) — vrai champ
// Date Airtable (chaîne ISO), contrairement au Créneau texte des Tickets
// SAV : pas besoin de parseDateCreneau ici, un simple `new Date(...)` suffit.
//
// Règle de calcul (même définition de "converti" qu'en mission #1, jamais
// changée) :
//   - Seuls les devis Statut === "Validé" entrent dans le panier moyen.
//   - Un montant absent, non numérique, non fini ou <= 0 est invalide et
//     exclu du calcul (jamais compté comme 0, jamais inclus dans le
//     dénominateur).
//   - Panier moyen global = somme des Montant HT valides / nombre de devis
//     validés avec un montant exploitable.
//   - Tendance mensuelle : même convention que calculerAnalyticsSAV
//     ci-dessus (6 derniers mois calendaires glissants, clé "AAAA-MM",
//     libellé fr-FR "mmm aa"). Un devis validé avec montant valide mais
//     sans date résolvable est compté dans le total global mais jamais
//     rattaché à un mois inventé.
export function calculerPanierMoyenEtTendance(devisRecords) {
  let sommeGlobale = 0;
  let nbGlobal = 0;

  const maintenant = new Date();
  const moisLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    moisLabels.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const parMois = {};

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    if (f.Statut !== "Validé") return;

    const montant = f["Montant HT"];
    if (typeof montant !== "number" || !isFinite(montant) || montant <= 0) return;

    sommeGlobale += montant;
    nbGlobal += 1;

    const dateStr = f["Date validation client"];
    if (!dateStr) return;
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return;
    const key = dateObj.getFullYear() + "-" + String(dateObj.getMonth() + 1).padStart(2, "0");
    if (!parMois[key]) parMois[key] = { nb: 0, montant: 0 };
    parMois[key].nb += 1;
    parMois[key].montant += montant;
  });

  const tendance = moisLabels.map(m => {
    const agg = parMois[m.key] || { nb: 0, montant: 0 };
    return {
      label: m.label,
      nbConvertis: agg.nb,
      montantTotal: Math.round(agg.montant * 100) / 100,
      panierMoyen: agg.nb > 0 ? Math.round((agg.montant / agg.nb) * 100) / 100 : null,
    };
  });

  return {
    panierMoyenGlobal: nbGlobal > 0 ? Math.round((sommeGlobale / nbGlobal) * 100) / 100 : null,
    nbDevisConvertisAnalyses: nbGlobal,
    tendance,
  };
}

// ==================== Intelligence Commerciale V1 — mission #3 ====================
// Top produits/services les plus vendus. Fonction PURE, aucun fetch — reçoit
// exactement le même tableau `devisRecords` déjà chargé/mis en cache par
// chargerDevisPourAnalytics() (mission #1).
//
// Structure des données réellement utilisée par le projet (vérifiée dans le
// code de création des devis — dashboard.html/LigneDevisEditeur/ModalDevis
// ET technicien.html, mêmes deux points d'écriture, structure identique) :
// chaque Devis a un champ "Lignes devis (JSON)" — une chaîne JSON d'un
// tableau de lignes { designation, qte, puHT, tauxTva, totalHT, totalTTC }.
// "totalHT" est déjà le montant de ligne calculé (qte × puHT) au moment de
// la création : on le réutilise tel quel, jamais recalculé à partir de
// qte × puHT (ce serait une supposition redondante et une deuxième source
// de vérité pour la même donnée).
//
// Règle : seuls les devis Statut === "Validé" sont pris en compte (même
// définition de "converti" qu'en missions #1/#2). Classement par CA HT
// généré (donnée fiable : valeur déjà stockée, jamais recalculée par
// supposition) — les 5 premiers.
//
// Robustesse (aucune des situations suivantes ne doit faire planter la
// fonction ni fausser silencieusement un total) :
//   - "Lignes devis (JSON)" absent, vide ou JSON invalide → devis ignoré
//     pour ce calcul (jamais une erreur qui interrompt les autres devis).
//   - Lignes qui ne sont pas un tableau → devis ignoré.
//   - Une ligne qui n'est pas un objet → ligne ignorée.
//   - designation absente/vide → regroupée sous "Produit/service non renseigné"
//     (jamais fusionnée silencieusement avec une désignation réelle).
//   - qte absente/non numérique/<= 0 → n'alimente jamais le total de
//     quantité (quantiteConnue reste false tant qu'aucune ligne valide
//     n'a été rencontrée pour ce produit).
//   - totalHT absent/non numérique/négatif → n'alimente jamais le CA HT
//     (caConnu reste false tant qu'aucune ligne valide n'a été rencontrée).
//   - Un même produit apparaissant plusieurs fois dans un même devis compte
//     pour UN SEUL devis dans "nbDevis" (Set d'IDs de devis, jamais un
//     comptage de lignes).
export function calculerTopProduitsServices(devisRecords) {
  const NON_RENSEIGNE = "Produit/service non renseigné";
  const parProduit = {}; // label -> { quantiteTotale, quantiteConnue, caHT, caConnu, devisIds:Set }

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    if (f.Statut !== "Validé") return;

    const brut = f["Lignes devis (JSON)"];
    if (!brut) return;
    let lignes;
    try {
      lignes = JSON.parse(brut);
    } catch (e) {
      return; // JSON invalide : devis ignoré pour ce calcul, jamais une exception qui remonte
    }
    if (!Array.isArray(lignes)) return;

    lignes.forEach(ligne => {
      if (!ligne || typeof ligne !== "object") return; // ligne mal formée, ignorée

      const designationBrute = typeof ligne.designation === "string" ? ligne.designation.trim() : "";
      const label = designationBrute || NON_RENSEIGNE;

      if (!parProduit[label]) {
        parProduit[label] = { quantiteTotale: 0, quantiteConnue: false, caHT: 0, caConnu: false, devisIds: new Set() };
      }
      const acc = parProduit[label];
      acc.devisIds.add(d.id);

      const qte = Number(ligne.qte);
      if (Number.isFinite(qte) && qte > 0) {
        acc.quantiteTotale += qte;
        acc.quantiteConnue = true;
      }

      const totalHT = Number(ligne.totalHT);
      if (Number.isFinite(totalHT) && totalHT >= 0) {
        acc.caHT += totalHT;
        acc.caConnu = true;
      }
    });
  });

  const top = Object.keys(parProduit).map(label => {
    const acc = parProduit[label];
    return {
      designation: label,
      quantiteTotale: acc.quantiteConnue ? Math.round(acc.quantiteTotale * 100) / 100 : null,
      nbDevis: acc.devisIds.size,
      caHT: acc.caConnu ? Math.round(acc.caHT * 100) / 100 : null,
    };
  }).sort((a, b) => (b.caHT || 0) - (a.caHT || 0)).slice(0, 5);

  return { top };
}

// ==================== Intelligence Commerciale V1 — mission #4 ====================
// Comparaison du taux de conversion PAR MODE DE CRÉATION du devis (Auto Iko
// vs Manuel). Fonction PURE, aucun fetch — reçoit exactement le même
// tableau `devisRecords` déjà chargé/mis en cache par
// chargerDevisPourAnalytics() (mission #1).
//
// Source de vérité (vérifiée aux deux seuls points de création de Devis du
// projet, aucun autre endroit n'écrit ce champ) : champ "Mode", toujours
// renseigné sans condition —
//   - dashboard.html (ModalDevis.envoyer)      → "Mode": "Manuel"
//   - technicien.html (envoyerDevisAuto)       → "Mode": "Auto Iko"
//
// IMPORTANT (validé avec l'utilisateur) : "Mode" distingue le PARCOURS/
// INTERFACE d'origine du devis (backoffice Manuel vs écran Technicien Auto
// Iko), jamais "IA vs saisie humaine" — dans les deux parcours, les lignes
// peuvent être ajoutées via une suggestion IA ou choisies manuellement au
// catalogue. Ce module ne doit donc jamais être présenté comme une
// comparaison IA/humain, uniquement comme une comparaison du taux de
// conversion par mode de création du devis.
//
// Mêmes règles de conversion que la mission #1 (jamais réinventées) :
//   - Convertis  : Statut === "Validé"
//   - Refusés    : "Devis refusé" === true
//   - En attente : Statut === "Envoyé" et non refusé → exclus du dénominateur
//   - Éligibles  : Convertis + Refusés
//   - Taux       : convertis / éligibles × 100, arrondi entier, null si 0 éligible
//
// Un Mode absent ou différent de "Auto Iko"/"Manuel" est classé sous
// "Origine inconnue" — jamais rattaché artificiellement à l'un des deux
// modes réels.
export function calculerConversionParMode(devisRecords) {
  const ORIGINE_INCONNUE = "Origine inconnue";
  const parModeAcc = {};

  const enregistrer = (mode, categorie) => {
    if (!parModeAcc[mode]) parModeAcc[mode] = { convertis: 0, refuses: 0 };
    if (categorie === "converti") parModeAcc[mode].convertis += 1;
    else if (categorie === "refuse") parModeAcc[mode].refuses += 1;
  };

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    const statut = f.Statut;
    const estRefuse = f["Devis refusé"] === true;

    let categorie = null;
    if (estRefuse) categorie = "refuse";
    else if (statut === "Validé") categorie = "converti";
    else return; // en attente ou statut inconnu : jamais compté dans cette comparaison (même logique qu'en mission #1)

    const modeBrut = f.Mode;
    const mode = (modeBrut === "Auto Iko" || modeBrut === "Manuel") ? modeBrut : ORIGINE_INCONNUE;
    enregistrer(mode, categorie);
  });

  const parMode = Object.keys(parModeAcc).map(mode => {
    const a = parModeAcc[mode];
    const eligibles = a.convertis + a.refuses;
    return {
      mode,
      convertis: a.convertis,
      refuses: a.refuses,
      eligibles,
      taux: eligibles > 0 ? Math.round((a.convertis / eligibles) * 100) : null,
    };
  }).sort((a, b) => b.eligibles - a.eligibles);

  return { parMode };
}

// ---------------------------------------------------------------------
// Intelligence Commerciale V1 — mission #7B (note client du ticket SAV vs
// résultat du devis EXACTEMENT lié à ce ticket via Devis["Ticket lié"]).
//
// Analyse strictement DESCRIPTIVE : « quelle est la répartition des
// résultats des devis liés à un ticket SAV, selon la note laissée par le
// client sur ce ticket ? ». Ce n'est ni une prédiction, ni une preuve de
// causalité, ni une analyse de « devis ultérieur » — le devis retrouvé via
// Ticket lié est celui qui est à l'ORIGINE de l'intervention/du ticket
// noté, jamais un devis créé après coup (voir Mission #7A : aucune donnée
// fiable n'existe aujourd'hui pour relier un ticket à un devis ultérieur
// distinct, faute d'identifiant de client final commun aux deux tables).
//
// Règle de jointure ABSOLUE (mission #7B) : uniquement
// Devis["Ticket lié"] -> Tickets SAV.id. Jamais de rapprochement par nom
// de client, email, agence ou toute autre heuristique de correspondance
// approximative.
//
// Résultat du devis : mêmes règles que la mission #1 —
//   Converti : Statut === "Validé"
//   Refusé   : Devis refusé === true
//   En attente : tout le reste (exclu du taux, exclu même du dénominateur)
//
// Note du ticket : uniquement les entiers 1 à 5. Note absente, nulle,
// non numérique, décimale ou hors de cette plage => ticket ignoré (le
// devis correspondant n'est alors compté dans aucune case).
export function calculerNoteVsResultatDevis(devisRecords, ticketsRecords) {
  const ticketsParId = {};
  (ticketsRecords || []).forEach(t => {
    if (t && t.id) ticketsParId[t.id] = t;
  });

  const NOTES_POSSIBLES = [1, 2, 3, 4, 5];
  const parNoteAcc = {};
  NOTES_POSSIBLES.forEach(n => { parNoteAcc[n] = { convertis: 0, refuses: 0 }; });

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};

    // Ticket lié : lien Airtable = tableau d'IDs. On ne suit que le
    // premier ID présent (le code de création n'écrit jamais qu'un seul
    // ID dans ce champ — voir dashboard.html/technicien.html). Un devis
    // sans Ticket lié identifiable, ou dont l'ID ne correspond à aucun
    // ticket transmis, est ignoré : aucune correspondance inventée.
    const idsTicketLie = Array.isArray(f["Ticket lié"]) ? f["Ticket lié"] : [];
    const idTicket = idsTicketLie[0];
    if (!idTicket) return;

    const ticket = ticketsParId[idTicket];
    if (!ticket) return;

    const note = ticket.fields?.Note;
    const noteValide = typeof note === "number" && Number.isInteger(note) && note >= 1 && note <= 5;
    if (!noteValide) return;

    const estRefuse = f["Devis refusé"] === true;
    let categorie = null;
    if (estRefuse) categorie = "refuse";
    else if (f.Statut === "Validé") categorie = "converti";
    else return; // en attente ou statut inconnu : exclu du calcul, même logique que mission #1

    if (categorie === "refuse") parNoteAcc[note].refuses += 1;
    else parNoteAcc[note].convertis += 1;
  });

  const parNote = NOTES_POSSIBLES.map(note => {
    const a = parNoteAcc[note];
    const eligibles = a.convertis + a.refuses;
    return {
      note,
      eligibles,
      convertis: a.convertis,
      refuses: a.refuses,
      taux: eligibles > 0 ? Math.round((a.convertis / eligibles) * 100) : null,
    };
  });

  return { parNote };
}

// ---------------------------------------------------------------------
// Intelligence Commerciale V1 — mission #8 (moteur de recommandations).
//
// genererRecommandationsCommercialesV1 est une fonction pure : elle reçoit
// UNIQUEMENT les résultats déjà produits par les fonctions existantes
// (calculerTauxConversionDevis, calculerPanierMoyenEtTendance,
// calculerTopProduitsServices, calculerConversionParMode,
// calculerNoteVsResultatDevis) — jamais les devis/tickets bruts, jamais un
// fetch, jamais le DOM. Elle ne recalcule rien qui existe déjà ; elle
// formule des observations strictement DESCRIPTIVES à partir de ces
// résultats. Aucune formulation causale, prédictive ou de score de
// performance.
//
// Recommandations « Conversion » (A) et « Concentration du CA » (C) NE
// SONT PAS générées dans cette V1 — signalées explicitement ci-dessous
// plutôt qu'implémentées avec une donnée inventée :
//
//   A — Évolution récente du taux de conversion : calculerTauxConversionDevis
//       ne renvoie qu'un instantané global (aucune répartition temporelle).
//       Produire une "évolution récente" obligerait à inventer arbitrairement
//       une période de découpage (ex. "30 derniers jours") qui n'existe nulle
//       part dans les règles déjà établies — interdit explicitement par la
//       mission. Non généré.
//
//   C — Concentration du CA (part du Top 1 / Top 3) : calculerTopProduitsServices
//       ne renvoie que le Top 5 avec leur CA HT propre, jamais le CA HT total
//       exploitable de TOUTES les lignes de tous les devis validés — cette
//       donnée n'existe dans aucun résultat déjà calculé. La reconstruire à
//       partir de panierMoyenGlobal × nbDevisConvertisAnalyses mélangerait un
//       total au niveau du devis (Montant HT) avec des totaux au niveau des
//       lignes (Lignes devis (JSON)), deux bases de calcul différentes et non
//       garanties identiques (lignes invalides exclues côté Mission #3, pas
//       côté Mission #2) — ce serait un calcul méthodologiquement inventé, pas
//       une réutilisation d'une donnée déjà validée. Non généré.
//
// Ces deux absences sont documentées dans le champ `nonGenerees` du résultat
// (jamais affiché à l'utilisateur — diagnostic/tests uniquement, même
// convention que `statutsInconnus` en mission #1).
export function genererRecommandationsCommercialesV1({
  resultatConversion, panierMoyen, topProduitsServices, conversionParMode, noteVsResultatDevis,
  motifsRefus, conversionMensuelle, chiffreAffairesSigne, panierMoyenParMode, panierMoyenParAgence, volumeMensuel,
} = {}) {
  const recommandations = [];
  const nonGenerees = [
    { type: "concentration_ca", raison: "Aucun CA HT total exploitable disponible dans calculerTopProduitsServices (seul le Top 5 est connu) sans mélanger deux bases de calcul différentes." },
  ];

  // ---- A — Évolution mensuelle du taux de conversion (mission #10.1) ----
  // Paramètre optionnel et additif : en son absence, ce bloc est simplement
  // ignoré (comportement V1 strictement inchangé). Désormais alimentable
  // grâce à calculerConversionMensuelleDevis (mission #10), qui fournit une
  // vraie série mensuelle basée sur createdTime — la limitation V1 qui
  // empêchait cette observation n'existe donc plus, mais reste honnête ici :
  // au moins deux mois avec des devis éligibles sont nécessaires pour décrire
  // une évolution, jamais inventée sur un seul point de donnée.
  if (conversionMensuelle && Array.isArray(conversionMensuelle.tendance)) {
    const moisEligibles = conversionMensuelle.tendance.filter(m => m && m.taux !== null);
    if (moisEligibles.length >= 2) {
      const moisRecent = moisEligibles[moisEligibles.length - 1];
      const moisPrecedent = moisEligibles[moisEligibles.length - 2];
      recommandations.push({
        type: "conversion_evolution",
        titre: "Évolution mensuelle du taux de conversion",
        message: "Le taux de conversion observé est de " + moisPrecedent.taux + "% en " + moisPrecedent.label + " et de " + moisRecent.taux + "% en " + moisRecent.label + ".",
        donnees: { moisPrecedent, moisRecent },
      });
    } else {
      nonGenerees.push({ type: "conversion_evolution", raison: "Moins de deux mois avec au moins un devis éligible dans la série mensuelle déjà calculée." });
    }
  } else {
    nonGenerees.push({ type: "conversion_evolution", raison: "Aucune répartition temporelle disponible dans calculerTauxConversionDevis sans inventer une période de découpage." });
  }

  // ---- B — Évolution récente du panier moyen (tendance déjà calculée) ----
  if (panierMoyen && Array.isArray(panierMoyen.tendance)) {
    const moisValides = panierMoyen.tendance.filter(m => m && m.panierMoyen !== null);
    if (moisValides.length >= 2) {
      const moisRecent = moisValides[moisValides.length - 1];
      const moisPrecedent = moisValides[moisValides.length - 2];
      const fmt = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      recommandations.push({
        type: "panier_moyen_evolution",
        titre: "Évolution du panier moyen",
        message: "Le panier moyen des devis validés évolue de " + fmt(moisPrecedent.panierMoyen) + " € HT (" + moisPrecedent.label + ") à " + fmt(moisRecent.panierMoyen) + " € HT (" + moisRecent.label + ").",
        donnees: { moisPrecedent, moisRecent },
      });
    } else {
      nonGenerees.push({ type: "panier_moyen_evolution", raison: "Moins de deux mois avec un panier moyen exploitable dans la tendance déjà calculée." });
    }
  }

  // ---- CA signé (mission #10.2, déjà calculé par calculerChiffreAffairesSigneV1) ----
  if (chiffreAffairesSigne && typeof chiffreAffairesSigne.totalHT === "number") {
    if (chiffreAffairesSigne.nombreDevis > 0) {
      const fmt = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      recommandations.push({
        type: "ca_signe",
        titre: "Chiffre d'affaires signé",
        message: "Le CA HT signé s'élève à " + fmt(chiffreAffairesSigne.totalHT) + " € sur la période analysée (" + chiffreAffairesSigne.nombreDevis + " devis validé(s) avec montant exploitable).",
        donnees: { totalHT: chiffreAffairesSigne.totalHT, nombreDevis: chiffreAffairesSigne.nombreDevis, panierMoyenHT: chiffreAffairesSigne.panierMoyenHT },
      });
    } else {
      nonGenerees.push({ type: "ca_signe", raison: "Aucun devis validé avec un montant HT exploitable." });
    }
  }

  // ---- D — Manuel vs Auto Iko (déjà calculé par calculerConversionParMode) ----
  if (conversionParMode && Array.isArray(conversionParMode.parMode)) {
    const autoIko = conversionParMode.parMode.find(m => m.mode === "Auto Iko");
    const manuel = conversionParMode.parMode.find(m => m.mode === "Manuel");
    if (autoIko && manuel && autoIko.taux !== null && manuel.taux !== null) {
      recommandations.push({
        type: "mode_creation",
        titre: "Manuel vs Auto Iko",
        message: "Sur la période analysée, le taux de conversion observé est de " + autoIko.taux + "% pour le parcours Auto Iko et de " + manuel.taux + "% pour le parcours Manuel.",
        donnees: { autoIko, manuel },
      });
    } else {
      nonGenerees.push({ type: "mode_creation", raison: "Taux non calculable (aucun devis éligible) pour au moins un des deux modes Manuel/Auto Iko." });
    }
  }

  // ---- Panier moyen par mode de création (mission #10.3, déjà calculé par calculerPanierMoyenParModeV1) ----
  // Même mise en garde que le bloc D ci-dessus : jamais présenté comme une
  // comparaison de performance ou d'efficacité entre les deux parcours.
  if (panierMoyenParMode && Array.isArray(panierMoyenParMode.parMode)) {
    const autoIkoP = panierMoyenParMode.parMode.find(m => m.mode === "Auto Iko");
    const manuelP = panierMoyenParMode.parMode.find(m => m.mode === "Manuel");
    if (autoIkoP && manuelP && autoIkoP.panierMoyenHT !== null && manuelP.panierMoyenHT !== null) {
      const fmt = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      recommandations.push({
        type: "panier_par_mode",
        titre: "Panier moyen par mode de création",
        message: "Le panier moyen observé est de " + fmt(autoIkoP.panierMoyenHT) + " € HT pour le parcours Auto Iko et de " + fmt(manuelP.panierMoyenHT) + " € HT pour le parcours Manuel.",
        donnees: { autoIko: autoIkoP, manuel: manuelP },
      });
    } else {
      nonGenerees.push({ type: "panier_par_mode", raison: "Panier moyen non calculable (aucun devis validé avec montant exploitable) pour au moins un des deux modes Manuel/Auto Iko." });
    }
  }

  // ---- E — Note client vs résultat du devis lié (déjà calculé) ----
  if (noteVsResultatDevis && Array.isArray(noteVsResultatDevis.parNote)) {
    const notesAvecDonnees = noteVsResultatDevis.parNote.filter(n => n.eligibles > 0);
    if (notesAvecDonnees.length > 0) {
      const phrases = notesAvecDonnees.map(n =>
        "Parmi les devis liés à des tickets notés " + n.note + "/5, " + n.convertis + " sur " + n.eligibles + " sont validés."
      );
      recommandations.push({
        type: "note_client_devis_lie",
        titre: "Note client vs résultat du devis lié",
        message: phrases.join(" ") + " (Analyse portant sur le devis à l'origine du ticket, pas sur un devis ultérieur.)",
        donnees: { parNote: notesAvecDonnees },
      });
    } else {
      nonGenerees.push({ type: "note_client_devis_lie", raison: "Aucune note avec au moins un devis éligible." });
    }
  }

  // ---- F — Répartition par agence (déjà calculée par calculerTauxConversionDevis) ----
  // Aucun seuil métier trouvé ailleurs dans le code pour exclure une agence à
  // faible volume : approche prudente demandée par la mission — on affiche le
  // nombre d'éligibles et le taux de chaque agence, sans qualifier ni classer
  // (jamais "meilleure"/"pire" agence).
  if (resultatConversion && Array.isArray(resultatConversion.parAgence) && resultatConversion.parAgence.length > 0) {
    const fragments = resultatConversion.parAgence.map(a =>
      a.agence + " (" + a.eligibles + " éligible(s), taux " + (a.taux === null ? "—" : a.taux + "%") + ")"
    );
    recommandations.push({
      type: "repartition_agences",
      titre: "Répartition par agence",
      message: "Répartition observée par agence sur les devis éligibles : " + fragments.join(" ; ") + ".",
      donnees: { parAgence: resultatConversion.parAgence },
    });
  } else {
    nonGenerees.push({ type: "repartition_agences", raison: "Aucune agence avec au moins un devis éligible." });
  }

  // ---- Panier moyen par agence (mission #10.4, déjà calculé par calculerPanierMoyenParAgenceV1) ----
  // Aucun classement "meilleure"/"pire" agence, même esprit que le bloc F.
  if (panierMoyenParAgence && Array.isArray(panierMoyenParAgence.parAgence) && panierMoyenParAgence.parAgence.length > 0) {
    const fmt = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const avecPanier = panierMoyenParAgence.parAgence.filter(a => a.panierMoyenHT !== null);
    if (avecPanier.length > 0) {
      const fragments = avecPanier.map(a => fmt(a.panierMoyenHT) + " € HT pour l'agence " + a.agence);
      recommandations.push({
        type: "panier_par_agence",
        titre: "Panier moyen par agence",
        message: "Le panier moyen observé est de " + fragments.join(" ; ") + ".",
        donnees: { parAgence: avecPanier },
      });
    } else {
      nonGenerees.push({ type: "panier_par_agence", raison: "Aucune agence avec un devis validé et un montant exploitable." });
    }
  } else {
    nonGenerees.push({ type: "panier_par_agence", raison: "Aucune agence avec au moins un devis validé et un montant exploitable." });
  }

  // ---- Volume mensuel des devis (mission #10.5, déjà calculé par calculerVolumeMensuelDevisV1) ----
  // Décrit uniquement l'évolution du nombre de devis créés d'un mois à
  // l'autre — jamais un jugement sur le résultat de ces devis (certains
  // restent en attente au moment du calcul, voir mise en garde de la
  // fonction source).
  if (volumeMensuel && Array.isArray(volumeMensuel.tendance) && volumeMensuel.tendance.length >= 2) {
    const moisRecentV = volumeMensuel.tendance[volumeMensuel.tendance.length - 1];
    const moisPrecedentV = volumeMensuel.tendance[volumeMensuel.tendance.length - 2];
    recommandations.push({
      type: "volume_mensuel",
      titre: "Volume mensuel des devis",
      message: "Le volume de devis créés passe de " + moisPrecedentV.total + " en " + moisPrecedentV.label + " à " + moisRecentV.total + " en " + moisRecentV.label + ".",
      donnees: { moisPrecedent: moisPrecedentV, moisRecent: moisRecentV },
    });
  } else if (volumeMensuel) {
    nonGenerees.push({ type: "volume_mensuel", raison: "Moins de deux mois disponibles dans la série mensuelle déjà calculée." });
  }

  return { recommandations, nonGenerees };
}

// ==================== Intelligence Commerciale V1 — mission #9B ====================
// Motifs de refus structurés. Fonction PURE (aucun fetch, aucun accès DOM,
// aucune modification de l'objet reçu, aucun état global) : reçoit
// exactement le même tableau `devisRecords` déjà chargé par
// chargerDevisPourAnalytics (mission #1) — aucune deuxième source de
// données, aucun nouvel appel Airtable.
//
// RÈGLE CENTRALE (mission) : catégorisation UNIQUEMENT à partir du champ
// structuré `Categorie refus` — jamais à partir de `Motif refus` (texte
// libre), jamais par mot-clé, heuristique ou interprétation sémantique. Un
// devis refusé historique n'ayant que du texte libre dans `Motif refus`
// (avant l'existence de `Categorie refus`) reste STRICTEMENT non catégorisé
// — le convertir automatiquement serait une donnée inventée, jamais une
// donnée déjà validée.
//
// Trois compartiments mutuellement exclusifs pour chaque devis refusé :
//   - Catégorisé         : Categorie refus est l'une des 7 valeurs officielles.
//   - Non catégorisé     : Categorie refus absente/vide/non exploitable
//                          (typiquement un refus antérieur à ce champ).
//   - Catégorie inconnue : Categorie refus a une valeur, mais qui ne
//                          correspond à aucune des 7 valeurs officielles —
//                          jamais fusionnée dans "Autre" ni reconvertie en
//                          "Non précisé" : signalée séparément pour détecter
//                          une incohérence Airtable sans rien inventer (même
//                          esprit que `statutsInconnus` en mission #1).
//
// Identité garantie : totalRefus = totalCategorises + nonCategorises + categoriesInconnues.
export function calculerMotifsRefusV1(devisRecords) {
  const CATEGORIES_OFFICIELLES = ["Prix trop élevé", "Délai trop long", "Concurrent choisi", "Projet abandonné / reporté", "Produit / prestation non conforme", "Autre", "Non précisé"];
  const ordreOfficiel = {};
  CATEGORIES_OFFICIELLES.forEach((c, i) => { ordreOfficiel[c] = i; });

  let totalRefus = 0;
  let nonCategorises = 0;
  let categoriesInconnues = 0;
  const compteParCategorie = {};

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    if (f["Devis refusé"] !== true) return; // Validé sans refus, en attente, ou champ faux/null/absent : exclu

    totalRefus += 1;

    const categorie = f["Categorie refus"];
    if (categorie === undefined || categorie === null || categorie === "") {
      nonCategorises += 1;
    } else if (CATEGORIES_OFFICIELLES.includes(categorie)) {
      compteParCategorie[categorie] = (compteParCategorie[categorie] || 0) + 1;
    } else {
      categoriesInconnues += 1;
    }
  });

  const totalCategorises = Object.values(compteParCategorie).reduce((s, n) => s + n, 0);

  const parCategorie = totalCategorises === 0 ? [] : Object.keys(compteParCategorie)
    .map(categorie => ({
      categorie,
      count: compteParCategorie[categorie],
      pourcentage: Math.round((compteParCategorie[categorie] / totalCategorises) * 100),
    }))
    .sort((a, b) => b.count - a.count || ordreOfficiel[a.categorie] - ordreOfficiel[b.categorie]);

  return { totalRefus, totalCategorises, nonCategorises, categoriesInconnues, parCategorie };
}

// ==================== Intelligence Commerciale V2 — mission #10.1 ====================
// Évolution mensuelle du taux de conversion des devis. Fonction PURE, aucun
// fetch — reçoit exactement le même tableau `devisRecords` déjà chargé par
// chargerDevisPourAnalytics (mission #1). Mêmes règles de conversion que la
// mission #1, JAMAIS réinventées :
//   - Convertis  : Statut === "Validé"
//   - Refusés    : "Devis refusé" === true
//   - En attente / statut inconnu : exclus du dénominateur
//   - Taux       : convertis / (convertis + refusés) × 100, arrondi entier,
//                  null si 0 éligible
//
// Fenêtre calendaire : les 6 mêmes mois glissants que calculerPanierMoyenEtTendance
// (mission #2) — même construction, jamais une fenêtre différente (30 jours,
// 90 jours) inventée pour cette mission.
//
// Date utilisée : createdTime (date de création du devis, fournie par
// Airtable au niveau de l'enregistrement, pas dans `fields`) — UNIQUE date
// utilisée pour TOUS les devis de cette fonction, jamais mélangée avec
// "Date validation client" (utilisée par calculerChiffreAffairesSigneV1
// ci-dessous, pour une question différente : le CA signé par mois de
// VALIDATION, pas de création).
export function calculerConversionMensuelleDevis(devisRecords) {
  const maintenant = new Date();
  const moisLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    moisLabels.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const parMoisAcc = {};
  moisLabels.forEach(m => { parMoisAcc[m.key] = { convertis: 0, refuses: 0 }; });

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    const estRefuse = f["Devis refusé"] === true;
    let categorie = null;
    if (estRefuse) categorie = "refuse";
    else if (f.Statut === "Validé") categorie = "converti";
    else return; // en attente ou statut inconnu : exclu, même logique que mission #1

    const dateStr = d && d.createdTime;
    if (!dateStr) return; // pas de date exploitable : exclu de la répartition mensuelle, jamais deviné
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return;
    const key = dateObj.getFullYear() + "-" + String(dateObj.getMonth() + 1).padStart(2, "0");
    if (!parMoisAcc[key]) return; // hors des 6 derniers mois : non affiché (fenêtre glissante fixe)

    if (categorie === "refuse") parMoisAcc[key].refuses += 1;
    else parMoisAcc[key].convertis += 1;
  });

  const tendance = moisLabels.map(m => {
    const a = parMoisAcc[m.key];
    const eligibles = a.convertis + a.refuses;
    return {
      mois: m.key,
      label: m.label,
      convertis: a.convertis,
      refuses: a.refuses,
      eligibles,
      taux: eligibles > 0 ? Math.round((a.convertis / eligibles) * 100) : null,
    };
  });

  return { tendance };
}

// ==================== Intelligence Commerciale V2 — mission #10.2 ====================
// Chiffre d'affaires signé (devis validés). Fonction PURE, aucun fetch.
// Population : Statut === "Validé" uniquement (même définition de "converti"
// que la mission #1). Montant : "Montant HT", exploitable seulement s'il est
// numérique, fini et strictement supérieur à 0 (même règle de validité que
// la mission #2) — un montant invalide est exclu, jamais compté comme 0.
//
// Tendance mensuelle : mêmes 6 mois glissants que calculerPanierMoyenEtTendance,
// et MÊME date que cette fonction — "Date validation client" — car on mesure
// ici le CA signé par mois de VALIDATION, pas par mois de création. Cette
// date n'est JAMAIS réutilisée pour le taux de conversion mensuel (mission
// #10.1 ci-dessus, qui utilise createdTime) : deux questions différentes,
// deux bases temporelles explicitement séparées, jamais mélangées.
export function calculerChiffreAffairesSigneV1(devisRecords) {
  const maintenant = new Date();
  const moisLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    moisLabels.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const parMoisAcc = {};
  moisLabels.forEach(m => { parMoisAcc[m.key] = { caHT: 0, nombreDevis: 0 }; });

  let totalHT = 0;
  let nombreDevis = 0;

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    if (f.Statut !== "Validé") return;

    const montant = f["Montant HT"];
    if (typeof montant !== "number" || !isFinite(montant) || montant <= 0) return;

    totalHT += montant;
    nombreDevis += 1;

    const dateStr = f["Date validation client"];
    if (!dateStr) return;
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return;
    const key = dateObj.getFullYear() + "-" + String(dateObj.getMonth() + 1).padStart(2, "0");
    if (!parMoisAcc[key]) return;
    parMoisAcc[key].caHT += montant;
    parMoisAcc[key].nombreDevis += 1;
  });

  const tendance = moisLabels.map(m => ({
    mois: m.key,
    label: m.label,
    caHT: Math.round(parMoisAcc[m.key].caHT * 100) / 100,
    nombreDevis: parMoisAcc[m.key].nombreDevis,
  }));

  return {
    totalHT: Math.round(totalHT * 100) / 100,
    nombreDevis,
    panierMoyenHT: nombreDevis > 0 ? Math.round((totalHT / nombreDevis) * 100) / 100 : null,
    tendance,
  };
}

// ==================== Intelligence Commerciale V2 — mission #10.3 ====================
// Panier moyen par mode de création du devis (Manuel / Auto Iko). Fonction
// PURE, aucun fetch. Population : Statut === "Validé" avec "Montant HT"
// exploitable (numérique, fini, > 0) — mêmes règles de validité que les
// missions #1/#2. Groupes identiques à calculerConversionParMode (mission
// #4) : "Manuel", "Auto Iko", ou "Origine inconnue" pour tout Mode absent ou
// différent de ces deux valeurs — jamais rattaché artificiellement à l'un
// des deux modes réels.
//
// IMPORTANT (rappel mission #4) : "Mode" distingue le PARCOURS/INTERFACE
// d'origine du devis, jamais "IA vs humain" — ce module ne doit jamais être
// présenté comme une comparaison de performance ou d'efficacité.
export function calculerPanierMoyenParModeV1(devisRecords) {
  const ORIGINE_INCONNUE = "Origine inconnue";
  const ORDRE = { "Manuel": 0, "Auto Iko": 1, [ORIGINE_INCONNUE]: 2 };
  const parModeAcc = {};

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    if (f.Statut !== "Validé") return;

    const montant = f["Montant HT"];
    if (typeof montant !== "number" || !isFinite(montant) || montant <= 0) return;

    const modeBrut = f.Mode;
    const mode = (modeBrut === "Auto Iko" || modeBrut === "Manuel") ? modeBrut : ORIGINE_INCONNUE;
    if (!parModeAcc[mode]) parModeAcc[mode] = { nombreDevis: 0, totalHT: 0 };
    parModeAcc[mode].nombreDevis += 1;
    parModeAcc[mode].totalHT += montant;
  });

  const parMode = Object.keys(parModeAcc).map(mode => {
    const a = parModeAcc[mode];
    return {
      mode,
      nombreDevis: a.nombreDevis,
      totalHT: Math.round(a.totalHT * 100) / 100,
      panierMoyenHT: a.nombreDevis > 0 ? Math.round((a.totalHT / a.nombreDevis) * 100) / 100 : null,
    };
  }).sort((a, b) => b.nombreDevis - a.nombreDevis || ORDRE[a.mode] - ORDRE[b.mode]);

  return { parMode };
}

// ==================== Intelligence Commerciale V2 — mission #10.4 ====================
// Panier moyen par agence. Fonction PURE, aucun fetch, aucune résolution
// réseau : `nomsAgences` est le même mapping { idAgence: nom } déjà résolu
// par l'appelant (resoudreNomsAgences, dashboard.html — mission #1), jamais
// un nouveau mécanisme de résolution. Population : Statut === "Validé" avec
// "Montant HT" exploitable (numérique, fini, > 0).
//
// Même convention de libellé que calculerTauxConversionDevis (mission #1) :
// pas d'agence renseignée -> "Non renseignée" ; ID présent mais non résolu
// dans nomsAgences -> "Agence inconnue" (jamais fusionnée avec "Non
// renseignée" : deux réalités différentes, jamais un nom inventé).
export function calculerPanierMoyenParAgenceV1(devisRecords, nomsAgences) {
  const map = nomsAgences || {};
  const parAgenceAcc = {};

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    if (f.Statut !== "Validé") return;

    const montant = f["Montant HT"];
    if (typeof montant !== "number" || !isFinite(montant) || montant <= 0) return;

    const idsAgence = Array.isArray(f.Agence) ? f.Agence : [];
    const idAgence = idsAgence[0] || null;
    let label;
    if (!idAgence) label = "Non renseignée";
    else if (map[idAgence]) label = map[idAgence];
    else label = "Agence inconnue";

    if (!parAgenceAcc[label]) parAgenceAcc[label] = { nombreDevis: 0, totalHT: 0 };
    parAgenceAcc[label].nombreDevis += 1;
    parAgenceAcc[label].totalHT += montant;
  });

  const parAgence = Object.keys(parAgenceAcc).map(agence => {
    const a = parAgenceAcc[agence];
    return {
      agence,
      nombreDevis: a.nombreDevis,
      totalHT: Math.round(a.totalHT * 100) / 100,
      panierMoyenHT: a.nombreDevis > 0 ? Math.round((a.totalHT / a.nombreDevis) * 100) / 100 : null,
    };
  }).sort((a, b) => b.nombreDevis - a.nombreDevis || a.agence.localeCompare(b.agence, 'fr'));

  return { parAgence };
}

// ==================== Intelligence Commerciale V2 — mission #10.5 ====================
// Volume mensuel des devis créés. Fonction PURE, aucun fetch. Fenêtre
// calendaire : mêmes 6 mois glissants, même date (createdTime) que
// calculerConversionMensuelleDevis (mission #10.1) — répartition par mois de
// CRÉATION, pas de résultat final.
//
// ATTENTION : décrit le statut ACTUEL des devis créés pendant le mois, pas
// un résultat définitif — un devis "en attente" à la date du calcul peut
// encore évoluer. Aucune conclusion causale à tirer de cette seule donnée.
export function calculerVolumeMensuelDevisV1(devisRecords) {
  const maintenant = new Date();
  const moisLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    moisLabels.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const parMoisAcc = {};
  moisLabels.forEach(m => { parMoisAcc[m.key] = { total: 0, valides: 0, refuses: 0, enAttente: 0 }; });

  (devisRecords || []).forEach(d => {
    const f = d && d.fields || {};
    const dateStr = d && d.createdTime;
    if (!dateStr) return;
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return;
    const key = dateObj.getFullYear() + "-" + String(dateObj.getMonth() + 1).padStart(2, "0");
    if (!parMoisAcc[key]) return;

    parMoisAcc[key].total += 1;
    if (f["Devis refusé"] === true) parMoisAcc[key].refuses += 1;
    else if (f.Statut === "Validé") parMoisAcc[key].valides += 1;
    else parMoisAcc[key].enAttente += 1;
  });

  const tendance = moisLabels.map(m => ({
    mois: m.key,
    label: m.label,
    total: parMoisAcc[m.key].total,
    valides: parMoisAcc[m.key].valides,
    refuses: parMoisAcc[m.key].refuses,
    enAttente: parMoisAcc[m.key].enAttente,
  }));

  return { tendance };
}
