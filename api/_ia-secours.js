// IA de secours (Gemini, gratuit) : relaie un appel Claude (API Anthropic "messages") quand Claude
// est indisponible (credit epuise, cle refusee, panne, quota). Reserve a la DEMO (aucun client
// reel, donnees fictives) : les messages de vrais clients ne partent jamais chez un tiers gratuit.
// Active seulement si GEMINI_API_KEY existe ; coupe avec IKO_SECOURS_IA=0.
//
// Entree : le meme corps que pour Anthropic ({ system, messages, tools, max_tokens, temperature }).
// Sortie : un objet type Response dont json() renvoie la forme Anthropic ({ content, stop_reason }),
// pour que le code appelant n'ait rien a changer.

// Google retire regulierement d'anciens modeles (gemini-2.5-flash : 404 le 31/10/2026) ; le modele se
// change sans toucher au code avec la variable Vercel GEMINI_MODELE.
const MODELE_PAR_DEFAUT = "gemini-3.8-flash";
const MODELE_REPLI = "gemini-3.5-flash-lite"; // le plus leger de la serie 3.5, moins souvent sature
const URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

// Un refus de Claude justifie le secours : credit epuise, cle refusee, quota, panne.
export function claudeIndisponible(status, detail) {
  if (status === 401 || status === 402 || status === 403 || status === 429 || status >= 500) return true;
  return status === 400 && /credit balance|billing|quota/i.test(String(detail || ""));
}

// Schema d'outil Anthropic -> schema Gemini (sous-ensemble OpenAPI : pas de additionalProperties, default...).
function nettoyerSchema(s) {
  if (Array.isArray(s)) return s.map(nettoyerSchema);
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (["additionalProperties", "default", "examples", "$schema", "title"].includes(k)) continue;
    out[k] = k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([n, p]) => [n, nettoyerSchema(p)])) : nettoyerSchema(v);
  }
  return out;
}

function texteSysteme(system) {
  if (Array.isArray(system)) return system.map((b) => (b && b.text) || "").filter(Boolean).join("\n\n");
  return typeof system === "string" ? system : "";
}

function enJsonOuTexte(contenu) {
  if (typeof contenu !== "string") return contenu;
  try { return JSON.parse(contenu); } catch { return { texte: contenu }; }
}

// Messages Anthropic -> contenus Gemini. Les images (blocs "image") sont remplacees par une mention.
export function versContenusGemini(messages) {
  const nomsOutils = new Map();
  const contenus = [];
  for (const m of messages || []) {
    const role = m.role === "assistant" ? "model" : "user";
    const blocs = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
    const parts = [];
    for (const b of blocs) {
      if (!b) continue;
      if (b.type === "text" && b.text) parts.push({ text: b.text });
      else if (b.type === "image") parts.push({ text: "[Photo jointe : non visible par l'IA de secours]" });
      else if (b.type === "tool_use") {
        nomsOutils.set(b.id, b.name);
        const part = { functionCall: { name: b.name, args: b.input || {} } };
        if (b.thoughtSignature) part.thoughtSignature = b.thoughtSignature;
        parts.push(part);
      } else if (b.type === "tool_result") {
        const rep = enJsonOuTexte(b.content);
        parts.push({ functionResponse: { name: nomsOutils.get(b.tool_use_id) || "outil", response: rep && typeof rep === "object" && !Array.isArray(rep) ? rep : { resultat: rep } } });
      }
    }
    if (!parts.length) continue;
    const dernier = contenus[contenus.length - 1];
    if (dernier && dernier.role === role) dernier.parts.push(...parts); // Gemini veut une alternance stricte
    else contenus.push({ role, parts });
  }
  return contenus;
}

// Reponse Gemini -> forme Anthropic.
export function versReponseAnthropic(data) {
  const parts = (((data || {}).candidates || [])[0] || {}).content;
  const liste = (parts && parts.parts) || [];
  const content = [];
  let n = 0;
  for (const p of liste) {
    if (p.thought) continue;
    if (p.functionCall) {
      const bloc = { type: "tool_use", id: "gem_" + Date.now().toString(36) + "_" + n++, name: p.functionCall.name, input: p.functionCall.args || {} };
      if (p.thoughtSignature) bloc.thoughtSignature = p.thoughtSignature;
      content.push(bloc);
    } else if (typeof p.text === "string" && p.text) content.push({ type: "text", text: p.text });
  }
  return { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", fournisseur: "gemini" };
}

export function corpsGemini(corps) {
  const out = {
    contents: versContenusGemini(corps.messages),
    // Les modeles Gemini recents "reflechissent" avant de repondre et ces jetons comptent dans la limite :
    // on laisse de la marge pour que la reponse ne soit pas tronquee.
    generationConfig: { maxOutputTokens: Math.max((corps.max_tokens || 800) * 3, 2048), temperature: corps.temperature == null ? 0.6 : corps.temperature },
  };
  const sys = texteSysteme(corps.system);
  if (sys) out.systemInstruction = { parts: [{ text: sys }] };
  const outils = (corps.tools || []).filter((t) => t && t.name);
  if (outils.length) out.tools = [{ functionDeclarations: outils.map((t) => ({ name: t.name, description: t.description || "", parameters: nettoyerSchema(t.input_schema || { type: "object", properties: {} }) })) }];
  return out;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Modeles essayes dans l'ordre (GEMINI_MODELE = liste separee par des virgules). Un modele sature (503,
// 429) est retente une fois, puis on passe au suivant ; un modele inconnu (404) est saute.
function modelesGemini() {
  const liste = String(process.env.GEMINI_MODELE || "").split(",").map((s) => s.trim()).filter(Boolean);
  return liste.length ? liste : [MODELE_PAR_DEFAUT, MODELE_REPLI];
}

async function appelGemini(corps, cleGemini) {
  const requete = JSON.stringify(corpsGemini(corps));
  for (const modele of modelesGemini()) {
    for (let essai = 0; essai < 2; essai++) {
      const r = await fetch(URL_BASE + encodeURIComponent(modele) + ":generateContent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": cleGemini },
        body: requete,
      });
      if (r.ok) return versReponseAnthropic(await r.json());
      const detail = await r.text();
      console.error("Secours Gemini (" + modele + ") : erreur", r.status, String(detail).slice(0, 200));
      if ((r.status === 503 || r.status === 429) && essai === 0) { await pause(1500); continue; }
      break;
    }
  }
  return null;
}

function faireReponse(status, data) {
  const texte = JSON.stringify(data);
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => texte };
}

// Appelle Claude ; si Claude est indisponible ET qu'on est en demo, bascule sur Gemini.
// options.demo : true quand aucun client reel n'est en jeu.
export async function messagesAvecSecours({ cle, corps, demo, version = "2023-06-01" }) {
  let reponse = null;
  let detail = "";
  try {
    reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": version },
      body: JSON.stringify(corps),
    });
    if (reponse.ok) return reponse;
    detail = await reponse.text();
  } catch (e) {
    detail = String((e && e.message) || e);
  }
  const status = reponse ? reponse.status : 599;
  const secoursPossible = demo && process.env.GEMINI_API_KEY && process.env.IKO_SECOURS_IA !== "0" && (!reponse || claudeIndisponible(status, detail));
  if (!secoursPossible) {
    // Meme comportement qu'avant : l'appelant relit text() pour journaliser l'erreur.
    return reponse ? { ok: false, status, text: async () => detail, json: async () => { try { return JSON.parse(detail); } catch { return {}; } } } : faireReponse(502, { error: detail });
  }
  console.warn("Claude indisponible (" + status + ") : secours Gemini (demo)");
  const data = await appelGemini(corps, process.env.GEMINI_API_KEY);
  return data ? faireReponse(200, data) : { ok: false, status, text: async () => detail, json: async () => ({}) };
}
