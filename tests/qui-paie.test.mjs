// Tests : « Qui paie ? ». Lancer : node --test tests/qui-paie.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { decider, typeActivite, etatGarantie } = createRequire(import.meta.url)("../qui-paie.js");

test("défaut produit sous garantie : le fabricant paie, décidé seul", () => {
  const r = decider({ cause: "Défaut produit", garantie: "Oui — Facture 123", typeActivite: "Fabricant non poseur" });
  assert.equal(r.payeur, "fabricant"); assert.equal(r.deplacementFacture, false); assert.equal(r.decision, "auto");
});
test("défaut produit hors garantie : le client paie", () => {
  const r = decider({ cause: "Pièce défectueuse", garantie: "Non / Hors garantie", montantDeplacement: 65 });
  assert.equal(r.payeur, "client"); assert.equal(r.deplacementFacture, true); assert.equal(r.montantDeplacement, 65);
  assert.match(r.texteFacturation, /65 € HT/);
});
test("défaut produit, garantie inconnue : à valider", () => {
  const r = decider({ cause: "Défaut produit", garantie: "" });
  assert.equal(r.decision, "a_valider"); assert.ok(r.manque.includes("garantie"));
});
test("erreur de pose par un poseur externe identifié, avec photo : le poseur paie, prévenu, décidé seul", () => {
  const r = decider({ cause: "Erreur de pose", typeActivite: "Fabricant non poseur", poseurConnu: true, nbPhotos: 2, montantDeplacement: 80 });
  assert.equal(r.payeur, "poseur"); assert.equal(r.prevenirPoseur, true); assert.equal(r.deplacementFacture, true); assert.equal(r.decision, "auto");
  assert.match(r.texteFacturation, /au poseur/);
});
test("erreur de pose sans photo : à valider", () => {
  const r = decider({ cause: "Erreur de pose", typeActivite: "Fabricant non poseur", poseurConnu: true, nbPhotos: 0 });
  assert.equal(r.decision, "a_valider"); assert.ok(r.manque.includes("photo"));
});
test("erreur de pose, poseur inconnu : à valider, on demande qui a posé", () => {
  const r = decider({ cause: "Erreur de pose", typeActivite: "Fabricant non poseur", nbPhotos: 3 });
  assert.equal(r.decision, "a_valider"); assert.ok(r.manque.includes("poseur"));
});
test("erreur de pose par l'entreprise elle-même (fabricant-poseur) : elle paie, rien au client", () => {
  const r = decider({ cause: "Erreur de pose", typeActivite: "Fabricant-poseur" });
  assert.equal(r.payeur, "entreprise"); assert.equal(r.deplacementFacture, false); assert.equal(r.decision, "auto");
});
test("mauvaise utilisation avec photo : le client paie, décidé seul ; sans photo : à valider", () => {
  assert.equal(decider({ cause: "Mauvaise utilisation client", nbPhotos: 1 }).decision, "auto");
  const r = decider({ cause: "Mauvaise utilisation client", nbPhotos: 0 });
  assert.equal(r.decision, "a_valider"); assert.equal(r.payeur, "client");
});
test("usure normale avec photo : le client paie", () => {
  const r = decider({ cause: "Usure normale", nbPhotos: 2, montantDeplacement: 65 });
  assert.equal(r.payeur, "client"); assert.equal(r.decision, "auto");
});
test("SAV préventif : le contrat d'entretien", () => {
  assert.equal(decider({ cause: "SAV préventif" }).payeur, "contrat");
});
test("casse transport, autre, aucune cause : toujours à valider", () => {
  for (const cause of ["Casse transport", "Autre", ""]) assert.equal(decider({ cause }).decision, "a_valider");
});
test("réglage : sur une pose maison c'est l'entreprise ; sinon à trancher", () => {
  assert.equal(decider({ cause: "Réglage", typeActivite: "Poseur", garantie: "Oui" }).payeur, "entreprise");
  assert.equal(decider({ cause: "Réglage", typeActivite: "Fabricant non poseur" }).decision, "a_valider");
});
test("réglage du patron : tout à valider même si clair", () => {
  const r = decider({ cause: "Défaut produit", garantie: "Oui", modeDecision: "valider" });
  assert.equal(r.decision, "a_valider"); assert.match(r.raisonValidation, /validé par le responsable/);
});
test("seuil de montant : au-dessus, à valider ; en dessous, décidé seul", () => {
  const base = { cause: "Usure normale", nbPhotos: 1, montantDeplacement: 65, seuilValidation: 500 };
  assert.equal(decider({ ...base, montantEnjeu: 200 }).decision, "auto");
  assert.equal(decider({ ...base, montantEnjeu: 900 }).decision, "a_valider");
});
test("aucun montant inventé : sans montant déplacement, pas de texte de facturation chiffré", () => {
  const r = decider({ cause: "Usure normale", nbPhotos: 1 });
  assert.equal(r.texteFacturation, ""); assert.equal(r.montantDeplacement, undefined);
});
test("lecture des types d'activité et de la garantie", () => {
  assert.equal(typeActivite("Fabricant-poseur"), "fabricant-poseur");
  assert.equal(typeActivite("Fabricant non poseur"), "fabricant non poseur");
  assert.equal(typeActivite("Poseur / installateur"), "poseur");
  assert.equal(etatGarantie("Oui — Facture 9"), "oui"); assert.equal(etatGarantie("Non / Hors garantie"), "non");
  assert.equal(etatGarantie(true), "oui"); assert.equal(etatGarantie(false), "non"); assert.equal(etatGarantie(""), "inconnue");
});
