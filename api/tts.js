// api/tts.js
// Endpoint partage : convertit du texte en voix via ElevenLabs, pour les
// 4 assistants (IKO, Amandine, Max, Toise). La cle ELEVENLABS_API_KEY
// reste cote serveur, jamais exposee au navigateur.

import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";

const MAX_CHARS = 500;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erreur: "Methode non autorisee" });
  }
  if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
  if (!verifierDebit(req)) return reponseBloquee(res, "debit");

  const cle = process.env.ELEVENLABS_API_KEY;
  if (!cle) {
    console.error("ELEVENLABS_API_KEY absente des variables d'environnement");
    return res.status(500).json({ erreur: "Configuration serveur incomplete" });
  }

  try {
    const body = req.body || {};
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
  } catch (e) {
    console.error("Erreur tts:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
