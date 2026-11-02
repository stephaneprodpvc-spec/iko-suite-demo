// trades/plomberie_chauffage.js
// Vocabulaire metier "plomberie / chauffage" pour Amandine (api/chat-amandine.js).
// Nouveau metier ajoute lors de la generalisation du chatbot SAV.

export default {
  trade_id: "plomberie_chauffage",

  nom_metier:
    "la plomberie, le chauffage et la climatisation (chaudieres, chauffe-eau, pompes a chaleur, radiateurs, robinetterie, canalisations, sanitaires, VMC)",

  produits: [
    "Chaudiere",
    "Chauffe-eau",
    "Radiateur",
    "Robinetterie",
    "Canalisation",
    "VMC",
    "Pompe a chaleur",
    "Climatisation",
    "Sanitaires (WC, lavabo, douche)",
  ],

  diagnostics: [
    "Chaudiere qui se met en securite : verifier la pression du circuit avant tout.",
    "Radiateur froid en partie haute mais chaud en bas : signe probable d'air dans le circuit, une purge est a prevoir.",
    "Fuite au niveau d'un raccord : couper l'arrivee d'eau generale si le debit est important, avant l'intervention.",
  ],

  regle_securite:
    "Sur une odeur de gaz ou un malaise (maux de tete, nausees) pres d'un appareil de chauffage : invite le client a aerer, a eteindre l'appareil, a sortir et a appeler les secours (112) ou le numero d'urgence gaz. Sur une fuite d'eau importante : couper l'arrivee d'eau generale, et le courant si l'eau touche des prises, avant toute autre chose, en plus de contacter l'agence.",

  // Pas encore d'equivalent "metre" pour ce metier dans Airtable :
  // l'outil consulter_historique_ouvertures renverra simplement
  // { trouve: false } sans appel Airtable.
  historique: {
    disponible: false,
  },
};
