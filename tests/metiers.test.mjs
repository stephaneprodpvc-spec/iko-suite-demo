// Tests : savoir multi-metiers (api/_savoir-metiers.js) et vocabulaires de metiers. Aucun appel reseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blocSavoirTous, phraseSecuriteTous, phraseSecuriteMetiers, famillesMetiersPour, FAMILLES_METIERS } from "../api/_savoir-metiers.js";
import vocabElec from "../api/_trades/electricite.js";
import vocabGen from "../api/_trades/generaliste.js";
import vocabPlomb from "../api/_trades/plomberie_chauffage.js";
import vocabMenu from "../api/_trades/menuiserie.js";

test("chaque metier a un vocabulaire complet (produits, diagnostics, regle de securite)", () => {
  for (const v of [vocabElec, vocabGen, vocabPlomb, vocabMenu]) {
    assert.ok(v.trade_id && v.nom_metier, v.trade_id);
    assert.ok(Array.isArray(v.produits) && v.produits.length >= 4, "produits : " + v.trade_id);
    assert.ok(Array.isArray(v.diagnostics) && v.diagnostics.length >= 2, "diagnostics : " + v.trade_id);
    assert.ok(typeof v.regle_securite === "string" && v.regle_securite.length > 40, "securite : " + v.trade_id);
    assert.equal(v.historique.disponible === false || v.historique.disponible === true, true);
  }
  assert.ok(!/fenetre|volet|portail/i.test(vocabElec.produits.join(" ")), "l'electricite ne parle pas de menuiserie");
});

test("chaque famille de metier est complete et detectable par ses mots-cles", () => {
  assert.ok(FAMILLES_METIERS.length >= 10);
  const cas = [
    ["Mon disjoncteur differentiel saute des que je branche le lave-linge", "elec-tableau"],
    ["La prise de la cuisine ne marche plus", "elec-prises"],
    ["Ma borne de recharge ne demarre pas", "elec-equipements"],
    ["J'ai une fuite sous l'evier de la cuisine, le robinet goutte", "plomberie-fuite"],
    ["Le wc est bouche et ca deborde, le siphon sent mauvais", "plomberie-sanitaires"],
    ["Je n'ai plus d'eau chaude, le chauffe-eau est froid", "chauffe-eau"],
    ["La chaudiere gaz s'est mise en securite et la pression est basse", "chauffage"],
    ["La climatisation souffle chaud, le groupe exterieur est couvert de givre", "pac-clim"],
    ["La VMC fait du bruit et il y a de la moisissure", "vmc"],
    ["J'ai casse la cle dans la serrure de la porte d'entree", "serrurerie"],
    ["Il y a une fuite de toiture, des tuiles ont bouge apres la tempete", "couverture"],
  ];
  for (const [texte, attendu] of cas) {
    const ids = famillesMetiersPour(texte).map((f) => f.id);
    assert.ok(ids.includes(attendu), texte + " -> " + ids.join(",") + " (attendu " + attendu + ")");
  }
  assert.deepEqual(famillesMetiersPour("Bonjour, je voudrais un rendez-vous"), []);
});

test("blocSavoirTous : le bon savoir selon la conversation et le metier du client", () => {
  const elec = blocSavoirTous("amandine", "Mon disjoncteur differentiel saute", { trade: "electricite" });
  assert.match(elec, /SAVOIR TECHNIQUE MULTI-METIERS/);
  assert.match(elec, /Installation electrique : tableau/);
  assert.ok(!/SAVOIR TECHNIQUE MENUISERIE EXTERIEURE/.test(elec), "pas de menuiserie pour un probleme electrique");
  const menu = blocSavoirTous("amandine", "Ma fenetre ferme mal, la poignee est dure", { trade: "menuiserie" });
  assert.match(menu, /SAVOIR TECHNIQUE MENUISERIE EXTERIEURE/);
  const defaut = blocSavoirTous("technicien", "Bonjour", {});
  assert.match(defaut, /MENUISERIE EXTERIEURE/, "sans metier ni indice : comportement historique conserve");
  const generaliste = blocSavoirTous("amandine", "Bonjour", { trade: "generaliste" });
  assert.match(generaliste, /MULTI-METIERS/, "un client multi-metiers recoit la methode generale meme sans mot-cle");
  const double = blocSavoirTous("dashboard", "fuite sur le chauffe-eau et la fenetre ne ferme plus", {});
  assert.match(double, /MENUISERIE EXTERIEURE/); assert.match(double, /MULTI-METIERS/);
  assert.match(blocSavoirTous("technicien", "disjoncteur differentiel", {}), /Pour le technicien :/);
});

test("securite posee par le serveur : gaz, monoxyde, electricite, degat des eaux, chauffe-eau ; la menuiserie reste couverte", () => {
  assert.match(phraseSecuriteMetiers("ca sent le gaz dans la cuisine"), /quittez les lieux/);
  assert.match(phraseSecuriteMetiers("depuis ce matin j'ai des maux de tete et la chaudiere fait du bruit"), /secours \(112\)/);
  assert.match(phraseSecuriteMetiers("la prise sent le brule et il y a des etincelles"), /disjoncteur general/);
  assert.match(phraseSecuriteMetiers("c'est une inondation, ca coule partout"), /arrivee d'eau generale/);
  assert.match(phraseSecuriteMetiers("le chauffe-eau siffle et se deforme"), /ne touchez pas au chauffe-eau/);
  assert.equal(phraseSecuriteMetiers("le robinet de la cuisine goutte"), "");
  assert.equal(phraseSecuriteMetiers("Bonjour"), "");
  assert.match(phraseSecuriteTous("la vitre de ma fenetre est cassee"), /eclats de verre/);
  const deux = phraseSecuriteTous("ca sent le gaz, la prise sent le brule, et la vitre est cassee");
  assert.ok(deux.split(/(?<=\.)\s+/).length <= 2, "deux consignes au plus");
});

test("aucun conseil dangereux n'est donne au client dans le savoir (pas de reparation electrique, gaz ou toiture)", () => {
  const tout = ["Mon disjoncteur saute", "chaudiere gaz", "toiture tuile", "chauffe-eau", "climatisation"].map((t) => blocSavoirTous("amandine", t, {})).join("\n").toLowerCase();
  assert.ok(!/ouvrez le tableau|demontez|montez sur le toit|reinitialisez en appuyant|rearmez a plusieurs reprises/.test(tout));
  assert.match(tout, /ne monte jamais sur un toit|ne repare ni l'electricite/);
});
