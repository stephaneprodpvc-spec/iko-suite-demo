// trades/generaliste.js
// Vocabulaire "metier non liste / multi-metiers" (champ Metier = Autre) : batiment et depannage en general.
// Le savoir detaille (electricite, plomberie, chauffage, climatisation, ventilation, serrurerie, couverture) est dans _savoir-metiers.js
// et se declenche d'apres les mots du client.

export default {
  trade_id: "generaliste",

  nom_metier:
    "le batiment et le depannage a domicile (electricite, plomberie, chauffage, climatisation, ventilation, serrurerie, couverture, menuiserie et autres corps de metier)",

  produits: [
    "Installation electrique",
    "Plomberie / fuite",
    "Chauffe-eau",
    "Chaudiere / chauffage",
    "Pompe a chaleur / climatisation",
    "VMC / ventilation",
    "Serrure / porte",
    "Toiture / gouttiere",
    "Menuiserie (fenetre, volet, porte)",
    "Autre",
  ],

  diagnostics: [
    "Toujours identifier d'abord l'equipement concerne, la piece, depuis quand et s'il y a eu un evenement (orage, travaux, degat des eaux).",
    "Pour toute panne d'un appareil : demander la marque et le modele (etiquette) et recopier tel quel le message ou le code affiche, sans l'interpreter.",
    "En cas de fuite : demander le debit (goutte, filet, jet) et si l'arrivee d'eau a pu etre fermee.",
  ],

  regle_securite:
    "Sur une odeur de gaz, de brule, de la fumee, des etincelles, un malaise ou une fuite importante : invite le client a couper l'arrivee concernee (gaz, eau ou courant) si c'est sans risque, a aerer, a s'eloigner et a appeler les secours (112) ou le numero d'urgence adapte, en plus de contacter l'agence. Le client ne repare rien lui-meme.",

  historique: {
    disponible: false,
  },
};
