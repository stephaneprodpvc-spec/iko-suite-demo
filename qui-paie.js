/* qui-paie.js — « Qui paie ? » : décide qui règle le déplacement et la réparation d'un SAV.
   Fichier partagé : chargé par les pages (window.IKO_QUI_PAIE) ET par les tests Node (module.exports).
   Principe : l'IA décide seule quand les preuves sont claires, et met le dossier « à valider » quand c'est douteux.
   Aucun montant inventé : les montants viennent de la fiche client (déplacement) ou du ticket. */
(function (racine, fabrique) {
  var api = fabrique();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else racine.IKO_QUI_PAIE = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // Qui pose chez le client final ? (voir 6-DOCUMENTS/REGLES-FABRICANT-POSEUR-SAV.md)
  var POSE_PAR_ENTREPRISE = { 'fabricant-poseur': true, 'poseur': true, 'fabricant non poseur': false, 'distributeur': false };

  function norm(t) { return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
  function typeActivite(brut) {
    var t = norm(brut);
    if (/non[ -]poseur/.test(t)) return 'fabricant non poseur';
    if (/fabricant.*poseur|poseur.*fabricant/.test(t)) return 'fabricant-poseur';
    if (/fabricant/.test(t)) return 'fabricant non poseur';
    if (/poseur|installateur/.test(t)) return 'poseur';
    if (/distribut|revend/.test(t)) return 'distributeur';
    return 'fabricant-poseur'; // cas par défaut : l'entreprise pose elle-même (comme Falliero)
  }
  // Garantie : « Oui — Facture 123 » / true => sous garantie ; « Non… » / false => hors garantie ; sinon inconnue.
  function etatGarantie(g) {
    if (g === true) return 'oui';
    if (g === false) return 'non';
    var t = norm(g);
    if (!t) return 'inconnue';
    if (/^non|hors|expir|n\/a/.test(t)) return 'non';
    if (/^oui|sous garantie|garanti/.test(t)) return 'oui';
    return 'inconnue';
  }
  function euros(n) { return (Math.round(Number(n) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €'; }

  /* entrees :
       cause            : une des causes SAV de Max
       garantie         : champ « Garantie » du ticket
       typeActivite     : « Type d'activité » de la fiche client (défaut : fabricant-poseur)
       poseurConnu      : true si le poseur externe est identifié (nom)
       nbPhotos         : nombre de photos du ticket (preuves)
       montantDeplacement : « Montant diagnostic HT » de la fiche client (0 / vide = non défini)
       montantEnjeu     : montant du devis/réparation s'il est connu
       modeDecision     : 'ia' (défaut : l'IA décide seule si clair) | 'valider' (toujours à valider)
       seuilValidation  : € ; au-delà, toujours à valider (vide = pas de seuil)
     sortie : { payeur, deplacementFacture, montantDeplacement, prevenirPoseur, certitude, decision, raison, resume, texteFacturation } */
  function decider(e) {
    e = e || {};
    var cause = String(e.cause || '').trim();
    var type = typeActivite(e.typeActivite);
    var pose = POSE_PAR_ENTREPRISE[type];
    var garantie = etatGarantie(e.garantie);
    var photos = Number(e.nbPhotos) || 0;
    var depl = Number(e.montantDeplacement) || 0;
    var enjeu = (Number(e.montantEnjeu) || 0) + depl;

    var r = { payeur: 'a-definir', deplacementFacture: false, prevenirPoseur: false, certitude: 'douteuse', raison: '' };
    var manque = [];

    switch (cause) {
      case 'Défaut produit': case 'Malfaçon fabrication': case 'Pièce défectueuse':
        if (garantie === 'oui') { r.payeur = 'fabricant'; r.certitude = 'claire'; r.raison = 'Défaut du produit et produit sous garantie : le fabricant prend en charge, déplacement compris.'; }
        else if (garantie === 'non') { r.payeur = 'client'; r.deplacementFacture = true; r.certitude = 'claire'; r.raison = 'Défaut du produit mais garantie dépassée ou absente : réparation et déplacement à la charge du client.'; }
        else { r.raison = 'Défaut du produit mais garantie inconnue : à vérifier (date de pose, facture).'; manque.push('garantie'); }
        break;
      case 'Erreur de pose':
        if (pose) { r.payeur = 'entreprise'; r.certitude = 'claire'; r.raison = 'Problème venant de la pose, réalisée par votre entreprise : reprise à votre charge, rien à facturer au client.'; }
        else if (e.poseurConnu) { r.payeur = 'poseur'; r.deplacementFacture = true; r.prevenirPoseur = true; r.certitude = photos > 0 ? 'claire' : 'douteuse'; r.raison = 'Problème venant de la pose faite par un autre professionnel : à lui de reprendre, et déplacement + diagnostic facturés.'; if (!photos) manque.push('photo'); }
        else { r.payeur = 'client'; r.deplacementFacture = true; r.certitude = 'douteuse'; r.raison = 'Problème venant de la pose, mais poseur non identifié : demander qui a posé avant de facturer.'; manque.push('poseur'); }
        break;
      case 'Mauvaise utilisation client': case 'Usure normale':
        r.payeur = 'client'; r.deplacementFacture = true;
        if (photos > 0) { r.certitude = 'claire'; r.raison = (cause === 'Usure normale' ? 'Usure normale' : 'Mauvaise utilisation') + ' constatée avec photos à l\'appui : réparation et déplacement à la charge du client.'; }
        else { r.raison = (cause === 'Usure normale' ? 'Usure normale' : 'Mauvaise utilisation') + ' signalée mais sans photo : ajouter une preuve avant de facturer.'; manque.push('photo'); }
        break;
      case 'Réglage':
        if (pose && garantie !== 'non') { r.payeur = 'entreprise'; r.certitude = 'claire'; r.raison = 'Simple réglage sur une pose de votre entreprise : à votre charge, rien à facturer.'; }
        else { r.raison = 'Réglage : difficile de savoir si la pose ou l\'usage est en cause, à trancher.'; }
        break;
      case 'SAV préventif':
        r.payeur = 'contrat'; r.certitude = 'claire'; r.raison = 'Visite d\'entretien : réglée selon le contrat d\'entretien du client.'; break;
      case 'Casse transport':
        r.payeur = 'selon-conditions'; r.raison = 'Casse au transport : dépend des conditions de vente et du transporteur, à trancher.'; break;
      default:
        r.raison = cause ? 'Cause « ' + cause + ' » : pas de règle automatique, à trancher.' : 'Aucune cause choisie : impossible de décider.'; if (!cause) manque.push('cause');
    }

    if (r.deplacementFacture && depl > 0) r.montantDeplacement = depl;
    // Décision : l'IA décide seule si c'est clair ; sinon, ou si le réglage / le montant l'impose, c'est au responsable.
    var raisonValider = '';
    if (r.certitude !== 'claire') raisonValider = 'cas douteux';
    else if (e.modeDecision === 'valider') raisonValider = 'réglage de l\'entreprise : tout est validé par le responsable';
    else if (Number(e.seuilValidation) > 0 && enjeu > Number(e.seuilValidation)) raisonValider = 'montant supérieur au seuil de ' + euros(e.seuilValidation);
    r.decision = raisonValider ? 'a_valider' : 'auto';
    r.raisonValidation = raisonValider;
    r.manque = manque;

    var libelle = { fabricant: 'le fabricant', client: 'le client', poseur: 'le poseur', entreprise: 'votre entreprise', contrat: 'le contrat d\'entretien', 'selon-conditions': 'à déterminer', 'a-definir': 'à déterminer' }[r.payeur];
    r.resume = 'Paie : ' + libelle + (r.deplacementFacture ? ' · déplacement facturé' + (depl > 0 ? ' (' + euros(depl) + ' HT)' : '') : '') + ' · ' + (r.decision === 'auto' ? 'décidé automatiquement' : 'à valider');
    r.texteFacturation = (r.deplacementFacture && (r.payeur === 'client' || r.payeur === 'poseur') && depl > 0)
      ? 'Suite au diagnostic, le problème ne relève pas d\'un défaut du produit sous garantie. Le déplacement et le diagnostic (' + euros(depl) + ' HT) sont donc facturés' + (r.payeur === 'poseur' ? ' au poseur' : '') + '.'
      : '';
    return r;
  }

  return { decider: decider, typeActivite: typeActivite, etatGarantie: etatGarantie };
});
