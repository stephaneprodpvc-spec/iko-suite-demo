// api/tts.js
// Endpoint partage, avec DEUX usages distincts selon le Content-Type recu :
// - application/json { texte, voice_id } -> synthese vocale ElevenLabs
//   (comportement historique, utilise par les 4 assistants : IKO, Amandine,
//   Max, Toise. INCHANGE.)
// - audio/* (Blob enregistre via MediaRecorder) -> transcription Whisper
//   OpenAI, utilisee par le micro du dashboard (IKO). Ajoutee ici plutot
//   que dans un fichier /api separe pour ne pas depasser la limite de
//   12 fonctions serverless du plan Vercel gratuit (deja au plafond).
// Les deux cles API (ELEVENLABS_API_KEY, OPENAI_API_KEY) restent cote
// serveur, jamais exposees au navigateur.

import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";

const MAX_CHARS = 500;

// bodyParser desactive : on doit pouvoir lire soit du JSON soit de l'audio
// brut selon le cas, donc lecture manuelle du corps dans les deux branches.
export const config = {
  api: {
    bodyParser: false,
  },
};

async function lireCorpsBrut(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function synthetiserVoix(req, res) {
  const cle = process.env.ELEVENLABS_API_KEY;
  if (!cle) {
    console.error("ELEVENLABS_API_KEY absente des variables d'environnement");
    return res.status(500).json({ erreur: "Configuration serveur incomplete" });
  }

  const brut = await lireCorpsBrut(req);
  let body = {};
  try { body = brut.length ? JSON.parse(brut.toString("utf-8")) : {}; } catch (e) { body = {}; }
  const texte = String(body.texte || "").slice(0, MAX_CHARS).trim();
  const voiceId = String(body.voice_id || "").trim();
  if (!texte || !voiceId) {
    return res.status(400).json({ erreur: "texte et voice_id requis" });
  }

  const reponse = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
    method: "POST",
    headers: {
      "xi-api-key": cle,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text: texte,
      model_id: "eleven_flash_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!reponse.ok) {
    const detail = await reponse.text();
    console.error("Erreur ElevenLabs:", reponse.status, detail);
    return res.status(502).json({ erreur: "Synthèse vocale indisponible." });
  }

  const buffer = Buffer.from(await reponse.arrayBuffer());
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(buffer);
}

async function transcrireAudio(req, res, contentType) {
  const cle = process.env.OPENAI_API_KEY;
  if (!cle) {
    console.error("OPENAI_API_KEY absente des variables d'environnement");
    return res.status(500).json({ erreur: "Configuration serveur incomplete" });
  }

  const audioBuffer = await lireCorpsBrut(req);
  if (!audioBuffer || !audioBuffer.length) {
    return res.status(400).json({ erreur: "Aucun audio recu" });
  }
  if (audioBuffer.length > 15 * 1024 * 1024) {
    return res.status(413).json({ erreur: "Enregistrement trop volumineux" });
  }

  const extension = contentType.includes("mp4") ? "mp4" : contentType.includes("wav") ? "wav" : "webm";
  const formulaire = new FormData();
  formulaire.append("file", new Blob([audioBuffer], { type: contentType }), "commande." + extension);
  formulaire.append("model", "whisper-1");
  formulaire.append("language", "fr");

  const reponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + cle },
    body: formulaire,
  });

  if (!reponse.ok) {
    const detail = await reponse.text();
    console.error("Erreur API Whisper:", reponse.status, detail);
    return res.status(502).json({ erreur: "Transcription momentanement indisponible." });
  }

  const data = await reponse.json();
  const texte = (data.text || "").trim();
  return res.status(200).json({ texte });
}

async function recupererUsageElevenLabs(req, res) {
  const cle = process.env.ELEVENLABS_API_KEY;
  if (!cle) {
    return res.status(500).json({ erreur: "Configuration serveur incomplete" });
  }
  try {
    const reponse = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": cle },
    });
    if (!reponse.ok) {
      return res.status(502).json({ erreur: "Usage ElevenLabs indisponible." });
    }
    const data = await reponse.json();
    return res.status(200).json({
      utilises: data.character_count,
      limite: data.character_limit,
      restants: data.character_limit - data.character_count,
    });
  } catch (e) {
    console.error("Erreur usage ElevenLabs:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
    return await recupererUsageElevenLabs(req, res);
  }
  if (req.method !== "POST") {
    return res.status(405).json({ erreur: "Methode non autorisee" });
  }
  if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
  if (!verifierDebit(req)) return reponseBloquee(res, "debit");

  const contentType = req.headers["content-type"] || "";

  try {
    if (contentType.includes("audio/")) {
      return await transcrireAudio(req, res, contentType);
    }
    return await synthetiserVoix(req, res);
  } catch (e) {
    console.error("Erreur tts/transcribe:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
