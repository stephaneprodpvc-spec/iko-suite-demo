// trades/electricite.js
// Vocabulaire metier "electricite" pour Amandine (api/chat-amandine.js). Le savoir detaille est dans _savoir-metiers.js.
// A faire relire par un electricien avant de proposer IKO a une entreprise d'electricite.

export default {
  trade_id: "electricite",

  nom_metier:
    "l'electricite du batiment (tableaux, disjoncteurs, prises, eclairage, bornes de recharge, interphones et visiophones, alarmes, detecteurs de fumee)",

  produits: [
    "Tableau electrique",
    "Disjoncteur / differentiel",
    "Prise ou interrupteur",
    "Eclairage / luminaire",
    "Borne de recharge",
    "Interphone / visiophone",
    "Alarme / detecteur de fumee",
    "Autre equipement electrique",
  ],

  diagnostics: [
    "Disjoncteur ou differentiel qui saute : demander quel appareil etait utilise, si de l'humidite est en cause, et conseiller de rearmer UNE seule fois apres avoir debranche les appareils du circuit.",
    "Prise ou interrupteur sans courant : verifier d'abord le tableau (levier en bas) et tester un autre appareil, sans jamais ouvrir la prise.",
    "Lumiere qui clignote : ampoule ou driver LED en fin de vie ; ne changer l'ampoule qu'apres avoir coupe le circuit au tableau.",
  ],

  regle_securite:
    "Odeur de brule, fumee, etincelles, fil denude, tableau chaud ou eau pres de l'electricite : invite le client a couper le courant au disjoncteur general s'il peut le faire sans risque, a ne rien toucher et a appeler les secours (18 ou 112) en cas de fumee ou de flammes, en plus de prevenir l'agence. Le client ne demonte jamais une prise, un tableau ou un appareil.",

  historique: {
    disponible: false,
  },
};
