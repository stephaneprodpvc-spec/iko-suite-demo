import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const G = createRequire(import.meta.url)("../gains.js");

const ticket = (id, champs, detail, cree = "2026-11-05T10:00:00.000Z") => ({
  id, createdTime: cree,
  fields: Object.assign({ Statut: "Terminé" }, champs, detail ? { "Qui paie détail": JSON.stringify(detail) } : {}),
});
const periodeNov = { debut: new Date(2026, 10, 1), fin: new Date(2026, 11, 1) };

test("bornes : mois en cours, 3 mois, tout", () => {
  const b = G.bornes("mois", new Date(2026, 10, 14));
  assert.equal(b.debut.getMonth(), 10); assert.equal(b.fin.getMonth(), 11);
  assert.equal(G.bornes("3mois", new Date(2026, 10, 14)).debut.getMonth(), 8);
  assert.deepEqual(G.bornes("tout"), { debut: null, fin: null });
});

test("gains : décisions Qui paie comptées une par une, déplacements facturés et à encaisser", () => {
  const tickets = [
    ticket("1", { "Montant encaissé": 52.8 }, { decision: "auto", payeur: "client", deplacementFacture: true, montantDeplacement: 65 }),
    ticket("2", {}, { decision: "auto", payeur: "client", deplacementFacture: true, montantDeplacement: 65, paiement: { statut: "paye" } }),
    ticket("3", {}, { decision: "valide", payeur: "poseur", deplacementFacture: true, montantDeplacement: 65 }),
    ticket("4", {}, { decision: "valide_a_charge_entreprise", payeur: "entreprise", deplacementFacture: false }),
    ticket("5", {}, { decision: "a_valider", payeur: "client", deplacementFacture: true, montantDeplacement: 65 }),
    ticket("6", { Statut: "Annulé" }, { decision: "auto", payeur: "client", deplacementFacture: true, montantDeplacement: 65 }),
    ticket("7", {}, null, "2026-09-01T10:00:00.000Z"),
  ];
  const g = G.calculerGains(tickets, [], periodeNov);
  assert.equal(g.nbTickets, 5); // 6 annulé exclu, 7 hors période
  assert.deepEqual({ ...g.quiPaie }, { total: 5, auto: 2, validesResponsable: 1, aValider: 1, chargeEntreprise: 1 });
  assert.equal(g.deplacementsFactures.nb, 3); // « à valider » et « entreprise » ne comptent pas
  assert.equal(g.deplacementsFactures.montant, 195);
  assert.equal(g.payes.nb, 1); assert.equal(g.payes.montant, 65);
  assert.equal(g.aEncaisser.nb, 2); assert.equal(g.aEncaisser.montant, 130);
  assert.equal(g.encaisseSurPlace, 52.8);
});

test("gains : devis signés sur la période seulement, sans rien inventer", () => {
  const devis = [
    { fields: { "Date validation client": "2026-11-03T09:00:00.000Z", "Montant TTC": 176 } },
    { fields: { "Date validation client": "2026-09-03T09:00:00.000Z", "Montant TTC": 900 } },
    { fields: { "Montant TTC": 50 } },
  ];
  const g = G.calculerGains([], devis, periodeNov);
  assert.equal(g.devisSignes.nb, 1); assert.equal(g.devisSignes.montantTTC, 176);
  const vide = G.calculerGains([], [], periodeNov);
  assert.equal(vide.nbTickets, 0); assert.equal(vide.aEncaisser.montant, 0);
});

test("temps gagné : seulement avec les hypothèses saisies", () => {
  assert.equal(G.tempsGagne(10, "", ""), null);
  assert.equal(G.tempsGagne(0, 10, 30), null);
  assert.deepEqual(G.tempsGagne(12, 10, ""), { heures: 2, euros: null });
  assert.deepEqual(G.tempsGagne(12, "10", "30"), { heures: 2, euros: 60 });
});

test("statut de paiement : sans objet si rien n'est facturé à un tiers", () => {
  assert.equal(G.statutPaiement({ decision: "auto", payeur: "fabricant", deplacementFacture: false }), "sans_objet");
  assert.equal(G.statutPaiement({ decision: "a_valider", payeur: "client", deplacementFacture: true }), "sans_objet");
  assert.equal(G.statutPaiement({ decision: "auto", payeur: "client", deplacementFacture: true }), "a_encaisser");
  assert.equal(G.statutPaiement({ decision: "valide", payeur: "client", deplacementFacture: true, paiement: { statut: "paye" } }), "paye");
});

test("liste à encaisser : triée du plus ancien au plus récent", () => {
  const a = ticket("a", {}, { decision: "auto", payeur: "client", deplacementFacture: true }, "2026-11-09T10:00:00.000Z");
  const b = ticket("b", {}, { decision: "auto", payeur: "client", deplacementFacture: true }, "2026-11-02T10:00:00.000Z");
  assert.deepEqual(G.listeAEncaisser([a, b]).map((t) => t.id), ["b", "a"]);
});

test("retour qualité : regroupe par produit, sépare fabricant / pose / utilisation, ignore les annulés", () => {
  const tickets = [
    ticket("1", { Produit: "Volet roulant", "Cause SAV": "Pièce défectueuse", "Pièce à commander": "moteur 20Nm", Garantie: "Oui - Facture 12" }),
    ticket("2", { Produit: "volet roulant", "Cause SAV": "Défaut produit", Garantie: "Oui" }),
    ticket("3", { Produit: "Volet roulant", "Cause SAV": "Erreur de pose", Poseur: "Dupont SARL", Garantie: "Non / Hors garantie" }),
    ticket("4", { Produit: "Portail", "Cause SAV": "Mauvaise utilisation" }),
    ticket("5", { Produit: "Portail" }),
    ticket("6", { Produit: "Portail", Statut: "Annulé", "Cause SAV": "Défaut produit" }),
  ];
  const r = G.agregerRetourQualite(tickets, periodeNov);
  assert.equal(r.total, 5); assert.equal(r.sansCause, 1);
  const volet = r.lignes.find((l) => l.produit === "Volet roulant");
  assert.equal(volet.total, 3); assert.equal(volet.dontFabricant, 2); assert.equal(volet.dontPose, 1); assert.equal(volet.garantie, 2);
  assert.deepEqual(volet.poseurs, { "Dupont SARL": 1 });
  assert.equal(r.lignes[0].produit, "Volet roulant"); // le plus touché en premier
  const portail = r.lignes.find((l) => l.produit === "Portail");
  assert.equal(portail.dontUtilisation, 1); assert.equal(portail.causes["Non renseignée"], 1);
});

test("CSV du retour qualité : séparateur point-virgule, guillemets échappés", () => {
  const r = G.agregerRetourQualite([ticket("1", { Produit: 'Porte "Alu"; 2 vantaux', "Cause SAV": "Défaut produit" })], periodeNov);
  const csv = G.csvRetourQualite(r);
  const lignes = csv.split("\r\n");
  assert.equal(lignes.length, 2);
  assert.ok(lignes[1].startsWith('"Porte ""Alu""; 2 vantaux";1;1;0;0;0;'));
});
