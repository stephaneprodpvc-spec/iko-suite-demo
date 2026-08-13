// trades/menuiserie.js
// Vocabulaire metier "menuiserie" pour Amandine (api/chat-amandine.js).
// Contenu identique a ce qui etait code en dur avant le refactor
// "vocabulaire parametrable" : aucun changement de comportement attendu.

export default {
  trade_id: "menuiserie",

  // Utilise dans l'intro du SYSTEM_PROMPT ("specialiste de la ___")
  nom_metier:
    "la menuiserie (fenetres, coulissants, volets roulants, portails, portes de garage, verandas)",

  // Exemples de produits, utilises dans la description du champ "produit"
  // de l'outil creer_ticket (simple aide au remplissage, pas un enum strict).
  produits: [
    "Fenetre",
    "Coulissant",
    "Volet roulant",
    "Portail",
    "Porte de garage",
    "Veranda",
  ],

  // Pistes de diagnostic de base, injectees telles quelles dans le
  // SYSTEM_PROMPT (section "QUELQUES PISTES DE DIAGNOSTIC DE BASE").
  diagnostics: [
    "Poignee dure ou qui force : souvent un reglage de paumelle ou de galet.",
    "Vitrage embue entre les vitres : signe probable de double vitrage HS.",
    "Volet roulant qui ne repond plus : verifier l'alimentation avant tout.",
  ],

  // Rappel de securite specifique a inclure dans les REGLES ABSOLUES.
  regle_securite:
    "Sur un point de securite (serrure, vitrage), propose toujours une intervention technicien plutot qu'une manipulation par le client.",

  // consulter_historique_ouvertures : seule la menuiserie a un equivalent
  // "metre" dans Airtable pour l'instant (table Metres / Ouvertures Metre).
  historique: {
    disponible: true,
    table_fiches: "Métrés",
    table_details: "Ouvertures Métré",
    champ_lien_fiche: "Métré", // champ multipleRecordLinks sur Ouvertures Métré
    champs_details: {
      repere: "Repère",
      type: "Type",
      pose: "Pose",
      largeur: "Largeur mm",
      hauteur: "Hauteur mm",
      couleur: "Couleur / RAL",
    },
  },
};
