// trades/plomberie_chauffage.js
// Vocabulaire metier "plomberie / chauffage" pour Amandine (api/chat-amandine.js).
// Nouveau metier ajoute lors de la generalisation du chatbot SAV.

export default {
  trade_id: "plomberie_chauffage",

  nom_metier:
    "la plomberie et le chauffage (chaudieres, chauffe-eau, radiateurs, robinetterie, canalisations, VMC)",

  produits: [
    "Chaudiere",
    "Chauffe-eau",
    "Radiateur",
    "Robinetterie",
    "Canalisation",
    "VMC",
  ],

  diagnostics: [
    "Chaudiere qui se met en securite : verifier la pression du circuit avant tout.",
    "Radiateur froid en partie haute mais chaud en bas : signe probable d'air dans le circuit, une purge est a prevoir.",
    "Fuite au niveau d'un raccord : couper l'arrivee d'eau generale si le debit est important, avant l'intervention.",
  ],

  regle_securite:
    "Sur une odeur de gaz ou une fuite importante, invite le client a couper l'arrivee (gaz ou eau) et a aerer avant toute autre chose, en plus de contacter l'agence.",

  // Pas encore d'equivalent "metre" pour ce metier dans Airtable :
  // l'outil consulter_historique_ouvertures renverra simplement
  // { trouve: false } sans appel Airtable.
  historique: {
    disponible: false,
  },
};
