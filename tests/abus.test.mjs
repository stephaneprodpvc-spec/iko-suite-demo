// Tests : surveillance anti-abus (blocage 24 h des faux liens de suivi). Lancer : node --test tests/abus.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
const { signalerAbus, estBloque } = await import("../api/_abus.js");

const req = (ip) => ({ headers: { "x-forwarded-for": ip }, socket: {} });

test("9 faux liens : pas encore bloqué", () => {
  const r = req("203.0.113.10");
  for (let i = 0; i < 9; i++) signalerAbus(r, "jeton-invalide");
  assert.equal(estBloque(r), false);
});

test("10 faux liens ou numéros inventés : bloqué", () => {
  const r = req("203.0.113.11");
  for (let i = 0; i < 5; i++) signalerAbus(r, "jeton-invalide");
  for (let i = 0; i < 5; i++) signalerAbus(r, "suivi-introuvable");
  assert.equal(estBloque(r), true);
});

test("le blocage dure bien plus que 15 minutes", () => {
  const r = req("203.0.113.12");
  for (let i = 0; i < 10; i++) signalerAbus(r, "jeton-invalide");
  const vrai = Date.now;
  Date.now = () => vrai() + 2 * 3600 * 1000; // 2 h plus tard
  try { assert.equal(estBloque(r), true); } finally { Date.now = vrai; }
  Date.now = () => vrai() + 25 * 3600 * 1000; // 25 h plus tard
  try { assert.equal(estBloque(r), false); } finally { Date.now = vrai; }
});

test("une autre cause (origine refusée) ne déclenche pas le blocage de 24 h", () => {
  const r = req("203.0.113.13");
  for (let i = 0; i < 20; i++) signalerAbus(r, "origine-refusee");
  assert.equal(estBloque(r), false);
});

test("l'adresse locale n'est jamais bloquée", () => {
  const r = req("127.0.0.1");
  for (let i = 0; i < 50; i++) signalerAbus(r, "jeton-invalide");
  assert.equal(estBloque(r), false);
});
