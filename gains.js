// gains.js — « Ce que IKO vous fait gagner » et « Retour qualité fabricant ».
// Module partagé (écrans + tests), sans dépendance. Aucun chiffre inventé : tout vient des tickets et des devis réels.
(function (racine, fabrique) {
  if (typeof module === "object" && module.exports) module.exports = fabrique();
  else racine.IKOGains = fabrique();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function nombre(v) {
    const n = parseFloat(String(v === undefined || v === null ? "" : v).replace(",", "."));
    return isFinite(n) ? n : 0;
  }
  function arrondi(n) { return Math.round(n * 100) / 100; }

  // Détail « Qui paie ? » gardé sur le ticket (JSON), jamais d'exception.
  function lireDetail(t) {
    try {
      const j = JSON.parse((t && t.fields && t.fields["Qui paie détail"]) || "null");
      return j && typeof j === "object" ? j : null;
    } catch (e) { return null; }
  }

  // Bornes d'une période : "mois" (mois en cours), "3mois", "12mois", "tout". Retourne { debut, fin } (Date ou null).
  function bornes(mode, maintenant) {
    const n = maintenant ? new Date(maintenant) : new Date();
    const fin = new Date(n.getFullYear(), n.getMonth() + 1, 1);
    if (mode === "mois") return { debut: new Date(n.getFullYear(), n.getMonth(), 1), fin };
    if (mode === "3mois") return { debut: new Date(n.getFullYear(), n.getMonth() - 2, 1), fin };
    if (mode === "12mois") return { debut: new Date(n.getFullYear(), n.getMonth() - 11, 1), fin };
    return { debut: null, fin: null };
  }
  function dansPeriode(date, p) {
    if (!p || (!p.debut && !p.fin)) return true;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return false;
    if (p.debut && d < p.debut) return false;
    if (p.fin && d >= p.fin) return false;
    return true;
  }
  const clos = (t) => ["Annulé", "Supprimé"].includes(t && t.fields && t.fields.Statut);

  // Un déplacement facturé à un tiers (client, poseur ou fabricant) doit être encaissé : « à encaisser » tant que personne ne l'a marqué payé.
  function estADecaisser(q) {
    return !!q && ["auto", "valide"].includes(q.decision) && q.deplacementFacture === true && ["client", "poseur", "fabricant"].includes(q.payeur);
  }
  function statutPaiement(q) {
    if (!estADecaisser(q)) return "sans_objet";
    return q.paiement && q.paiement.statut === "paye" ? "paye" : "a_encaisser";
  }

  // Cœur des gains : tickets (déjà chargés), devis signés (table Devis, Statut = Validé), période.
  function calculerGains(tickets, devisSignes, periode) {
    const r = {
      nbTickets: 0, nbTermines: 0,
      quiPaie: { total: 0, auto: 0, validesResponsable: 0, aValider: 0, chargeEntreprise: 0 },
      deplacementsFactures: { nb: 0, montant: 0, parPayeur: {} },
      aEncaisser: { nb: 0, montant: 0 }, payes: { nb: 0, montant: 0 },
      devisSignes: { nb: 0, montantTTC: 0 },
      encaisseSurPlace: 0, fraisDiagnostic: 0,
    };
    (tickets || []).forEach((t) => {
      if (!t || clos(t)) return;
      const f = t.fields || {};
      const q = lireDetail(t);
      const dateRef = (q && q.date) || t.createdTime;
      if (!dansPeriode(dateRef, periode)) return;
      r.nbTickets++;
      if (f.Statut === "Terminé") r.nbTermines++;
      r.encaisseSurPlace += nombre(f["Montant encaissé"]);
      r.fraisDiagnostic += nombre(f["Frais diagnostic facturés"]);
      if (!q) return;
      r.quiPaie.total++;
      if (q.decision === "auto") r.quiPaie.auto++;
      else if (q.decision === "valide") r.quiPaie.validesResponsable++;
      else if (q.decision === "valide_a_charge_entreprise") r.quiPaie.chargeEntreprise++;
      else if (q.decision === "a_valider") r.quiPaie.aValider++;
      if (estADecaisser(q)) {
        const m = nombre(q.montantDeplacement);
        r.deplacementsFactures.nb++;
        r.deplacementsFactures.montant += m;
        r.deplacementsFactures.parPayeur[q.payeur] = (r.deplacementsFactures.parPayeur[q.payeur] || 0) + 1;
        if (statutPaiement(q) === "paye") { r.payes.nb++; r.payes.montant += m; }
        else { r.aEncaisser.nb++; r.aEncaisser.montant += m; }
      }
    });
    (devisSignes || []).forEach((d) => {
      const f = (d && d.fields) || {};
      if (!dansPeriode(f["Date validation client"], periode)) return;
      r.devisSignes.nb++;
      r.devisSignes.montantTTC += nombre(f["Montant TTC"]);
    });
    r.encaisseSurPlace = arrondi(r.encaisseSurPlace);
    r.fraisDiagnostic = arrondi(r.fraisDiagnostic);
    r.deplacementsFactures.montant = arrondi(r.deplacementsFactures.montant);
    r.aEncaisser.montant = arrondi(r.aEncaisser.montant);
    r.payes.montant = arrondi(r.payes.montant);
    r.devisSignes.montantTTC = arrondi(r.devisSignes.montantTTC);
    return r;
  }

  // Temps gagné : uniquement avec les hypothèses SAISIES par le patron (minutes par dossier, taux horaire). Sinon null (rien d'inventé).
  function tempsGagne(nbDossiers, minutesParDossier, tauxHoraire) {
    const m = nombre(minutesParDossier);
    if (!(m > 0) || !(nbDossiers > 0)) return null;
    const heures = arrondi((nbDossiers * m) / 60);
    const t = nombre(tauxHoraire);
    return { heures, euros: t > 0 ? arrondi(heures * t) : null };
  }

  // Tickets « à encaisser » (liste pour l'écran), du plus ancien au plus récent.
  function listeAEncaisser(tickets) {
    return (tickets || []).filter((t) => !clos(t) && statutPaiement(lireDetail(t)) === "a_encaisser")
      .sort((a, b) => String(a.createdTime || "").localeCompare(String(b.createdTime || "")));
  }

  // ---- Retour qualité (rapport pour le fabricant) ----
  function cle(v) { return String(v || "").trim().toLowerCase().replace(/\s+/g, " "); }
  function majuscule(s) { s = String(s || "").trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  const CAUSES_FABRICANT = ["Défaut produit", "Malfaçon", "Pièce défectueuse"];

  function agregerRetourQualite(tickets, periode) {
    const parProduit = new Map();
    let total = 0, clotures = 0, sansCause = 0;
    (tickets || []).forEach((t) => {
      if (!t || clos(t)) return;
      const f = t.fields || {};
      if (!dansPeriode(t.createdTime, periode)) return;
      total++;
      if (f.Statut === "Terminé") clotures++;
      const nomProduit = majuscule(f.Produit) || "Produit non précisé";
      const k = cle(nomProduit);
      if (!parProduit.has(k)) parProduit.set(k, { produit: nomProduit, total: 0, causes: {}, garantie: 0, pieces: {}, poseurs: {} });
      const l = parProduit.get(k);
      l.total++;
      const cause = String(f["Cause SAV"] || "").trim();
      if (!cause) sansCause++;
      const nomCause = cause || "Non renseignée";
      l.causes[nomCause] = (l.causes[nomCause] || 0) + 1;
      if (/^oui/i.test(String(f.Garantie || ""))) l.garantie++;
      const piece = String(f["Pièce à commander"] || "").trim();
      if (piece) { const kp = majuscule(piece.slice(0, 80)); l.pieces[kp] = (l.pieces[kp] || 0) + 1; }
      const poseur = String(f.Poseur || "").trim();
      if (poseur) l.poseurs[poseur] = (l.poseurs[poseur] || 0) + 1;
    });
    const lignes = Array.from(parProduit.values()).map((l) => {
      const dontFabricant = CAUSES_FABRICANT.reduce((a, c) => a + (l.causes[c] || 0), 0);
      return Object.assign({}, l, { dontFabricant, dontPose: l.causes["Erreur de pose"] || 0, dontUtilisation: (l.causes["Mauvaise utilisation"] || 0) + (l.causes["Usure"] || 0) });
    }).sort((a, b) => b.total - a.total || a.produit.localeCompare(b.produit, "fr"));
    return { total, clotures, sansCause, lignes };
  }

  function csvEchapper(v) {
    const s = String(v === undefined || v === null ? "" : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvRetourQualite(rapport) {
    const ligne = (a) => a.map(csvEchapper).join(";");
    const sortie = [ligne(["Produit", "Nombre de SAV", "Dont défaut produit/pièce/malfaçon", "Dont erreur de pose", "Dont mauvaise utilisation/usure", "Sous garantie", "Pièces citées"])];
    rapport.lignes.forEach((l) => {
      sortie.push(ligne([l.produit, l.total, l.dontFabricant, l.dontPose, l.dontUtilisation, l.garantie,
        Object.keys(l.pieces).sort((a, b) => l.pieces[b] - l.pieces[a]).map((p) => p + " (x" + l.pieces[p] + ")").join(" | ")]));
    });
    return sortie.join("\r\n");
  }

  return { lireDetail, bornes, dansPeriode, estADecaisser, statutPaiement, calculerGains, tempsGagne, listeAEncaisser, agregerRetourQualite, csvRetourQualite };
});
