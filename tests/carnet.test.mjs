import { test } from "node:test";
import assert from "node:assert/strict";
process.env.JWT_ACCESS_SECRET = "secret-de-test-carnet";
const { creerCarnet, lireCarnet } = await import("../api/_carnet.js");

const base = { produit: "Fenêtre PVC 2 vantaux", reference: "FAC-2024-118", datePose: "2024-05-10", poseur: "Dupont Menuiserie", garantieAns: 2, slug: "menuiserie-dupont", entreprise: "Menuiserie Dupont" };

test("un carnet créé se relit à l'identique et calcule la garantie", () => {
  const r = creerCarnet(base);
  assert.ok(r.jeton && r.jeton.length > 40);
  const c = lireCarnet(r.jeton, "2025-01-15T10:00:00Z");
  assert.equal(c.produit, "Fenêtre PVC 2 vantaux");
  assert.equal(c.poseur, "Dupont Menuiserie");
  assert.equal(c.slug, "menuiserie-dupont");
  assert.equal(c.garantieJusqu, "2026-05-10");
  assert.equal(c.sousGarantie, true);
  assert.equal(lireCarnet(r.jeton, "2026-05-11T10:00:00Z").sousGarantie, false); // le lendemain de la fin : hors garantie
  assert.equal(lireCarnet(r.jeton, "2026-05-10T23:00:00Z").sousGarantie, true);   // le dernier jour compte
});

test("un jeton modifié ou inventé est refusé (impossible de rallonger sa garantie)", () => {
  const { jeton } = creerCarnet(base);
  const abime = jeton.slice(0, -4) + (jeton.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal(lireCarnet(abime), null);
  assert.equal(lireCarnet("n'importe quoi"), null);
  assert.equal(lireCarnet(""), null);
  assert.equal(lireCarnet(jeton.slice(0, 50)), null);
});

test("deux jetons du même produit sont différents (IV aléatoire)", () => {
  assert.notEqual(creerCarnet(base).jeton, creerCarnet(base).jeton);
});

test("entrées invalides : message clair, aucun jeton", () => {
  assert.ok(creerCarnet({ ...base, produit: "  " }).erreur);
  assert.ok(creerCarnet({ ...base, datePose: "2099-01-01" }).erreur);
  assert.ok(creerCarnet({ ...base, datePose: "10/05/2024" }).erreur);
  assert.ok(creerCarnet({ ...base, datePose: "2024-02-31" }).erreur);
  assert.ok(creerCarnet({ ...base, slug: "" }).erreur);
  assert.ok(creerCarnet({ ...base, slug: 'a"b' }).erreur);
  assert.ok(creerCarnet({ ...base, garantieAns: 99 }).erreur);
});

test("garantie par défaut = 2 ans ; 29 février géré ; balises retirées du texte", () => {
  const c = lireCarnet(creerCarnet({ ...base, garantieAns: undefined, datePose: "2024-02-29" }).jeton, "2025-01-01T00:00:00Z");
  assert.equal(c.garantieAns, 2);
  assert.equal(c.garantieJusqu, "2026-02-28");
  const s = lireCarnet(creerCarnet({ ...base, produit: "Porte <script>x</script>" }).jeton);
  assert.ok(!/[<>]/.test(s.produit));
});

test("sans clé serveur : refus propre", async () => {
  const sauvegarde = process.env.JWT_ACCESS_SECRET;
  delete process.env.JWT_ACCESS_SECRET;
  assert.ok(creerCarnet(base).erreur);
  assert.equal(lireCarnet("x".repeat(80)), null);
  process.env.JWT_ACCESS_SECRET = sauvegarde;
});
