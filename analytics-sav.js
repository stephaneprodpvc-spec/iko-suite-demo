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
