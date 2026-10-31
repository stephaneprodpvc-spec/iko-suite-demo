import test from "node:test";
import assert from "node:assert/strict";
import { messagesAvecSecours, versContenusGemini, corpsGemini, versReponseAnthropic, claudeIndisponible } from "../api/_ia-secours.js";

const fetchReel = globalThis.fetch;
let appels;
function simuler({ anthropic, gemini }) {
  appels = [];
  globalThis.fetch = async (url, init) => {
    appels.push({ url: String(url), init });
    const h = new URL(String(url)).hostname;
    const rep = h === "api.anthropic.com" ? anthropic : gemini;
    return { ok: rep.status < 300, status: rep.status, text: async () => JSON.stringify(rep.body), json: async () => rep.body };
  };
}
test.afterEach(() => { globalThis.fetch = fetchReel; delete process.env.GEMINI_API_KEY; delete process.env.IKO_SECOURS_IA; });

const CREDIT = { status: 400, body: { error: { message: "Your credit balance is too low to access the Anthropic API." } } };
const corps = {
  model: "x", max_tokens: 800, temperature: 0.6,
  system: [{ type: "text", text: "Tu es Amandine.", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "lister_creneaux", description: "d", input_schema: { type: "object", additionalProperties: false, properties: { agence: { type: "string" } }, required: ["agence"] } }],
  messages: [{ role: "user", content: "Bonjour" }],
};

test("claudeIndisponible : credit, cle refusee, quota, panne ; pas une erreur de requete", () => {
  assert.equal(claudeIndisponible(400, "credit balance is too low"), true);
  assert.equal(claudeIndisponible(401, ""), true);
  assert.equal(claudeIndisponible(429, ""), true);
  assert.equal(claudeIndisponible(529, ""), true);
  assert.equal(claudeIndisponible(400, "messages: invalid"), false);
});

test("demo + credit epuise : bascule sur Gemini et renvoie la forme Anthropic", async () => {
  process.env.GEMINI_API_KEY = "cle-factice";
  simuler({ anthropic: CREDIT, gemini: { status: 200, body: { candidates: [{ content: { parts: [{ text: "Bonjour, je suis Amandine." }] } }] } } });
  const r = await messagesAvecSecours({ cle: "k", corps, demo: true });
  assert.equal(r.ok, true);
  const d = await r.json();
  assert.equal(d.stop_reason, "end_turn");
  assert.equal(d.content[0].text, "Bonjour, je suis Amandine.");
  assert.equal(appels.length, 2);
  assert.ok(appels[1].url.includes("generativelanguage.googleapis.com"));
  assert.equal(appels[1].init.headers["x-goog-api-key"], "cle-factice");
  assert.ok(!appels[1].url.includes("cle-factice"), "la cle ne doit jamais etre dans l'URL");
});

test("client reel (demo=false) : JAMAIS de secours, l'erreur Claude est renvoyee telle quelle", async () => {
  process.env.GEMINI_API_KEY = "cle-factice";
  simuler({ anthropic: CREDIT, gemini: { status: 200, body: {} } });
  const r = await messagesAvecSecours({ cle: "k", corps, demo: false });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(appels.length, 1);
});

test("sans GEMINI_API_KEY ou avec IKO_SECOURS_IA=0 : pas de secours", async () => {
  simuler({ anthropic: CREDIT, gemini: { status: 200, body: {} } });
  assert.equal((await messagesAvecSecours({ cle: "k", corps, demo: true })).ok, false);
  process.env.GEMINI_API_KEY = "c";
  process.env.IKO_SECOURS_IA = "0";
  assert.equal((await messagesAvecSecours({ cle: "k", corps, demo: true })).ok, false);
  assert.equal(appels.every((a) => a.url.includes("anthropic")), true);
});

test("Claude fonctionne : reponse directe, Gemini jamais appele", async () => {
  process.env.GEMINI_API_KEY = "c";
  simuler({ anthropic: { status: 200, body: { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" } }, gemini: { status: 200, body: {} } });
  const r = await messagesAvecSecours({ cle: "k", corps, demo: true });
  assert.equal((await r.json()).content[0].text, "ok");
  assert.equal(appels.length, 1);
});

test("appel d'outil Gemini -> tool_use Anthropic, et aller-retour tool_result -> functionResponse", async () => {
  const rep = versReponseAnthropic({ candidates: [{ content: { parts: [{ functionCall: { name: "lister_creneaux", args: { agence: "Agence 1" } }, thoughtSignature: "sig" }] } }] });
  assert.equal(rep.stop_reason, "tool_use");
  assert.equal(rep.content[0].name, "lister_creneaux");
  assert.equal(rep.content[0].thoughtSignature, "sig");
  const contenus = versContenusGemini([
    { role: "user", content: "Je veux un RDV" },
    { role: "assistant", content: rep.content },
    { role: "user", content: [{ type: "tool_result", tool_use_id: rep.content[0].id, content: JSON.stringify({ creneaux: [1, 2] }) }] },
  ]);
  assert.equal(contenus.length, 3);
  assert.equal(contenus[1].role, "model");
  assert.equal(contenus[1].parts[0].functionCall.args.agence, "Agence 1");
  assert.equal(contenus[1].parts[0].thoughtSignature, "sig");
  assert.equal(contenus[2].parts[0].functionResponse.name, "lister_creneaux");
  assert.deepEqual(contenus[2].parts[0].functionResponse.response, { creneaux: [1, 2] });
});

test("corps Gemini : systeme, schema d'outil nettoye, images remplacees", () => {
  const g = corpsGemini({ ...corps, messages: [{ role: "user", content: [{ type: "text", text: "regarde" }, { type: "image", source: { type: "url", url: "https://x/y.jpg" } }] }] });
  assert.equal(g.systemInstruction.parts[0].text, "Tu es Amandine.");
  assert.equal(g.tools[0].functionDeclarations[0].name, "lister_creneaux");
  assert.equal("additionalProperties" in g.tools[0].functionDeclarations[0].parameters, false);
  assert.match(JSON.stringify(g.contents), /Photo jointe/);
  assert.equal(g.generationConfig.maxOutputTokens, 800);
});

test("Gemini sature (503) : une nouvelle tentative, puis un autre modele, sans jamais exposer la cle", async () => {
  process.env.GEMINI_API_KEY = "cle-factice";
  process.env.GEMINI_MODELE = "modele-a,modele-b";
  const vus = [];
  let n = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("anthropic")) return { ok: false, status: 400, text: async () => "credit balance is too low", json: async () => ({}) };
    vus.push(u);
    n++;
    if (n <= 2) return { ok: false, status: 503, text: async () => "high demand", json: async () => ({}) }; // modele-a : 2 refus
    return { ok: true, status: 200, text: async () => "", json: async () => ({ candidates: [{ content: { parts: [{ text: "salut" }] } }] }) }; // modele-b : ok
  };
  const r = await messagesAvecSecours({ cle: "k", corps, demo: true });
  delete process.env.GEMINI_MODELE;
  assert.equal(r.ok, true);
  assert.equal((await r.json()).content[0].text, "salut");
  assert.equal(vus.length, 3);
  assert.ok(vus[0].includes("modele-a") && vus[1].includes("modele-a") && vus[2].includes("modele-b"));
  assert.ok(vus.every((u) => !u.includes("cle-factice")));
});
