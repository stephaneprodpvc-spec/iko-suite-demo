// api/_savoir-menuiserie.js
// Base de savoir TECHNIQUE par famille de produits (menuiserie exterieure alu / PVC et fermetures), partagee par Amandine, Max et IKO.
// Texte pur, aucun reseau. Principe : connaissances generales et PRUDENTES. Jamais de prix, de norme, de delai, de garantie ni d'aide
// financiere precis : on renvoie vers l'agence. Jamais de conseil de demontage ni de reparation par le client sur un point dangereux.
// Fonctionnement : un INDEX court est toujours donne ; le detail des familles concernees par la conversation (mots-cles) est ajoute.

const FAMILLES = [
  {
    id: "fenetre", nom: "Fenetres et portes-fenetres (PVC ou alu : battante, oscillo-battante, a la francaise, soufflet, fixe)",
    mots: ["fenetre", "porte-fenetre", "porte fenetre", "chassis", "oscillo", "vitrage", "double vitrage", "vitre", "buee", "condensation", "poignee", "cremone", "paumelle", "courant d'air", "siffle", "sifflement", "infiltration"],
    pannes: [
      "Ferme mal / frotte / poignee dure : affaissement de l'ouvrant, paumelles a regler, gache desalignee, cremone ou poignee usee. Client : verifier qu'aucun obstacle ne gene, ne pas forcer. Technicien : reglage des paumelles (hauteur, lateral, compression), gaches, graissage de la quincaillerie.",
      "Poignee qui tourne dans le vide ou bloquee : mecanisme de cremone casse, ou ouvrant reste en position oscillo. Ne pas forcer. Technicien.",
      "Ouvrant qui decroche ou tient mal en oscillo-battant (souvent apres une fausse manoeuvre de poignee) : DANGER de chute, ne plus manipuler la fenetre. Technicien en priorite.",
      "Courant d'air / sifflement / bruit : joints uses ou decolles, ouvrant mal regle, calfeutrement de pose degrade. Client : verifier que les joints sont propres et en place.",
      "QUESTION CLE devant de la buee ou de l'humidite sur une vitre : est-elle du cote de la piece (on peut l'essuyer avec un chiffon : c'est de la condensation, souvent liee a la ventilation) ou ENTRE les deux vitres (impossible a essuyer : le double vitrage est defaillant) ? Pose cette question avant de conclure.",
      "Buee ENTRE les deux vitres : joint du double vitrage defaillant, le vitrage est a remplacer (pas urgent). Condensation cote interieur : surtout un manque de ventilation, pas forcement un defaut de la fenetre.",
      "Vitrage fele ou casse : risque de coupure. Mise en securite (eloigner, proteger, ne pas toucher aux eclats). Fele sans choc : contrainte thermique ou de pose, a faire constater. Technicien / vitrier.",
      "Eau qui entre : evacuations d'eau du dormant obstruees (nettoyage doux des petites fentes en bas, sans danger), joint, calfeutrement. Si persiste : technicien.",
      "Specifique alu : condensation sur le profil, traces blanches de corrosion (surtout en bord de mer). Specifique PVC : jaunissement, deformation sous forte chaleur (teintes foncees).",
    ],
    securite: "Ne jamais demonter un ouvrant ni un vitrage soi-meme. Fenetre en hauteur ou etage : risque de chute, pas d'intervention du client.",
    demander: "PVC ou alu ; type d'ouverture ; etage ; depuis quand ; pour de la buee : cote piece (essuyable) ou entre les vitres ;  photo d'ensemble + gros plan du defaut + poignee ; marque ou date d'installation si connue.",
    urgence: "Urgent : ouvrant qui menace de tomber, vitre cassee, impossibilite de fermer une fenetre accessible (securite du logement). Non urgent : courant d'air leger, bruit, condensation, buee.",
    technicien: "Controles : paumelles et gaches (regler), cremone, joints (etat, continuite), evacuations d'eau, calage et etat du vitrage, equerrage de l'ouvrant. Pieces probables : joints, poignee/cremone, paumelles, vitrage.",
    categorie: "Fenetre",
  },
  {
    id: "coulissant", nom: "Baies et portes coulissantes (rail, galets, galandage, levant-coulissant)",
    mots: ["coulissant", "coulissante", "baie", "galet", "galets", "rail", "chariot", "galandage", "levant"],
    pannes: [
      "Dur a ouvrir : rail encrasse (poussiere, gravillons), galets uses, vantail lourd qui s'affaisse. Client : aspirer et nettoyer le rail avec un chiffon (sans produit gras), ne pas forcer.",
      "Ne ferme pas / ne verrouille pas : gache ou fermeture desalignee, hauteur des galets a regler.",
      "Fuite d'eau dans le rail : evacuations bouchees (nettoyer les petits orifices), joint brosse use.",
      "Vantail qui deraille ou sort du rail : DANGER (vitrage tres lourd). Ne pas tenter de le remettre seul. Technicien.",
      "Levant-coulissant : la poignee leve le vantail ; poignee tres dure ou vantail qui frotte = reglage ou galets, technicien (tres lourd).",
      "Bruit / grincement : rail sale, galets uses, brosses (joints) uses.",
    ],
    securite: "Les vantaux vitres sont tres lourds : ne jamais les manipuler seul ni les deposer.",
    demander: "PVC ou alu ; une ou deux voies, galandage ou non ; depuis quand ; photo du rail (en bas) et du galet/poignee si visible.",
    urgence: "Urgent : vantail decroche ou instable, impossibilite de fermer une baie accessible. Sinon non urgent.",
    technicien: "Controles : galets (usure, reglage en hauteur), rail (usure, propreté), evacuations, fermeture/gache, joints brosses. Pieces probables : jeu de galets, joints brosses, gache, poignee.",
    categorie: "Coulissant",
  },
  {
    id: "porte_entree", nom: "Portes d'entree et portes de service (serrure, cylindre, multipoints, seuil)",
    mots: ["porte d'entree", "porte entree", "porte de service", "serrure", "cylindre", "cle", "clef", "multipoints", "seuil", "gache", "entree"],
    pannes: [
      "Cle dure ou qui ne tourne pas : cylindre use ou mal aligne, serrure multipoints desalignee. Ne pas forcer, pas d'huile epaisse.",
      "Porte qui frotte ou ne ferme plus : paumelles ou affaissement. Porte qui ne verrouille plus = logement non securise.",
      "Verrouillage multipoints impossible : poignee non relevee, gache desalignee, serrure.",
      "Personne enfermee dehors ou dedans, enfant/animal enferme : prioritaire. Ne pas casser ; faire intervenir.",
      "Cle cassee dans la serrure, cylindre force : technicien (securite). Apres effraction : le client previent son assureur et l'agence.",
      "Infiltration ou courant d'air au seuil ou en bas de porte : joint, seuil a regler, etancheite de pose.",
    ],
    securite: "Une porte d'entree qui ne se verrouille plus est un probleme de securite : traiter en priorite.",
    demander: "Matiere (alu, PVC, acier, bois) ; serrure multipoints ou simple ; depuis quand ; photo de la serrure/cylindre, des paumelles, du seuil.",
    urgence: "Urgent : porte qui ne ferme ou ne verrouille plus, personne enfermee, effraction, cle cassee. Non urgent : leger courant d'air.",
    technicien: "Controles : paumelles (3 axes), gaches, serrure et cylindre, joints, seuil. Pieces probables : cylindre, serrure multipoints, gache, joints, paumelles.",
    categorie: "Porte d'entree",
  },
  {
    id: "volet_roulant", nom: "Volets roulants (electrique filaire, radio, solaire, manuel)",
    mots: ["volet roulant", "volets roulants", "volet", "volets", "tablier", "coffre", "lame", "lames", "sangle", "manivelle", "fin de course", "telecommande", "enrouleur"],
    pannes: [
      "Ne bouge pas du tout (volet sur secteur) : alimentation (disjoncteur, prise, interrupteur), pile de la telecommande, emetteur non appaire. Client : verifier ces trois points, rien d'autre. SI LE VOLET EST SOLAIRE : pas de disjoncteur a verifier, regarder le panneau solaire (propre, ensoleille) et la batterie.",
      "Le moteur ronfle sans que le volet bouge : moteur ou axe a controler. Technicien.",
      "Bloque a mi-hauteur : lames deformees, coulisses encrassees, obstacle, fin de course mal regle. Ne pas forcer ni tirer a la main.",
      "S'arrete tout seul : protection thermique du moteur (laisser refroidir quelques minutes) ou fin de course mal regle.",
      "Tablier de travers : lames desaxees ou attaches rompues. Technicien.",
      "Le volet tombe d'un coup ou descend seul : attaches ou verrous rompus, DANGER, ne pas passer dessous. Technicien en priorite.",
      "Volet manuel : sangle usee ou cassee, enrouleur de sangle a remplacer. Volet solaire : panneau solaire sale ou batterie faible.",
      "Bruit / frottement : coulisses sales (nettoyer sans produit gras), lames qui frottent.",
    ],
    securite: "Moteur sous tension : le client n'ouvre jamais le coffre et ne touche pas au cablage. Ne jamais forcer un volet bloque.",
    demander: "Manuel, filaire, radio ou solaire ; a quelle hauteur il se bloque ; depuis quand ; photo du tablier, du coffre, de la telecommande.",
    urgence: "Urgent : volet qui tombe ou menace de tomber, volet RDC bloque ouvert (securite) avec impossibilite de fermer. Sinon non urgent.",
    technicien: "Controles : alimentation et commande, moteur (thermique, bruit), axe et embouts, fin de course (reglage), lames et attaches, coulisses. Pieces probables : moteur, recepteur radio, attaches de lames, sangle, lames, fins de course.",
    categorie: "Volet roulant",
  },
  {
    id: "volet_battant", nom: "Volets battants et persiennes (gonds, pentures, espagnolette, lames)",
    mots: ["volet battant", "volets battants", "persienne", "persiennes", "penture", "gond", "espagnolette", "battants", "volet battant motorise", "volets battants motorises"],
    pannes: [
      "Ferme mal / affaisse / frotte : gonds ou pentures desserres, battant desaxe.",
      "Lames cassees ou decollees, arrets (tiges, butees) manquants : le volet claque au vent.",
      "Espagnolette ou barre qui ne bloque plus : volet non maintenu ferme.",
    ],
    securite: "Un volet qui peut se decrocher a l'etage est un risque de chute : ne plus l'utiliser, technicien.",
    demander: "Alu, PVC ou autre ; nombre de vantaux ; etage ; photo des gonds et du point de blocage.",
    urgence: "Urgent : volet qui menace de tomber. Sinon non urgent.",
    technicien: "Controles : fixations, gonds/pentures, aplomb, arrets. Pieces probables : gonds, arrets, lames, espagnolette.",
    categorie: "Volet battant",
  },
  {
    id: "portail_battant", nom: "Portails battants (battants, gonds/pivots, poteaux, serrure, motorisation a bras ou verins)",
    mots: ["portail battant", "portail", "battant", "pivot", "poteau", "ferme-portail", "verin", "bras", "electro-serrure"],
    pannes: [
      "Frotte au sol / ne ferme plus bien : affaissement, pivots ou gonds a regler.",
      "Ne se verrouille plus ou la serrure/gache ne tombe pas en face : desalignement.",
      "Grincement : gonds secs (graissage par le technicien). Poteau qui penche ou fixation qui bouge : structure a controler.",
      "Motorisation : voir MOTORISATION (cellules, telecommande, carte, deblocage).",
    ],
    securite: "Battant lourd : risque d'ecrasement. Ne plus utiliser un battant qui menace de se decrocher ; ecarter personnes et enfants.",
    demander: "Alu ou autre ; deux battants ou un ; motorise ou non ; depuis quand ; photo du pivot/gond, du sol, de la serrure.",
    urgence: "Urgent : battant decroche ou instable, portail motorise bloque ouvert qui expose le bien. Sinon non urgent.",
    technicien: "Controles : pivots/gonds (jeu, usure), aplomb des poteaux, serrure/gache, butees, motorisation. Pieces probables : pivots, gonds, serrure, butees.",
    categorie: "Portail",
  },
  {
    id: "portail_coulissant", nom: "Portails coulissants (rail au sol, galets, guidage, cremaillere, autoportant)",
    mots: ["portail coulissant", "coulissant portail", "rail au sol", "cremaillere", "autoportant", "guidage", "butee"],
    pannes: [
      "Coulisse dur ou saute du rail : rail encombre (gravillons, feuilles, terre) a nettoyer, galets uses, guidage a regler. Ne pas forcer.",
      "S'arrete a mi-course : obstacle, cellules, detection d'effort. Ne se ferme pas completement : butee ou cellule desalignee.",
      "Sort du guidage ou penche : DANGER de chute du portail, ecarter les personnes, ne plus l'utiliser.",
      "Bruit / grincement : rail, galets, guidage.",
    ],
    securite: "Un portail coulissant lourd qui sort de son rail peut blesser gravement : ne pas rester a proximite.",
    demander: "A rail ou autoportant ; motorise ou non ; ou il s'arrete ; photo du rail et du galet/guidage.",
    urgence: "Urgent : portail sorti du rail ou instable, bloque ouvert qui expose le bien. Sinon non urgent.",
    technicien: "Controles : rail (propreté, usure), galets, guidage et contre-guidage, cremaillere, butees, cellules. Pieces probables : galets, guides, cremaillere, butees.",
    categorie: "Portail",
  },
  {
    id: "motorisation", nom: "Motorisations de portail et de porte de garage (moteur, carte, telecommande, cellules, feu, batterie de secours)",
    mots: ["motorisation", "moteur", "telecommande", "cellule", "cellules", "photocellule", "feu clignotant", "carte", "automatisme", "emetteur", "recepteur", "batterie", "telecommande de portail", "telecommande portail", "telecommande de garage", "telecommande garage", "portail motorise", "porte de garage motorisee"],
    pannes: [
      "Aucune telecommande ne repond : alimentation (disjoncteur), recepteur ou carte. UNE seule telecommande ne repond pas : pile ou emetteur a re-appairer.",
      "Le portail s'arrete ou refuse de se fermer : cellules photoelectriques sales ou desalignees (nettoyer la lentille avec un chiffon doux, verifier le voyant, rien dans le faisceau), obstacle, detection d'effort.",
      "Le moteur tourne mais le portail ne bouge pas : verifier que le deblocage manuel n'est pas reste engage (selon la notice).",
      "Feu clignotant ou voyant d'erreur : noter le comportement (nombre de clignotements) pour le technicien.",
      "Coupure de courant : utiliser le deblocage manuel selon la notice ; batterie de secours si equipe.",
      "Bruit anormal / vibrations : moteur, cremaillere, fixation, a controler.",
    ],
    securite: "Ne jamais ouvrir le boitier ni toucher a la carte ou au 230 V. Ne JAMAIS contourner ni masquer les cellules de securite (risque d'ecrasement, notamment pour les enfants).",
    demander: "Portail ou garage ; marque du moteur si lisible ; toutes les telecommandes ou une seule ; voyants ; depuis quand ; coupure de courant recente ; photo du moteur et de la cellule.",
    urgence: "Urgent : portail ou garage bloque ouvert (securite du bien) ou bloque ferme avec besoin de sortir. Sinon non urgent.",
    technicien: "Controles : alimentation, carte et recepteur, cellules (alignement, alimentation), fins de course, detection d'effort, deblocage, batterie. Pieces probables : telecommande, recepteur, cellules, carte, batterie, fins de course.",
    categorie: "Motorisation",
  },
  {
    id: "porte_garage", nom: "Portes de garage (sectionnelle, enroulable, basculante, battante, laterale)",
    mots: ["porte de garage", "garage", "sectionnelle", "enroulable", "basculante", "ressort", "ressorts", "cable", "cables", "section", "tablier"],
    pannes: [
      "Ne monte ou ne descend plus : si motorisee voir MOTORISATION ; en manuel : deblocage et verification d'un obstacle, sans forcer.",
      "Porte lourde, qui retombe ou desequilibree, claquement sec entendu : ressort detendu ou casse, DANGER. Ne pas intervenir.",
      "Cable detache ou effiloche, porte de travers ou qui sort des rails : DANGER, ne pas forcer ni passer dessous.",
      "Bruit / grincement : rails encrasses, charnieres, galets (entretien par le technicien).",
      "Infiltration ou jour en bas : joint bas use. Sectionnelle : panneau enfonce ou abime (remplacement de section). Enroulable : lame deformee, tablier coince, axe ou enroulement.",
      "Basculante : contrepoids ou ressorts, bras de liaison.",
    ],
    securite: "Ressorts, cables et supports de ressort sont sous TRES forte tension : le client n'y touche JAMAIS. Ne jamais passer sous une porte instable ni la lacher.",
    demander: "Type (sectionnelle, enroulable, basculante...) ; motorisee ou non ; ce qui s'est passe (bruit, chute...) ; depuis quand ; photo des ressorts/cables en restant a distance, des rails, du bas de porte.",
    urgence: "Urgent : danger (ressort casse, cable detache, porte instable), porte bloquee ouverte (securite du garage et du vehicule), porte bloquee fermee avec vehicule dedans. Sinon non urgent.",
    technicien: "Controles : equilibrage et ressorts (remplacement par paire par un pro), cables et poulies, rails et galets, joints, motorisation. Pieces probables : ressorts, cables, galets, joint bas, sections, moteur.",
    categorie: "Porte de garage",
  },
  {
    id: "veranda", nom: "Vérandas (toiture vitree ou panneaux, cheneau, gouttiere, ouvrants, joints)",
    mots: ["veranda", "toiture veranda", "cheneau", "gouttiere", "lanterne", "toit vitre", "verriere"],
    pannes: [
      "Infiltration : jonction avec le mur (solin/etancheite), joints de vitrage ou de toiture, ouvrants, evacuations. A faire constater par un technicien ; ne pas monter sur le toit.",
      "Cheneau ou gouttiere qui deborde : evacuation bouchee (feuilles). Nettoyage seulement s'il est accessible en toute securite, sinon technicien.",
      "Condensation : ventilation insuffisante ; en ete surchauffe : protection solaire (stores), ouvrants de toit/aeration.",
      "Vitrage fele ou joint noirci/decolle, moisissure sur joints : technicien.",
      "Bruits de dilatation ou claquements au vent : fixations, joints.",
    ],
    securite: "Ne jamais monter sur une toiture de veranda (verre, panneaux fragiles). Fuite pres d'un point electrique : couper le disjoncteur concerne.",
    demander: "Alu ou PVC ; toiture vitree ou panneaux ; ou l'eau entre ; seulement sous forte pluie ou toujours ; depuis quand ; photos de l'interieur (tache, goutte) et de la jonction avec le mur.",
    urgence: "Urgent : fuite importante, vitrage de toiture casse ou menacant de tomber, eau pres de l'electricite. Sinon a planifier.",
    technicien: "Controles : etancheite de jonction murale, joints et silicone, cheneau/evacuations, fixations, ouvrants, vitrage (etat, calage). Pieces probables : joints, silicone/mastic de facade adapte, vitrage, accessoires de cheneau.",
    categorie: "Veranda",
  },
  {
    id: "pergola", nom: "Pergolas bioclimatiques (lames orientables, moteur, capteurs pluie/vent, gouttiere integree, LED, screens)",
    mots: ["pergola", "bioclimatique", "lames orientables", "lames", "capteur pluie", "capteur vent", "screen", "screens"],
    pannes: [
      "Les lames ne bougent plus : alimentation, telecommande ou domotique, capteur pluie/vent qui a mis la pergola en position de securite.",
      "Les lames ne s'orientent pas toutes ou restent desalignees : moteur, bielle ou lame a controler. Ne pas forcer.",
      "Fuite entre les lames en position fermee : fermeture incomplete (refaire un cycle complet), joints des lames, evacuation.",
      "Eau qui coule le long des poteaux ou qui deborde : gouttiere integree ou descente bouchee (feuilles) ; nettoyage seulement si accessible en securite.",
      "Bruit ou claquement au vent, capteur qui declenche a tort : reglage ou capteur, technicien.",
      "Eclairage LED qui ne marche plus : alimentation/driver, technicien. Screens ou stores lateraux : voir STORE BANNE pour toile et moteur.",
    ],
    securite: "Ne pas monter sur la pergola ni toucher au cablage. En vent fort ou forte pluie, laisser en position de securite.",
    demander: "Marque/modele si connu ; telecommande ou domotique ; ce qui ne marche pas (lames, LED, fuite) ; depuis quand ; photo des lames, des poteaux et de la gouttiere.",
    urgence: "Urgent : structure instable apres tempete, lame ou element qui menace de tomber. Sinon a planifier.",
    technicien: "Controles : alimentation et commande, moteur et bielles, capteurs, joints de lames, gouttieres et descentes, fixations, LED. Pieces probables : moteur, telecommande/recepteur, capteurs, joints, LED/driver.",
    categorie: "Pergola",
  },
  {
    id: "carport", nom: "Carports (structure alu ou acier, toiture polycarbonate / bac acier, poteaux, platines, gouttiere)",
    mots: ["carport", "abri voiture", "abri de voiture", "polycarbonate", "bac acier", "platine"],
    pannes: [
      "Toiture qui bouge ou claque au vent : fixations lachees, vis ou profils a reprendre (DANGER si les elements se detachent).",
      "Infiltration : joints, vis, recouvrements de plaques. Polycarbonate fele (grele, choc) : plaque a remplacer.",
      "Poteau penche, deformation, platine de fixation qui bouge : structure a faire controler rapidement.",
      "Gouttiere ou descente obstruee ou decrochee : technicien.",
    ],
    securite: "Apres tempete, forte neige ou choc : ne plus stationner sous une structure deformee ou instable.",
    demander: "Materiau (alu, acier, bois) ; toiture ; ce qui a bouge ou casse ; apres un evenement meteo ou non ; photos d'ensemble, des poteaux/platines et de la toiture.",
    urgence: "Urgent : structure instable, deformee ou elements prets a tomber. Sinon a planifier.",
    technicien: "Controles : platines et chevilles, serrage des assemblages, aplomb des poteaux, fixations et joints de toiture, evacuations. Pieces probables : visserie, joints, plaques, accessoires de gouttiere.",
    categorie: "Carport",
  },
  {
    id: "store_banne", nom: "Stores bannes et stores exterieurs (toile, bras, coffre, moteur, capteur vent/soleil)",
    mots: ["store", "store banne", "banne", "toile", "bras", "barre de charge", "capteur vent", "capteur soleil", "coffre store"],
    pannes: [
      "Ne s'ouvre ni ne se ferme : alimentation, pile de la telecommande, capteur vent qui a fait rentrer le store (securite).",
      "Toile qui s'enroule de travers ou fait des plis : alignement/tension a regler, technicien.",
      "Bras qui pendent ou barre qui ne remonte pas : reglage d'inclinaison ou bras a controler.",
      "Toile dechiree, decoloree ou moisie : remplacement ou nettoyage adapte (a voir avec l'agence).",
      "Bruit du moteur ou du coffre, manivelle de secours : usage de secours uniquement selon la notice.",
    ],
    securite: "En vent fort, un store sorti est dangereux : le rentrer prudemment sans forcer. Fixation murale qui bouge = urgent, ne plus utiliser.",
    demander: "Motorise ou manuel ; coffre ou non ; ce qui ne marche pas ; depuis quand ; photo du coffre, des bras, de la toile et de la fixation murale.",
    urgence: "Urgent : store qui menace de tomber ou fixation murale desserree, store bloque ouvert avec du vent. Sinon non urgent.",
    technicien: "Controles : alimentation/commande, moteur et fins de course, capteurs, bras et inclinaison, toile (alignement, tension), fixations. Pieces probables : moteur, telecommande, capteur, toile, bras.",
    categorie: "Store banne",
  },
  {
    id: "moustiquaire", nom: "Moustiquaires (enroulable, plissee, coulissante, cadre fixe)",
    mots: ["moustiquaire", "moustiquaires", "anti-insectes", "insectes", "plissee"],
    pannes: [
      "Toile qui sort du rail ou ne s'enroule plus : rail ou guide encrasse, ressort d'enroulement. Ne pas forcer l'enroulement.",
      "Trous ou dechirures : toile a remplacer (pas de reparation durable).",
      "Plissee qui se deplace mal : cordon, galets ou rail. Brosses usees : des insectes passent.",
      "Cadre voile ou qui ne tient plus : fixation, equerres.",
    ],
    securite: "Pas de risque majeur ; ne pas forcer pour eviter d'abimer toile et ressort.",
    demander: "Type (enroulable, plissee, cadre) ; dimensions approximatives ; photo de la toile, du rail et du caisson.",
    urgence: "Non urgent en general.",
    technicien: "Controles : rails et guides, ressort d'enroulement, cordon et galets, brosses, toile. Pieces probables : toile, brosses, guides, cordon, galets, equerres.",
    categorie: "Moustiquaire",
  },
  {
    id: "garde_corps", nom: "Garde-corps, rambardes et balustrades (alu, inox, verre, cables)",
    mots: ["garde-corps", "garde corps", "rambarde", "balustrade", "main courante", "lisse", "barreaudage", "verre feuillete"],
    pannes: [
      "Garde-corps qui bouge, vibre ou a du jeu : fixations ou platines desserrees, chevilles fatiguees. DANGER de chute : ne plus s'appuyer dessus.",
      "Vitrage fele, eclate ou plaque de verre qui bouge : DANGER, interdire l'acces, technicien en priorite.",
      "Traces de corrosion (inox ou alu en bord de mer), peinture ecaillee : surtout esthetique, a faire constater ; la corrosion des fixations est a controler.",
      "Bruit au vent, cables ou barreaux detendus : serrage et tension a reprendre par le technicien.",
    ],
    securite: "Un garde-corps qui bouge n'est plus un dispositif de securite : le client ne s'appuie plus dessus, n'y laisse pas d'enfants, et ne tente pas de resserrer lui-meme.",
    demander: "Materiau (alu, inox, verre, cables) ; interieur ou exterieur, hauteur du vide ; ce qui bouge ; depuis quand ; photo d'ensemble, des fixations et du point de jeu.",
    urgence: "Urgent : tout jeu ou mouvement anormal, verre fele ou eclate (risque de chute). Esthetique ou corrosion legere : a planifier.",
    technicien: "Controles : platines, chevilles et fixations, serrage des poteaux et lisses, etat du vitrage et des joints, tension des cables. Pieces probables : visserie inox, chevilles chimiques, platines, joints de vitrage.",
    categorie: "Garde-corps",
  },
  {
    id: "cloture", nom: "Clotures aluminium et portillons (panneaux, lames, poteaux, serrure, charnieres)",
    mots: ["cloture", "portillon", "claustra", "panneau de cloture", "lames de cloture", "poteau de cloture"],
    pannes: [
      "Portillon qui frotte, ne ferme plus ou ne se verrouille pas : charnieres a regler, gache ou serrure desalignee, affaissement.",
      "Poteau qui penche ou panneau qui bouge (apres un coup de vent par exemple) : scellement ou fixation a reprendre.",
      "Lames ou panneaux decroches, cassees ou qui claquent : fixations, clips, lames a remplacer.",
      "Laquage ecaille ou decolore : a faire constater (garantie et conditions a confirmer par l'agence).",
    ],
    securite: "Un panneau ou un poteau instable peut tomber : eloigner les enfants et ne pas s'appuyer dessus.",
    demander: "Cloture ou portillon ; materiau et couleur ; ce qui ne va pas ; apres un evenement (vent, choc) ou non ; photo d'ensemble, du poteau et de la fixation.",
    urgence: "Urgent : panneau ou poteau pret a tomber, portillon qui ne ferme plus et expose un enfant ou un animal. Sinon a planifier.",
    technicien: "Controles : scellements et platines des poteaux, fixations des panneaux, charnieres et serrure du portillon, aplomb. Pieces probables : charnieres, gache/serrure, clips et visserie, lames.",
    categorie: "Cloture",
  },
  {
    id: "brise_soleil", nom: "Brise-soleil et ombrieres (lames fixes ou orientables, moteur, commande)",
    mots: ["brise-soleil", "brise soleil", "bso", "lames orientables brise", "ombriere", "ombrieres"],
    pannes: [
      "Lames orientables qui ne bougent plus : alimentation, commande ou telecommande, capteur de securite vent/soleil, moteur ou bielle.",
      "Lames desalignees, bloquees ou qui frottent : mecanisme a controler, ne pas forcer.",
      "Lame decrochee ou qui pend : DANGER de chute en facade, ne pas toucher, technicien en priorite.",
      "Bruit ou claquement au vent : fixations, jeu des lames, reglage des capteurs.",
    ],
    securite: "Un element en facade ou en hauteur peut tomber : zone a eloigner, jamais d'intervention du client sur echelle ou sur le moteur.",
    demander: "Fixe ou orientable ; commande (telecommande, interrupteur, domotique) ; ce qui ne marche pas ; etage ; photo d'ensemble et du point de blocage.",
    urgence: "Urgent : lame decrochee ou prete a tomber. Sinon a planifier.",
    technicien: "Controles : alimentation et commande, moteur et bielles, capteurs, fixations et jeu des lames. Pieces probables : moteur, recepteur radio, bielles, embouts, lames, visserie.",
    categorie: "Brise-soleil",
  },
  {
    id: "auvent", nom: "Auvents et marquises (verre feuillete, acier ou alu, tirants, gouttiere)",
    mots: ["auvent", "marquise", "tirant", "tirants", "abri d'entree", "abri entree"],
    pannes: [
      "Infiltration ou ecoulement au mur : jonction murale, joints, evacuation de la gouttiere.",
      "Vitrage fele ou ecaille : DANGER de chute d'eclats, interdire le passage dessous, technicien.",
      "Auvent qui bouge, tirants detendus ou fixation murale qui lache : DANGER, ne plus passer dessous.",
      "Gouttiere bouchee ou qui deborde : nettoyage seulement si accessible sans danger, sinon technicien.",
    ],
    securite: "Ne pas stationner ni passer sous un auvent qui bouge ou dont le verre est fele ; ne pas monter dessus.",
    demander: "Verre, alu ou autre ; ce qui bouge ou fuit ; apres un evenement meteo ou non ; photo d'ensemble, de la fixation au mur et des tirants.",
    urgence: "Urgent : auvent instable, verre fele ou decolle au-dessus d'un passage. Sinon a planifier.",
    technicien: "Controles : fixations murales et chevilles, tirants (tension), joints et solin, vitrage (etat, calage), gouttiere. Pieces probables : chevilles, tirants, joints, visserie inox, vitrage.",
    categorie: "Auvent / marquise",
  },
  {
    id: "fenetre_toit", nom: "Fenetres de toit (a projection ou a rotation, volet ou store de toit)",
    mots: ["fenetre de toit", "fenetres de toit", "velux", "lucarne", "chassis de toit", "puits de lumiere", "volet de toit"],
    pannes: [
      "Infiltration autour de la fenetre : etancheite du raccord (solin) ou joint ; a faire constater, ne pas monter sur le toit.",
      "Condensation : ventilation de la piece ; buee entre les vitres : double vitrage a remplacer.",
      "Ouverture ou fermeture dure, ne tient pas en position : mecanisme, ressorts ou charnieres a controler.",
      "Volet ou store de toit motorise qui ne marche plus : alimentation, commande, moteur.",
    ],
    securite: "Ne jamais monter sur le toit ni se pencher dehors pour reparer ; en cas de fuite, proteger le sol et couper un circuit electrique mouille.",
    demander: "Ouverture manuelle ou motorisee ; ou l'eau entre ; seulement sous forte pluie ou toujours ; depuis quand ; photo de l'interieur (tache, goutte) et du cadre.",
    urgence: "Urgent : fuite importante, vitrage de toit casse, eau pres de l'electricite. Sinon a planifier.",
    technicien: "Controles : etancheite et solin, joints, mecanisme et charnieres, vitrage, motorisation. Pieces probables : joints, kit d'etancheite adapte, ressorts, moteur, vitrage.",
    categorie: "Fenetre de toit",
  },
  {
    id: "controle_acces", nom: "Controle d'acces (interphone, visiophone, digicode, platine de rue, lecteur de badge)",
    mots: ["interphone", "visiophone", "digicode", "platine", "clavier", "badge", "lecteur de badge", "gache electrique", "controle d'acces", "ouvre-porte"],
    pannes: [
      "La porte ou le portail ne s'ouvre plus depuis l'interphone, le digicode ou le badge : alimentation, gache ou electro-serrure, platine, cablage.",
      "Digicode ou clavier qui ne repond plus : pile ou alimentation, clavier use ou humide.",
      "Image ou son absent au visiophone : alimentation du moniteur, cablage, platine de rue.",
      "Badge non reconnu : badge a re-enregistrer ou lecteur defaillant.",
    ],
    securite: "Ne pas ouvrir la platine ni toucher au cablage ou a l'alimentation. Si l'acces d'un batiment reste ouvert ou bloque, prevenir l'agence en urgence.",
    demander: "Equipement (interphone, digicode, badge) ; ce qui ne marche plus ; tous les utilisateurs ou un seul ; coupure de courant recente ; photo de la platine et du boitier.",
    urgence: "Urgent : acces qui ne se verrouille plus (securite du batiment) ou qui bloque l'entree. Sinon a planifier.",
    technicien: "Controles : alimentation, gache ou electro-serrure, platine et cablage, moniteur, lecteur et badges. Pieces probables : alimentation, gache electrique, clavier, platine, badges.",
    categorie: "Controle d'acces",
  },
  {
    id: "rideau_metallique", nom: "Rideaux metalliques et fermetures de commerce (tablier, coffre, axe, moteur, serrure)",
    mots: ["rideau metallique", "rideau de fer", "fermeture de commerce", "grille enroulable", "rideau"],
    pannes: [
      "Ne monte ou ne descend plus : alimentation, commande, moteur ; en manuel : verifier l'absence d'obstacle sans forcer.",
      "Tablier desaxe, lame deformee ou qui frotte dans les coulisses : technicien.",
      "Serrure ou verrouillage bloque : ne pas forcer ; technicien.",
      "Bruit ou a-coups : coulisses, axe, moteur.",
      "Tablier qui tombe, descend seul ou se decroche : DANGER, ne pas passer dessous.",
    ],
    securite: "Un rideau lourd qui tombe peut blesser gravement : ne jamais passer dessous s'il est instable et ne jamais intervenir sur le moteur ou le ressort.",
    demander: "Commerce ou local ; manuel ou motorise ; ce qui s'est passe ; depuis quand ; photo du tablier, du coffre et des coulisses.",
    urgence: "Urgent : tablier instable, local qui ne peut plus etre ferme (securite) ou qui ne peut plus s'ouvrir (activite bloquee). Sinon a planifier.",
    technicien: "Controles : alimentation et commande, moteur, axe et enroulement, lames et coulisses, serrure. Pieces probables : moteur, lames, serrure, coulisses, ressort ou equilibrage.",
    categorie: "Rideau metallique",
  },
  {
    id: "motorisation_marques", nom: "Motorisations de marque (Somfy, Bubendorff, Ditec) et volets roulants ou battants solaires, telecommandes, box connectee",
    mots: ["somfy", "bubendorff", "ditec", "entrematic", "tahoma", "io-homecontrol", " rts ", "telis", "situo", "smoove", "dexxo", "evolvia", "elixo", "freevia", "axovia", "box domotique", "volet solaire", "volets solaires", "panneau solaire", "moteur solaire", "motorisation solaire", "batterie du volet", "volet battant motorise", "volets battants motorises", "application volets", "scenario volets"],
    pannes: [
      "Identifier d'abord la marque et le protocole : logo sur la telecommande, etiquette du moteur ou du boitier de commande. Somfy utilise deux protocoles radio qui ne sont PAS compatibles entre eux (RTS : commande a sens unique ; io-homecontrol : commande avec retour d'etat) : une telecommande d'un protocole ne pilote pas un moteur de l'autre.",
      "Telecommande qui ne repond plus (toutes marques) : changer la pile (sens correct), puis tester une 2e telecommande ou l'interrupteur mural pour savoir si le probleme vient de la telecommande ou du moteur/recepteur.",
      "Aucune commande, ni radio ni murale : alimentation (disjoncteur, prise) ; pour un volet solaire, voir ci-dessous.",
      "Volet roulant ou battant SOLAIRE (Somfy, Bubendorff et autres) : une batterie est rechargee par un panneau solaire place sur ou pres du coffre. Causes frequentes : panneau sale, ombre portee (arbre, mur, store) ou mal oriente, batterie dechargee apres plusieurs jours sans soleil (hiver) ou batterie en fin de vie. Le client peut nettoyer le panneau a l'eau claire avec un chiffon doux s'il est accessible sans danger, puis laisser recharger quelques jours ; au-dela : technicien (batterie, panneau, cable de liaison).",
      "Mouvements incoherents (monte ou descend seul, ne s'arrete pas, s'arrete trop tot) : fins de course a regler, capteur de vent/soleil mal regle, ou programmation horaire / scenario de la box domotique. Verifier l'application et les programmations avant de conclure a une panne.",
      "Box connectee (TaHoma ou equivalent) : si les volets ne repondent plus par l'application mais marchent a la telecommande, verifier l'alimentation de la box, son voyant et la connexion internet/wifi : c'est souvent le reseau, pas le moteur.",
      "Moteur qui ronfle, bruit anormal, s'arrete a mi-course : protection thermique (laisser refroidir quelques minutes), obstacle, fin de course. Ne jamais forcer ni ouvrir le coffre.",
      "Motorisation de portail ou de porte de garage de marque (Somfy, Ditec et autres) : memes verifications que MOTORISATION (cellules, deblocage manuel, telecommande, coupure de courant). Noter le modele inscrit sur le boitier et le nombre de clignotements du feu orange : ils donnent le code d'erreur au technicien.",
      "Volets battants motorises (bras ou verins) : verifier l'alimentation, la telecommande, l'absence d'obstacle (feuilles, gravillons, vent) ; un bras qui force ou un volet qui reste ouvert : technicien.",
      "REGLE ABSOLUE : le reglage des fins de course, l'appairage d'une telecommande et la remise a zero (reset) dependent du modele exact. Ne donne JAMAIS de sequence de touches de memoire : renvoie a la notice du fabricant ou au technicien, qui a les outils de programmation.",
    ],
    securite: "Ne jamais ouvrir un boitier de commande, un coffre ou un moteur (230 V ou batterie) ; ne pas contourner les cellules ni les dispositifs anti-ecrasement ; ne pas forcer un volet ou un portail bloque.",
    demander: "Marque et modele (etiquette ou logo) ; commande par telecommande, interrupteur ou application ; solaire ou filaire ; un seul volet ou tous ; depuis quand ; meteo recente (peu de soleil) ou coupure de courant ; photo de l'etiquette du moteur ou du boitier et de la telecommande.",
    urgence: "Urgent : volet ou portail bloque ouvert qui expose le logement, element qui menace de tomber. Sinon a planifier.",
    technicien: "Controles : marque et protocole (RTS ou io pour Somfy), alimentation ou batterie et panneau solaire (propreté, ombre, tension), recepteur radio, fins de course (reglage selon la notice du modele), capteurs vent/soleil, programmation et box domotique, moteur et protection thermique ; pour les portails : cellules, carte, feu, deblocage. Pieces probables : telecommande, recepteur, moteur, batterie ou panneau solaire, capteur, carte, cellules. Utiliser la notice et les outils du fabricant pour tout reglage ou appairage.",
    categorie: "Motorisation de marque",
  },
];

const GENERAL = `
METHODE GENERALE pour tout produit de menuiserie exterieure (meme s'il n'est pas dans la liste : ne dis jamais que tu ne le couvres pas) :
1) Identifier le produit et la matiere (alu, PVC, bois, acier). 2) Comprendre le symptome et depuis quand, si c'est permanent ou intermittent, et s'il y a eu un evenement (tempete, choc, coupure de courant, travaux). 3) Demander des photos utiles (ensemble + gros plan + etiquette/marque). 4) Evaluer la securite et l'urgence. 5) Donner au plus une verification simple et SURE, puis enregistrer la demande. 6) La garantie, le prix, le delai et les aides ne sont jamais promis : ils sont confirmes par l'agence.
URGENCE (qualification) : danger pour les personnes (ressort ou cable de porte de garage, vitrage casse, element qui menace de tomber, structure instable), impossibilite de fermer ou securiser le logement (porte d'entree, fenetre accessible, portail ou garage ouvert), personne ou animal enferme, eau en quantite, electricite exposee. Le confort (leger courant d'air, bruit, esthetique) n'est pas urgent.
CODES D'ERREUR, CLIGNOTEMENTS ET REGLAGES PAR MARQUE : tu ne connais pas la signification exacte du code d'un modele precis (nombre de clignotements du feu, voyant, bip) ni les sequences d'appairage, de fins de course ou de reinitialisation : ne les invente JAMAIS. Dis que le code se lit dans la notice du modele (ou que le technicien l'interpretera avec ses outils), demande de NOTER le comportement (nombre de clignotements, couleur du voyant) et de photographier l'etiquette, et propose seulement les controles generaux (alimentation, telecommande, cellules, obstacle).
SECURITE : le client ne demonte rien, ne force rien, ne touche ni aux ressorts, ni aux moteurs sous tension, ni aux vitrages casses, et ne monte pas sur une toiture, une pergola ou un carport.
`;

const PHOTOS = `
PHOTOS ET DOCUMENTS JOINTS : si le message contient des images, REGARDE-LES vraiment. Confirme en une phrase ce que tu vois (produit, partie concernee, defaut visible) sans affirmer un diagnostic certain. Si l'image est floue, trop sombre ou hors sujet, demande-en une autre (ensemble + gros plan). Si le message ne contient que la mention d'une photo indisponible a l'analyse : dis "J'ai bien recu votre photo, elle sera transmise au technicien", ne dis JAMAIS "je vois" a son sujet, et demande au client de decrire le probleme avec ses mots (en une phrase). N'affirme jamais avoir vu une image que tu ne vois pas. Quand tu crees le ticket, ajoute dans la description du probleme ce que tu as observe sur la photo, pour aider le technicien.
`;

const normaliser = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'");

// Consigne de SECURITE posee par le serveur (et non par le modele) quand le client decrit une situation dangereuse.
// Retourne une phrase courte, ou "" si rien de dangereux n'est decrit.
export function phraseSecurite(texte) {
  const n = " " + normaliser(texte) + " ";
  const a = (re) => re.test(n);
  const phrases = [];
  if ((a(/ressort|cable/) && a(/casse|rompu|detach|effiloch|claqu|retombe|tombe|lache/)) || (a(/porte de garage/) && a(/retombe|desequilibr|tres lourde|devenue lourde/))) phrases.push("Par securite : ne touchez ni aux ressorts ni aux cables de la porte, et ne passez pas dessous.");
  if (a(/vitre|vitrage|verre/) && a(/casse|fele|eclate|eclat|brise/)) phrases.push("Par securite : eloignez-vous des eclats de verre et ne touchez pas au vitrage casse.");
  if (a(/volet|store|portail|garde-corps|rambarde|balustrade|auvent|marquise|brise-soleil|rideau|pergola|carport|cloture|poteau|panneau|lame/) && a(/menace de tomber|risque de tomber|pret a tomber|va tomber|decroche|se detache|pend |tombe d'un coup|est tombe|penche dangereusement/)) phrases.push("Par securite : ne passez pas dessous, eloignez les personnes (enfants compris) de la zone et ne forcez rien.");
  if (a(/store|pergola|auvent/) && a(/vent|tempete|rafale/) && a(/bloque|dehors|ne rentre|ne se ferme|ne remonte/)) phrases.push("Par securite : ne forcez pas, et restez a distance tant qu'il y a du vent.");
  if (a(/eau|fuite|infiltration|coule/) && a(/prise|electri|disjoncteur|spot|lumiere|plafonnier/)) phrases.push("Par securite : coupez le disjoncteur du circuit concerne avant toute chose.");
  if (a(/enferme|bloque dehors|coince dedans|coince a l'interieur/) && a(/enfant|bebe|animal|personne/)) phrases.push("Si une personne ou un enfant est enferme, appelez immediatement les secours (112).");
  return phrases.slice(0, 2).join(" ");
}

// Familles concernees par un texte (mots-cles), les plus pertinentes d'abord (3 maximum).
const MARQUES = ["somfy", "bubendorff", "ditec", "entrematic", "tahoma"];
export function famillesPour(texte) {
  const n = " " + normaliser(texte) + " ";
  return FAMILLES
    .map((f) => ({ f, score: f.mots.reduce((s, m) => s + (n.includes(normaliser(m)) ? (MARQUES.includes(m) ? 4 : /[ -]/.test(m) ? 3 : m.length > 6 ? 2 : 1) : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.f);
}

const index = () => "PRODUITS COUVERTS (tu sais repondre sur tous) : " + FAMILLES.map((f) => f.nom.split(" (")[0]).join(" ; ") + ". Autres produits de menuiserie exterieure : meme methode.";

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

// Bloc a ajouter au prompt systeme. assistant : "amandine" (client), "technicien" (Max), "dashboard" (IKO).
export function blocSavoir(assistant, texte, options) {
  const avecPhotos = !!(options && options.photos);
  const trouvees = famillesPour(texte);
  const consigne = assistant === "amandine"
    ? "Tu es la premiere ligne : une ou deux verifications simples et sures au maximum, puis tu enregistres la demande avec les bonnes informations et la bonne urgence. Jamais de reparation par le client. N'invente et ne suppose JAMAIS une information que le client n'a pas donnee (motorise ou non, materiau, date d'achat...) : demande-la UNE fois. Ne repose JAMAIS une question deja posee dans la conversation, meme si la reponse du client est courte (ex. « Agence 3 ») ou partielle : prends-en acte et passe a l'etape suivante (coordonnees, creneau, enregistrement). Si le client demande un jour ou une periode qui n'est pas dans les creneaux libres (week-end, jour trop proche, date passee), dis-le clairement (« nous n'intervenons pas le samedi », « le plus tot possible est le ... »), n'ecris jamais le jour demande si aucun creneau ce jour-la n'est propose, et propose les dates disponibles les plus proches. Si une coordonnee semble incorrecte (numero trop court, e-mail sans @), redemande-la poliment avant d'enregistrer. SI LA SITUATION EST DANGEREUSE (ressort ou cable de porte de garage, vitrage casse, store ou volet qui menace de tomber, portail ou structure instable...), ta PREMIERE phrase est une consigne de securite claire (ne pas toucher, s'eloigner, ne pas passer dessous), AVANT toute question, puis tu poursuis la prise de demande en la marquant urgente."
    : assistant === "technicien"
    ? "Tu parles a un technicien sur le terrain : va droit aux causes probables, aux controles et aux pieces a prevoir, en 1 a 2 phrases tres courtes. POUR UNE QUESTION TECHNIQUE (cause, controle, piece, outillage), reponds avec l'outil reponse_vocale : jamais un simple \"C'est fait\". Si aucun client ni numero de ticket n'est cite, ne choisis JAMAIS un ticket ni n'ouvre une fiche : reponds par reponse_vocale. Le technicien constate sur place ; ne pretends pas voir ce qui n'est pas dans les donnees."
    : "Tu parles a la direction ou a l'agence : aide a qualifier en 2 phrases (urgence oui/non et pourquoi ; competence technicien necessaire ; informations a recueillir) sans engager l'entreprise sur un prix, un delai ou une garantie. Reponds avec reponse_vocale.";
  return "\n\nSAVOIR TECHNIQUE MENUISERIE EXTERIEURE\n" + index() + "\n" + consigne + GENERAL + (assistant === "amandine" && avecPhotos ? PHOTOS : "") +
    (trouvees.length ? "\nFICHES DES PRODUITS CONCERNES PAR CETTE CONVERSATION :" + trouvees.map((f) => detail(f, assistant, texte)).join("\n") : "");
}

export const FAMILLES_MENUISERIE = FAMILLES.map((f) => ({ id: f.id, nom: f.nom, categorie: f.categorie }));
