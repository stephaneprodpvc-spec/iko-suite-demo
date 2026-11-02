// Tests : guide d'utilisation (guide-contenu.json), aide integree et connaissance des assistants. Aucun appel reseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const guide = JSON.parse(fs.readFileSync(new URL("../guide-contenu.json", import.meta.url), "utf8"));
const { resumeGuide, blocSystemeIko } = await import("../api/_systeme-iko.js");
const ROLES = ["client", "patron", "agence", "technicien", "editeur"];
const lire = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const norm = (t) => t.replace(/\\'/g, "'").replace(/[’‘]/g, "'").replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("structure : identifiants uniques, roles connus, fiches completes", () => {
  const ids = guide.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "identifiant de fiche en double");
  for (const s of guide.sections) {
    assert.ok(s.titre && s.resume, "fiche incomplete : " + s.id);
    assert.ok(Array.isArray(s.roles) && s.roles.length && s.roles.every((r) => ROLES.includes(r)), "roles invalides : " + s.id);
    assert.ok(!s.etapes || s.etapes.every((e) => typeof e === "string" && e.length > 5), "etape vide : " + s.id);
  }
});

test("aide de chaque ecran : les fiches existent, la liste Bien demarrer existe pour chaque role interne, les liens pointent sur des pages reelles", () => {
  const ids = new Set(guide.sections.map((s) => s.id));
  for (const [page, liste] of Object.entries(guide.aide_page)) {
    assert.ok(fs.existsSync(new URL("../" + page + ".html", import.meta.url)), "page inconnue : " + page);
    assert.ok(lire(page + ".html").includes('src="/iko-aide.js"'), "bouton d'aide absent de " + page + ".html");
    liste.forEach((id) => assert.ok(ids.has(id), page + " : fiche inconnue " + id));
  }
  for (const role of ["patron", "agence", "technicien", "editeur"]) {
    const etapes = guide.demarrer[role];
    assert.ok(etapes && etapes.length >= 5, "Bien demarrer trop court : " + role);
    assert.equal(new Set(etapes.map((x) => x.id)).size, etapes.length);
    etapes.filter((x) => x.lien).forEach((x) => { const f = x.lien.split("#")[0].split("?")[0].replace(/^\//, ""); assert.ok(fs.existsSync(new URL("../" + f, import.meta.url)), "lien mort : " + x.lien); });
  }
});

test("le guide ne decrit que des boutons qui existent vraiment dans les ecrans", () => {
  const attendus = [
    ["technicien.html", "Je pars — prévenir le client"], ["technicien.html", "Gérer l'intervention"], ["technicien.html", "Confirmer — SAV terminé"],
    ["technicien.html", "Demander à Max"], ["technicien.html", "Visite effectuée"], ["technicien.html", "Annuler le RDV"], ["technicien.html", "Pièce à commander"],
    ["acces.html", "Créer l'accès"], ["acces.html", "Nouveau mot de passe"], ["acces.html", "Couper l'accès"],
    ["dashboard.html", "Bloquer les créneaux"], ["dashboard.html", "Centrale de direction"], ["dashboard.html", "Mise en service"], ["dashboard.html", "Assigner"],
    ["dashboard.html", "Messages clients"], ["dashboard.html", "Nouveau RDV"], ["dashboard.html", "Marquer commandée"], ["dashboard.html", "Envoyer le devis au client"],
    ["equipe.html", "Ajouter un technicien"], ["entretien.html", "Valider le contrat"], ["entretien.html", "Marquer traitée"],
    ["admin.html", "Créer son IKO"], ["admin.html", "Nouveau client"], ["admin.html", "Connaissance entreprise"],
    ["suivi.html", "Changer la date d'intervention"], ["suivi.html", "Annuler ma demande"], ["suivi.html", "Gérer ma demande"], ["suivi.html", "Échanger avec votre agence"],
    ["devis.html", "Signer électroniquement mon devis"], ["devis.html", "Je refuse ce devis"], ["avis.html", "Envoyer mon avis"],
    ["index.html", "Confirmer et envoyer ma demande"], ["contrat-entretien.html", "Demander mon contrat"],
  ];
  const manquants = attendus.filter(([f, t]) => !norm(lire(f)).toLowerCase().includes(norm(t).toLowerCase()));
  assert.deepEqual(manquants, [], "libelles du guide introuvables a l'ecran");
});

test("assistants : IKO, Max et Amandine recoivent le guide de leur role ; sans fichier ils continuent sans guide", () => {
  assert.match(resumeGuide("dashboard"), /Mes accès|Mes acc/);
  assert.match(resumeGuide("technicien"), /Je pars/);
  assert.match(resumeGuide("amandine"), /Suivre ma demande/);
  assert.ok(!resumeGuide("amandine").includes("Centrale de direction"), "Amandine ne parle jamais des ecrans internes");
  assert.ok(!resumeGuide("amandine").includes("Déclarer une panne"), "la declaration est faite par Amandine elle-meme");
  assert.ok(!resumeGuide("technicien").includes("Créer et gérer un client") && !resumeGuide("technicien").includes("Créer son IKO"), "Max ne recoit pas les fiches de l'editeur");
  for (const a of ["dashboard", "technicien", "amandine", "suivi"]) assert.ok(resumeGuide(a).length < 10000, "guide trop long pour " + a);
  assert.equal(resumeGuide("dashboard", null), "");
  assert.equal(resumeGuide("inconnu"), "");
  assert.ok(blocSystemeIko("dashboard").includes("LES MODULES DU SYSTEME IKO"));
});

test("page du guide et moteur d'aide : pas de HTML injecte sans echappement", () => {
  const g = lire("guide.html"), a = lire("iko-aide.js");
  assert.ok(g.includes("function esc(") && a.includes("function esc("));
  // les contenus du guide passent par esc() avant innerHTML
  assert.ok(!/innerHTML\s*=\s*[^;]*\bs\.(titre|resume|astuce)\b(?![^;]*esc\()/.test(g.replace(/esc\(s\.(titre|resume|astuce)\)/g, "")), "contenu non echappe dans guide.html");
  assert.ok(g.includes('name="robots" content="noindex"'));
});

test("compatibilite Vercel : aucun fichier de l'API n'utilise import.meta (convertis en CommonJS, ils planteraient tous les assistants)", () => {
  const dossier = new URL("../api/", import.meta.url);
  const fautifs = fs.readdirSync(dossier).filter((f) => f.endsWith(".js")).filter((f) => {
    const code = fs.readFileSync(new URL(f, dossier), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    return /\bimport\.meta\b/.test(code);
  });
  assert.deepEqual(fautifs, []);
});
