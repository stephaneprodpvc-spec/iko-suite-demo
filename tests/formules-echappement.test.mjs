// Garde-fou : toute valeur placée entre guillemets dans une formule Airtable doit échapper l'antislash AVANT le guillemet
// (sinon « \" » permet de sortir de la chaîne et de modifier la requête). Lancer : node --test tests/formules-echappement.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dossier = path.resolve(import.meta.dirname, "../api");
const MOTIF_GUILLEMET = `.replace(/"/g, '\\\\"')`;
const MOTIF_ANTISLASH = `.replace(/\\\\/g, "\\\\\\\\")`;

test("aucune formule n'échappe le guillemet sans échapper l'antislash", () => {
  const fautifs = [];
  for (const f of fs.readdirSync(dossier).filter((x) => x.endsWith(".js"))) {
    fs.readFileSync(path.join(dossier, f), "utf8").split("\n").forEach((ligne, i) => {
      if (ligne.includes(MOTIF_GUILLEMET) && !ligne.includes(MOTIF_ANTISLASH + MOTIF_GUILLEMET)) fautifs.push(f + ":" + (i + 1));
    });
  }
  assert.deepEqual(fautifs, []);
});

test("l'échappement double bien l'antislash puis protège le guillemet", () => {
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  assert.equal(esc('a"b'), 'a\\"b');
  assert.equal(esc('a\\"b'), 'a\\\\\\"b'); // l'antislash ne peut plus « manger » le guillemet protecteur
});

// 5e passe : une formule envoyée par le navigateur est enveloppée dans AND(<elle>, <filtre d'entreprise>) ; si elle est déséquilibrée
// elle pouvait refermer le AND plus tôt et neutraliser le filtre d'entreprise.
import { formuleEquilibree } from "../api/airtable-proxy.js";
test("formules de recherche : équilibrées acceptées, piégées refusées", () => {
  for (const ok of ['{Statut}="Nouveau"', 'AND({A}="x",OR({B}=1,{C}=2))', 'FIND("a)b",ARRAYJOIN({Client}))', '{Slug}="a\\"b"', "{Nom}='o\\'k'", 'RECORD_ID()!="rec1"', 'LOWER(TRIM({Email}))="x@y.fr"', ""]) assert.equal(formuleEquilibree(ok), true, ok);
  for (const pas of ['TRUE()) & IF(TRUE(), "x" ', '1=1) OR (1=1', 'TRUE())', '(TRUE()', '{Slug}="a', '{Slug}="a\\"', "FIND('x", 'AND(1=1', ')(', '"' + "x".repeat(2100) + '"']) assert.equal(formuleEquilibree(pas), false, pas);
});
