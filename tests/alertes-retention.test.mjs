// Tests : rétention du journal d'audit et suivi du signal « RDV modifié » (api/_alertes.js). Aucun appel réseau.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.AIRTABLE_TOKEN = "test-token";
process.env.AIRTABLE_BASE_ID = "appTEST00000000A";
const { majRdvVus, purgerJournalActions } = await import("../api/_alertes.js");
const fetchReel = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchReel; delete process.env.IKO_JOURNAL_JOURS; });

test("majRdvVus : date de premiere detection conservee, signaux disparus oublies", () => {
  const t0 = 1_000_000;
  const a = majRdvVus(undefined, ["recA", "recB"], t0);
  assert.deepEqual(a.vus, { recA: t0, recB: t0 }); assert.equal(a.change, true);
  const b = majRdvVus(a.vus, ["recA", "recB"], t0 + 5000);
  assert.deepEqual(b.vus, { recA: t0, recB: t0 }); assert.equal(b.change, false, "rien de neuf : pas d'ecriture");
  const c = majRdvVus(b.vus, ["recB", "recC"], t0 + 9000);
  assert.deepEqual(c.vus, { recB: t0, recC: t0 + 9000 }); assert.equal(c.change, true);
  assert.equal(majRdvVus("n'importe quoi", [], 1).change, false);
});

test("purgerJournalActions : supprime seulement les lignes anciennes, par lots de 10", async () => {
  const appels = [];
  globalThis.fetch = async (url, init) => {
    appels.push({ url: String(url), methode: (init && init.method) || "GET" });
    if (!init || !init.method) return { ok: true, json: async () => ({ records: Array.from({ length: 12 }, (_, i) => ({ id: "rec" + i })) }) };
    return { ok: true, json: async () => ({}) };
  };
  const n = await purgerJournalActions({ maintenant: Date.parse("2026-11-02T00:00:00Z") });
  assert.equal(n, 12);
  const lecture = decodeURIComponent(appels[0].url);
  assert.match(lecture, /IS_BEFORE\(\{Date\}, "2026-09-03T00:00:00\.000Z"\)/, "60 jours avant le 2 novembre");
  assert.equal(appels.filter((a) => a.methode === "DELETE").length, 2);
});

test("purgerJournalActions : IKO_JOURNAL_JOURS=0 desactive, et une erreur reseau ne fait jamais echouer le controle", async () => {
  process.env.IKO_JOURNAL_JOURS = "0";
  globalThis.fetch = async () => { throw new Error("ne doit pas etre appele"); };
  assert.equal(await purgerJournalActions(), 0);
  delete process.env.IKO_JOURNAL_JOURS;
  assert.equal(await purgerJournalActions(), 0);
});
