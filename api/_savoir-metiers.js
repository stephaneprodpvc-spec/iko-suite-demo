// api/_savoir-metiers.js
// Base de savoir TECHNIQUE multi-metiers (electricite, plomberie, chauffage, pompe a chaleur / climatisation, ventilation, serrurerie,
// couverture), partagee par Amandine, Max et IKO. Complete _savoir-menuiserie.js (menuiserie exterieure) : meme principe.
// Texte pur, aucun reseau. Connaissances generales et PRUDENTES : jamais de prix, de norme chiffree, de delai, de garantie ni d'aide
// financiere precis (on renvoie vers l'agence) ; jamais de reparation, de demontage ni de manipulation par le client sur un point
// dangereux (electricite, gaz, eau chaude sous pression, toiture) ; jamais de code d'erreur ni de sequence de reglage inventes.
// A FAIRE RELIRE par un professionnel de chaque metier avant de vendre IKO a une entreprise de ce metier.

import { blocSavoir as blocSavoirMenuiserie, famillesPour as famillesMenuiserie, phraseSecurite as phraseSecuriteMenuiserie } from "./_savoir-menuiserie.js";

const FAMILLES = [
  {
    id: "elec-tableau", metier: "Electricite", nom: "Installation electrique : tableau, disjoncteurs, differentiel, coupures de courant",
    mots: ["disjoncteur", "differentiel", "tableau electrique", "fusible", "court-circuit", "court circuit", "disjoncte", "saute", "coupure de courant", "panne de courant", "plus de courant", "compteur", "linky", "contacteur", "heures creuses", "surtension", "parafoudre"],
    pannes: [
      "Le disjoncteur ou le differentiel saute : un appareil defectueux, de l'humidite ou un defaut d'isolement dans un circuit. Client : debrancher les appareils du circuit concerne puis rearmer UNE seule fois ; si cela saute encore, ne pas insister, technicien.",
      "Une partie de la maison n'a plus de courant : disjoncteur divisionnaire ouvert, differentiel declenche, connexion defectueuse. Client : verifier le tableau (levier en bas), rearmer une fois.",
      "Disjoncteur general ou compteur qui coupe en usage normal : puissance souscrite depassee (trop d'appareils en meme temps) ou defaut. Ne pas modifier le reglage, technicien ou fournisseur d'energie.",
      "Odeur de brule, tableau chaud, bruit de crepitement, traces noires : DANGER (echauffement, risque d'incendie). Couper si possible sans risque, ne plus utiliser, technicien en urgence.",
      "Coupure generale du quartier ou du compteur : cela releve du gestionnaire du reseau, pas de l'entreprise. Verifier avec les voisins.",
    ],
    securite: "Le client ne demonte JAMAIS un tableau, une prise ou un appareil, ne touche pas a un fil denude et ne manipule rien avec les mains mouillees. Interdire tout bricolage sur l'installation.",
    demander: "Quel appareil ou quelle piece est concernee ; ce qui s'est passe juste avant (orage, appareil branche, travaux) ; si le differentiel ou un divisionnaire a saute ; depuis quand ; photo du tableau ouvert (sans le demonter) et de l'etiquette des disjoncteurs.",
    urgence: "Urgent : odeur de brule, etincelles, fumee, fil denude, tableau chaud, eau pres de l'electricite, personne en danger. Sinon a planifier (panne partielle sans danger).",
    technicien: "Controles : differentiel et divisionnaires (test), isolement du circuit, appareil en cause, serrage des connexions, echauffement au tableau, mise a la terre. Pieces probables : disjoncteur ou differentiel, prise, cable, parafoudre.",
    categorie: "Electricite",
  },
  {
    id: "elec-prises", metier: "Electricite", nom: "Prises, interrupteurs, eclairage, luminaires",
    mots: ["prise", "interrupteur", "ampoule", "spot", "plafonnier", "luminaire", "variateur", "va-et-vient", "applique", "eclairage", "lumiere", "clignote", "led", "detecteur de presence", "minuterie", "sonnette", "prise de terre"],
    pannes: [
      "Prise sans courant : disjoncteur du circuit declenche, prise ou connexion defectueuse. Client : tester un autre appareil et verifier le tableau, ne pas ouvrir la prise.",
      "Prise ou interrupteur chaud, qui sent le brule, jauni ou noirci : DANGER, ne plus l'utiliser, couper le circuit au tableau, technicien en urgence.",
      "Lumiere qui clignote ou ne s'allume plus : ampoule ou driver LED en fin de vie, transformateur, connexion, variateur incompatible. Client : changer l'ampoule SEULEMENT apres avoir coupe le circuit au tableau.",
      "Spots encastres qui grillent souvent : surchauffe, transformateur ou driver defectueux, tension instable. Technicien.",
      "Interrupteur qui claque ou ne fait plus contact : usure du mecanisme, connexion. Technicien.",
      "Eclairage exterieur ou detecteur de presence qui dysfonctionne : reglage de sensibilite, cellule, etancheite, alimentation. Technicien.",
    ],
    securite: "Toujours couper le circuit au tableau avant de toucher une ampoule ou un luminaire ; ne jamais ouvrir une prise ou un interrupteur ; pas d'intervention avec de l'eau presente.",
    demander: "Quelle piece, quel appareil ou point lumineux ; type d'ampoule ou de luminaire ; depuis quand ; si un disjoncteur a saute ; photo de la prise, de l'interrupteur ou du luminaire (sans l'ouvrir).",
    urgence: "Urgent : chaleur anormale, odeur de brule, etincelles, fil visible, eau a proximite. Non urgent : ampoule ou prise isolee qui ne marche pas.",
    technicien: "Controles : presence de tension, etat des bornes et du serrage, echauffement, compatibilite variateur et lampe, transformateur ou driver, continuite du circuit. Pieces probables : prise, interrupteur, driver LED, ampoule, cable.",
    categorie: "Electricite",
  },
  {
    id: "elec-equipements", metier: "Electricite", nom: "Equipements electriques : borne de recharge, interphone, visiophone, alarme, detecteur de fumee",
    mots: ["borne de recharge", "wallbox", "recharge", "voiture electrique", "interphone", "visiophone", "portier", "alarme", "detecteur de fumee", "detecteur", "sirene", "domotique", "camera", "videosurveillance", "thermostat connecte", "box"],
    pannes: [
      "Borne de recharge qui ne demarre pas : alimentation ou differentiel declenche, defaut de communication avec le vehicule, carte ou application. Client : verifier le tableau et le cable, sans ouvrir la borne.",
      "Interphone ou visiophone sans son ni image : alimentation, cablage, platine exterieure, parametrage du poste. Technicien.",
      "Alarme qui se declenche seule ou bipe : pile de capteur, porte mal fermee, defaut de zone, batterie de la centrale. Client : relever le message affiche et la zone, sans debrancher la centrale.",
      "Detecteur de fumee qui bipe : pile faible ou encrassement. Remplacer la pile ; s'il y a de la fumee reelle, evacuer et appeler les secours.",
      "Equipement connecte hors ligne : box internet, wifi, alimentation, mise a jour. Verifier d'abord la connexion internet.",
    ],
    securite: "Le client ne demonte pas les equipements sous tension (borne, centrale d'alarme, platine) et ne neutralise jamais un detecteur de fumee durablement.",
    demander: "Marque et modele (etiquette) ; message ou voyant affiche ; depuis quand ; ce qui a change (coupure, orage, mise a jour) ; photo de l'ecran, du voyant et de l'etiquette.",
    urgence: "Urgent : fumee reelle, alarme intrusion a la suite d'une effraction, equipement qui chauffe ou sent le brule. Sinon a planifier.",
    technicien: "Controles : alimentation et protection dediee, differentiel adapte (type), cablage et connexions, communication reseau, parametrage. Pieces probables : alimentation, platine, capteur, carte.",
    categorie: "Equipement electrique",
  },
  {
    id: "plomberie-fuite", metier: "Plomberie", nom: "Fuites d'eau, canalisations, robinetterie, pression",
    mots: ["fuite", "robinet", "mitigeur", "canalisation", "tuyau", "goutte", "degat des eaux", "degats des eaux", "compteur d'eau", "pression d'eau", "joint", "flexible", "raccord", "vanne", "robinet d'arret", "coup de belier", "inondation"],
    pannes: [
      "Robinet ou mitigeur qui goutte : cartouche ou joint use, calcaire. A planifier sauf fuite importante.",
      "Fuite sous un evier ou un lavabo : siphon ou raccord desserre, flexible use. Client : placer un recipient, fermer le robinet d'arret du meuble, ne pas forcer sur les raccords.",
      "Fuite sur une canalisation ou au plafond/mur (tache qui s'etend) : possible fuite encastree ou venant du voisin. Couper l'eau si le debit est important, technicien en urgence.",
      "Pression trop faible : entartrage, vanne partiellement fermee, reducteur de pression, probleme reseau. Verifier sur plusieurs robinets.",
      "Pression trop forte ou bruits dans les tuyaux (coup de belier) : reducteur de pression absent ou defectueux, vannes. Technicien.",
      "Compteur d'eau qui tourne alors que tout est ferme : fuite cachee probable. Technicien en priorite.",
    ],
    securite: "Savoir ou se trouve le robinet d'arret general et le fermer en cas de fuite importante ; couper le courant si l'eau atteint prises ou tableau. Pas de bricolage sur les canalisations sous pression.",
    demander: "Ou est la fuite (piece, appareil, mur ou plafond) ; debit (goutte, filet, jet) ; depuis quand ; si le robinet d'arret a ete ferme ; photo de la fuite, du raccord et du compteur d'eau.",
    urgence: "Urgent : fuite importante ou qui s'aggrave, degat des eaux, eau pres de l'electricite, plus d'eau du tout. Non urgent : goutte a goutte sur un robinet.",
    technicien: "Controles : localisation de la fuite, etat des joints et flexibles, serrage des raccords, pression et reducteur, test d'etancheite, compteur. Pieces probables : cartouche, joint, flexible, siphon, raccord, vanne.",
    categorie: "Plomberie",
  },
  {
    id: "plomberie-sanitaires", metier: "Plomberie", nom: "WC, lavabo, douche, baignoire : evacuations bouchees, chasse d'eau, odeurs",
    mots: ["wc", "toilette", "toilettes", "chasse d'eau", "chasse", "lavabo", "evier", "douche", "baignoire", "bouche", "siphon", "odeur", "evacuation", "ecoulement", "deborde", "remonte", "broyeur", "receveur"],
    pannes: [
      "Evacuation lente ou bouchee (lavabo, douche, evier) : cheveux, graisse, calcaire dans le siphon. Client : nettoyer le siphon accessible a la main, pas de produit chimique agressif.",
      "WC bouche ou qui deborde : objet ou papier en exces. Client : ne pas actionner la chasse si ca monte ; ventouse simple possible, sans produit chimique.",
      "Chasse d'eau qui coule en continu : mecanisme, flotteur ou joint use. A planifier ; fermer le robinet d'arret du WC si ca coule fort.",
      "Odeurs d'egout : siphon desamorce ou seche, ventilation de chute. Verser de l'eau dans les siphons peu utilises.",
      "Remontees d'eau ou debordements dans plusieurs appareils : colonne ou collecteur bouche. Technicien en urgence (curage).",
      "Broyeur ou pompe de relevage bruyant ou en panne : bourrage, clapet, moteur. Debrancher et appeler.",
    ],
    securite: "Pas de melange de produits chimiques, pas de debouchage a pression par le client, gants en cas de remontee d'eaux usees (risque sanitaire).",
    demander: "Quel appareil ; bouche totalement ou ecoulement lent ; depuis quand ; si plusieurs appareils sont touches ; ce qui a ete essaye ; photo de l'appareil et du dessous si accessible.",
    urgence: "Urgent : debordement d'eaux usees, remontees dans plusieurs appareils, seul WC de l'habitation inutilisable. Sinon a planifier.",
    technicien: "Controles : siphon, colonne, regard, ventilation de chute, mecanisme de chasse, broyeur ou pompe. Moyens : furet, haute pression, camera. Pieces probables : mecanisme de chasse, joint, siphon, clapet.",
    categorie: "Sanitaires",
  },
  {
    id: "chauffe-eau", metier: "Plomberie", nom: "Chauffe-eau et ballons d'eau chaude (electrique, thermodynamique, solaire)",
    mots: ["chauffe-eau", "chauffe eau", "ballon", "eau chaude", "cumulus", "thermodynamique", "groupe de securite", "resistance", "anode", "pas d'eau chaude", "eau tiede", "chauffe-eau solaire"],
    pannes: [
      "Plus d'eau chaude : alimentation electrique ou differentiel declenche, resistance ou thermostat defaillant, contacteur jour/nuit. Client : verifier le disjoncteur dedie, ne pas ouvrir l'appareil.",
      "Eau tiede ou quantite insuffisante : entartrage, thermostat regle trop bas, resistance partielle, besoins superieurs a la capacite.",
      "Fuite au groupe de securite (goutte reguliere) : fonctionnement normal en chauffe si c'est une goutte, a verifier ; fuite continue = technicien.",
      "Fuite sur la cuve ou le raccord : appareil a remplacer ou a reprendre, couper l'alimentation en eau et electrique, technicien.",
      "Bruits (sifflement, claquement) : calcaire, pression. Un chauffe-eau qui se deforme ou siffle fort est DANGEREUX : couper l'alimentation et ne pas s'approcher.",
      "Chauffe-eau thermodynamique : bruit de groupe, givre, defaut affiche. Releve le message sans le reinitialiser a la main.",
    ],
    securite: "Eau tres chaude (risque de brulure), appareil sous pression et sous tension : le client ne le demonte pas. En cas de deformation ou sifflement fort : couper l'electricite, ne pas toucher.",
    demander: "Marque et capacite (etiquette) ; electrique, thermodynamique ou solaire ; depuis quand ; message ou voyant ; si le differentiel a saute ; photo de l'etiquette, de l'appareil et du groupe de securite.",
    urgence: "Urgent : fuite importante, appareil qui siffle fort ou se deforme, odeur de brule. Sinon a planifier (plus d'eau chaude, a traiter vite pour le confort).",
    technicien: "Controles : alimentation et protection, thermostat, resistance, anode, groupe de securite, pression, tartre, evacuation. Pieces probables : resistance, thermostat, groupe de securite, anode.",
    categorie: "Chauffe-eau",
  },
  {
    id: "chauffage", metier: "Chauffage", nom: "Chaudiere (gaz, fioul), radiateurs, plancher chauffant, poele",
    mots: ["chaudiere", "radiateur", "chauffage", "thermostat", "purge", "bruleur", "fioul", "gaz", "plancher chauffant", "poele", "granules", "ramonage", "vanne thermostatique", "circulateur", "pression du circuit", "mise en securite", "reservoir", "cheminee", "insert", "convecteur", "seche-serviette"],
    pannes: [
      "Chaudiere en securite ou qui s'arrete : manque de pression du circuit, defaut d'allumage, evacuation, alimentation. Client : relever le message ou le code affiche, verifier la pression au manometre, ne pas ouvrir.",
      "Pas de chauffage : thermostat ou programmation, pile du thermostat, chaudiere en securite, circulateur, vanne. Client : verifier la consigne, les piles et l'alimentation.",
      "Radiateur froid en haut et chaud en bas : de l'air dans le circuit, purge a prevoir. Radiateur froid en bas : boues. Un seul radiateur froid : vanne ou robinet thermostatique bloque.",
      "Bruits (gargouillis, claquements, sifflement) : air, pression, circulateur, dilatation. Technicien.",
      "Pression qui baisse regulierement : fuite sur le circuit ou le vase d'expansion. Technicien.",
      "Poele (bois, granules) : allumage difficile, vitre noircie, defaut affiche, arrivee d'air ou conduit encrasse. Ramonage et entretien reguliers.",
      "Plancher chauffant : zone froide, collecteur, regulation, air. Technicien.",
    ],
    securite: "ODEUR DE GAZ OU MALAISE (maux de tete, nausees) : aerer, couper l'appareil, sortir et appeler les secours ou le numero d'urgence gaz. Le client ne demonte pas le bruleur, ne force pas un redemarrage repete et ne repare pas le conduit.",
    demander: "Marque et modele (etiquette) ; gaz, fioul, electrique, bois ou granules ; message ou code affiche (le recopier tel quel) ; pression au manometre ; depuis quand ; photo de la chaudiere, de l'ecran et de l'etiquette.",
    urgence: "Urgent : odeur de gaz, fuite de fioul, malaise ou detecteur de monoxyde, fumee, plus de chauffage avec froid intense chez un enfant, une personne agee ou fragile. Sinon a planifier.",
    technicien: "Controles : pression et vase d'expansion, allumage et ionisation, evacuation des fumees, circulateur, vannes, sonde et thermostat, entartrage. Pieces probables : circulateur, electrode, carte, sonde, vase d'expansion.",
    categorie: "Chauffage",
  },
  {
    id: "pac-clim", metier: "Chauffage", nom: "Pompe a chaleur et climatisation (split, air/air, air/eau)",
    mots: ["pompe a chaleur", "pac", "climatisation", "clim", "climatiseur", "split", "unite exterieure", "groupe exterieur", "condensats", "gaz frigorigene", "air/air", "air/eau", "souffle chaud", "souffle froid", "givre", "givre", "telecommande", "unite interieure"],
    pannes: [
      "Ne chauffe plus ou ne refroidit plus : consigne, mode, filtres encrasses, defaut affiche, manque de fluide frigorigene, groupe exterieur bloque. Client : verifier le mode, la consigne et nettoyer les filtres accessibles.",
      "Fuite d'eau a l'interieur : evacuation des condensats bouchee ou mal inclinee. Client : ne pas ouvrir, mettre un recipient, technicien.",
      "Groupe exterieur couvert de givre ou de glace : cycle de degivrage normal en hiver ; si la glace persiste, defaut. Ne pas casser la glace.",
      "Bruits ou vibrations : fixations, ventilateur, compresseur. Eteindre si fort, technicien.",
      "Odeurs : filtres ou echangeur encrasses. Entretien annuel recommande.",
      "Defaut affiche (code clignotant) : le recopier, mais ne pas deviner sa signification ni reinitialiser a repetition.",
    ],
    securite: "Appareil sous tension et sous pression : le client ne demonte rien, ne touche pas au circuit frigorifique, et ne monte pas sur un support en hauteur pour atteindre le groupe exterieur.",
    demander: "Marque et modele (etiquette de l'unite interieure et du groupe exterieur) ; chaud, froid ou les deux ; mono-split ou multi-split ; message ou code ; depuis quand ; photos des deux unites et de l'ecran.",
    urgence: "Urgent : odeur de brule, etincelles, fuite d'eau importante sur du materiel electrique. Un manque de froid en canicule chez une personne fragile se traite vite, mais n'est pas un danger immediat.",
    technicien: "Controles : filtres, echangeur, condensats, pression du fluide (reglementation : intervention reservee aux professionnels habilites), ventilateurs, carte et capteurs, alimentation. Pieces probables : condensateur, carte, capteur, ventilateur.",
    categorie: "Pompe a chaleur / climatisation",
  },
  {
    id: "vmc", metier: "Ventilation", nom: "VMC et ventilation (simple flux, double flux, extracteurs, hottes)",
    mots: ["vmc", "ventilation", "bouche d'aeration", "bouche de ventilation", "extracteur", "hotte", "humidite", "moisissure", "condensation", "double flux", "caisson", "aeration", "gaine", "bruit vmc"],
    pannes: [
      "VMC qui ne tourne plus ou ne souffle plus : alimentation, moteur, caisson encrasse, courroie ou turbine. Client : verifier l'alimentation, ne pas ouvrir le caisson.",
      "Humidite, condensation, moisissures : ventilation insuffisante ou bouches obstruees. Client : nettoyer les bouches accessibles (sans les demonter si elles sont reglees).",
      "Bruit ou vibration de la VMC : caisson mal fixe, turbine encrassee, gaine. Technicien.",
      "Mauvaises odeurs ou courants d'air froid par les bouches : equilibrage, clapet anti-retour, entree d'air. Technicien.",
      "VMC double flux : alarme de filtre, echangeur encrasse. Remplacement des filtres selon la notice.",
    ],
    securite: "Ne pas intervenir dans les combles ou sur le caisson en hauteur ; couper l'alimentation avant tout nettoyage d'une bouche.",
    demander: "Type de VMC et marque (etiquette du caisson) ; quelles pieces sont concernees ; depuis quand ; bruit ou absence de souffle ; photo de la bouche et du caisson si accessible.",
    urgence: "Rarement urgent. Urgent seulement en cas d'odeur de brule, de fumee ou de moteur tres chaud.",
    technicien: "Controles : alimentation, moteur et turbine, filtres, gaines et equilibrage, clapets, evacuation. Pieces probables : moteur, turbine, filtres, bouches, gaine.",
    categorie: "Ventilation",
  },
  {
    id: "serrurerie", metier: "Serrurerie", nom: "Serrurerie : serrures, cylindres, portes blindees, controle d'acces",
    mots: ["serrure", "cle", "cylindre", "barillet", "porte claquee", "porte claque", "verrou", "blindee", "porte blindee", "digicode", "badge", "controle d'acces", "multipoints", "bloque dehors", "cle cassee", "porte bloquee", "clef", "gache", "ferme-porte"],
    pannes: [
      "Cle cassee dans la serrure : ne pas forcer ni utiliser de produit. Technicien (extraction, remplacement du cylindre).",
      "Serrure dure ou qui force : mecanisme use ou mal aligne, porte qui a bouge, cylindre sec. Client : ne pas forcer.",
      "Porte claquee ou bloquee dehors : intervention d'ouverture par un professionnel ; verifier qu'aucune personne vulnerable n'est enfermee.",
      "Serrure multipoints qui ne ferme plus : poignee relevee ou crochets bloques, alignement, mecanisme. Technicien.",
      "Porte blindee mal fermee apres effraction ou tentative : securisation en urgence.",
      "Digicode, badge ou lecteur qui ne repond plus : alimentation, pile, programmation. Technicien.",
    ],
    securite: "Ne jamais forcer ni percer une serrure. Si une personne, un enfant ou un animal est enferme dans un local, appeler immediatement les secours (112).",
    demander: "Type de porte (entree, interieure, blindee, garage) ; marque de serrure ou de cylindre si visible ; ce qui s'est passe (cle cassee, porte claquee, effraction) ; si le logement reste securise ; photo de la serrure, de la porte et de la cle.",
    urgence: "Urgent : porte d'entree qui ne se ferme plus ou apres effraction, personne enfermee, client enferme dehors, logement non securisable. Sinon a planifier.",
    technicien: "Controles : cylindre, gache, alignement de la porte, penes et crochets, protection de la serrure. Pieces probables : cylindre, serrure, gache, poignee, cles supplementaires.",
    categorie: "Serrurerie",
  },
  {
    id: "couverture", metier: "Couverture", nom: "Couverture, toiture, gouttieres, etancheite",
    mots: ["toiture", "toit", "tuile", "tuiles", "ardoise", "gouttiere", "gouttieres", "descente d'eau", "fuite de toit", "fuite toiture", "faitage", "zinguerie", "toit terrasse", "etancheite", "mousse", "cheneau", "solin", "lucarne", "cheminee"],
    pannes: [
      "Fuite au plafond apres de la pluie : tuile deplacee ou cassee, solin, gouttiere, noue ou etancheite defaillante. Client : proteger, placer un recipient, ne pas monter sur le toit.",
      "Tuiles ou ardoises deplacees apres une tempete : risque de chute d'element et d'infiltration. Ne pas s'approcher du pied du mur par vent fort.",
      "Gouttiere ou descente qui deborde ou se decroche : feuilles, mauvaise pente, fixations. A planifier ; danger si elle menace de tomber.",
      "Toit terrasse : accumulation d'eau, cloques, fissures, evacuations obstruees. Technicien.",
      "Mousse ou lichen : demoussage et traitement a planifier, pas urgent.",
    ],
    securite: "Le client ne monte JAMAIS sur un toit ni sur une echelle pour verifier. Risque de chute grave. Pas d'intervention par vent ou pluie.",
    demander: "Quel endroit (piece, mur, plafond) ; apres quel evenement ; depuis quand ; type de toit (tuiles, ardoises, bac acier, terrasse) ; photos depuis l'interieur et du sol, jamais depuis le toit.",
    urgence: "Urgent : infiltration importante, element qui menace de tomber, toiture endommagee par une tempete avec pluie annoncee. Sinon a planifier.",
    technicien: "Controles : etat des tuiles et du faitage, solins, noues, gouttieres, ecran de sous-toiture, etancheite des points singuliers. Moyens : nacelle ou echafaudage. Pieces probables : tuiles, solin, crochets, joints, membranes.",
    categorie: "Couverture",
  },
];

const GENERAL = `
METHODE GENERALE pour tout metier du batiment et du depannage (peinture, platrerie, carrelage, maconnerie, isolation, electromenager... meme s'il n'est pas dans la liste : ne dis jamais que tu ne le couvres pas) :
1) Identifier l'equipement ou l'ouvrage, la piece et la matiere. 2) Comprendre le symptome, depuis quand, permanent ou intermittent, et s'il y a eu un evenement (orage, travaux, choc, coupure, degat des eaux). 3) Demander des photos utiles (ensemble + gros plan du defaut + etiquette de l'appareil). 4) Qualifier l'urgence. 5) Enregistrer la demande avec les bonnes informations, sans promettre ni prix ni delai ni garantie.
URGENCE (qualification) : danger pour les personnes (odeur de gaz, fumee, etincelles, malaise, risque de chute, eau pres de l'electricite), impossibilite de securiser ou de chauffer le logement, fuite importante. Dans le doute, traite comme urgent et prevenir l'agence.
CODES D'ERREUR ET REGLAGES : tu ne connais pas la signification exacte du code d'un modele precis ni les sequences de reinitialisation ou de reglage : ne les invente JAMAIS. Fais recopier le code tel quel, demande la photo de l'etiquette, renvoie a la notice ou au technicien.
SECURITE : le client ne demonte rien, ne repare ni l'electricite, ni le gaz, ni une canalisation sous pression, ne monte pas sur un toit ou une echelle et ne force aucun mecanisme.
`;

const normaliser = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'");

// Familles de metiers concernees par un texte (mots-cles), les plus pertinentes d'abord (2 maximum).
export function famillesMetiersPour(texte) {
  const n = " " + normaliser(texte) + " ";
  return FAMILLES
    .map((f) => ({ f, score: f.mots.reduce((s, m) => s + (n.includes(normaliser(m)) ? (/[ -]/.test(m) ? 3 : m.length > 6 ? 2 : 1) : 0), 0) }))
    .filter((x) => x.score > 1 || (x.score === 1 && n.length < 60))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.f);
}

const indexMetiers = () => "METIERS COUVERTS (tu sais repondre sur tous) : " + Array.from(new Set(FAMILLES.map((f) => f.metier))).join(", ") + ". Autres metiers du batiment ou du depannage : meme methode.";

function detail(f, assistant, texte) {
  const mots = Array.from(new Set(normaliser(texte).split(/[^a-z0-9]+/).filter((w) => w.length >= 5)));
  const note = (p) => { const n = normaliser(p); return mots.filter((w) => n.includes(w)).length; };
  const pannes = f.pannes.map((p, i) => ({ p, i, sc: note(p) })).sort((a, b) => b.sc - a.sc || a.i - b.i).map((x) => x.p);
  const l = ["\n### " + f.nom, "Pannes frequentes et pistes (les plus proches de la demande en premier) :", ...pannes.map((p) => "- " + p)];
  if (assistant === "technicien") l.push("Pour le technicien : " + f.technicien);
  else l.push("Informations utiles pour le technicien (FACULTATIVES : ne les demande que si elles ne sont pas deja dans la conversation, en UNE seule question groupee de deux points au plus, et enregistre la demande meme si le client n'y repond pas) : " + f.demander);
  l.push("Securite : " + f.securite, "Urgence : " + f.urgence);
  return l.join("\n");
}

const CONSIGNES = {
  amandine: "Tu es la premiere ligne : une ou deux verifications simples et sures au maximum, puis tu enregistres la demande avec les bonnes informations et la bonne urgence. Jamais de reparation par le client. N'invente et ne suppose JAMAIS une information que le client n'a pas donnee.",
  technicien: "Tu parles a un technicien sur le terrain : va droit aux causes probables, aux controles et aux pieces a prevoir, en 1 a 2 phrases tres courtes. Pour une question technique, reponds avec l'outil reponse_vocale.",
  dashboard: "Tu parles a la direction ou a l'agence : aide a qualifier en 2 phrases (urgence oui/non et pourquoi ; competence technicien necessaire ; informations a recueillir) sans engager l'entreprise sur un prix, un delai ou une garantie.",
};

export function blocSavoirMetiers(assistant, texte, options) {
  const trouvees = famillesMetiersPour(texte);
  const avecPhotos = !!(options && options.photos);
  return "\n\nSAVOIR TECHNIQUE MULTI-METIERS (electricite, plomberie, chauffage, climatisation, ventilation, serrurerie, couverture)\n" + indexMetiers() + "\n" +
    (CONSIGNES[assistant] || CONSIGNES.dashboard) + GENERAL +
    (assistant === "amandine" && avecPhotos ? "\nPHOTOS JOINTES : si le message contient des images, REGARDE-LES vraiment. Confirme en une phrase ce que tu vois sans affirmer un diagnostic certain. Si l'image est floue ou hors sujet, demande-en une meilleure.\n" : "") +
    (trouvees.length ? "\nFICHES CONCERNEES PAR CETTE CONVERSATION :" + trouvees.map((f) => detail(f, assistant, texte)).join("\n") : "");
}

// Point d'entree UNIQUE pour les trois assistants : choisit le savoir de menuiserie, des autres metiers, ou les deux, selon la conversation
// et le metier du client s'il est connu (options.trade : "menuiserie", "plomberie_chauffage", "electricite", "generaliste"...).
export function blocSavoirTous(assistant, texte, options) {
  const trade = options && options.trade;
  const menuiserie = famillesMenuiserie(texte).length > 0;
  const autres = famillesMetiersPour(texte).length > 0;
  if (menuiserie && autres) return blocSavoirMenuiserie(assistant, texte, options) + blocSavoirMetiers(assistant, texte, options);
  if (autres) return blocSavoirMetiers(assistant, texte, options);
  if (menuiserie) return blocSavoirMenuiserie(assistant, texte, options);
  // Rien de precis dans la conversation : on donne l'index du metier du client.
  if (trade && trade !== "menuiserie") return blocSavoirMetiers(assistant, texte, options);
  return blocSavoirMenuiserie(assistant, texte, options);
}

// Consignes de SECURITE posees par le serveur (et non par le modele) pour les metiers hors menuiserie.
export function phraseSecuriteMetiers(texte) {
  const n = " " + normaliser(texte) + " ";
  const a = (re) => re.test(n);
  const phrases = [];
  if (a(/odeur de gaz|sent le gaz|fuite de gaz|ca sent le gaz/)) phrases.push("Par securite : n'allumez aucune flamme, n'actionnez aucun interrupteur, ouvrez les fenetres, quittez les lieux et appelez le numero d'urgence gaz ou les secours (112) depuis l'exterieur.");
  if (a(/monoxyde|detecteur de co\b|alarme co\b/) || (a(/maux de tete|nausee|malaise|vertige/) && a(/chaudiere|poele|chauffe-eau|chauffage|cheminee|insert/))) phrases.push("Par securite : aerez, eteignez l'appareil, sortez et appelez les secours (112) si quelqu'un a des maux de tete, des nausees ou un malaise.");
  if (a(/odeur de brule|sent le brule|fumee|etincelle|crepite|fil denude|fils denudes|tableau (electrique )?(chaud|qui chauffe)/) && a(/prise|tableau|disjoncteur|cable|fil|electri|compteur|interrupteur|luminaire|spot|chauffe-eau|appareil/)) phrases.push("Par securite : coupez le courant au disjoncteur general si vous pouvez le faire sans risque, ne touchez ni la prise ni le cable, et appelez les secours (18 ou 112) en cas de fumee ou de flammes.");
  if (a(/inondation|degat des eaux|fuite importante|ca coule partout|plafond qui goutte beaucoup|plus de fuite que/)) phrases.push("Par securite : coupez l'arrivee d'eau generale (robinet d'arret ou compteur) et, si de l'eau touche des prises ou le tableau, coupez le courant.");
  if (a(/chauffe-eau|ballon/) && a(/siffle|sifflement|explos|gonfle|deforme|chaud au toucher|brule/)) phrases.push("Par securite : ne touchez pas au chauffe-eau, coupez son alimentation electrique si vous pouvez le faire sans risque et eloignez-vous.");
  if (a(/porte|serrure|piece|salle|local|voiture/) && a(/enferme|coince dedans|bloque dedans/) && a(/enfant|bebe|animal|personne|vieux|age/)) phrases.push("Si une personne ou un enfant est enferme, appelez immediatement les secours (112).");
  return phrases.slice(0, 2).join(" ");
}

// Menuiserie ET autres metiers : deux phrases au plus, les plus graves d'abord.
export function phraseSecuriteTous(texte) {
  const autres = phraseSecuriteMetiers(texte);
  const menu = phraseSecuriteMenuiserie(texte);
  const toutes = [autres, menu].filter(Boolean).join(" ");
  // Evite deux fois la meme consigne (enfermement) et reste court.
  return toutes.split(/(?<=\.)\s+/).filter((p, i, arr) => arr.indexOf(p) === i).slice(0, 2).join(" ");
}

export const FAMILLES_METIERS = FAMILLES.map((f) => ({ id: f.id, nom: f.nom, metier: f.metier, categorie: f.categorie }));
