// api/_cles-acces.js — connexion par empreinte / visage (clés d'accès WebAuthn, « passkeys »).
// Appele depuis api/verif-securite.js (fichier prefixe "_" : pas une fonction Vercel). Aucune dependance externe.
// L'iPhone/iPad garde la cle privee dans son coffre materiel et ne la donne qu'apres Face ID / Touch ID ;
// le serveur ne stocke que la cle PUBLIQUE. Le defi (challenge) est un jeton signe de 5 minutes : aucun etat serveur.
//
// Champs Airtable a creer dans la table Utilisateurs (texte, sauf compteur = nombre) :
//   « Clé d'accès ID », « Clé d'accès publique » (texte long), « Clé d'accès compteur » (nombre), « Clé d'accès appareil ».
import crypto from "crypto";
import jwt from "jsonwebtoken";

const CHAMP_ID = "Clé d'accès ID", CHAMP_CLE = "Clé d'accès publique", CHAMP_COMPTEUR = "Clé d'accès compteur", CHAMP_APPAREIL = "Clé d'accès appareil";
const B64U = /^[A-Za-z0-9_-]{16,1400}$/;

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const deB64u = (s) => Buffer.from(String(s), "base64url");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const secretDefi = () => crypto.createHash("sha256").update("webauthn|" + (process.env.JWT_ACCESS_SECRET || "")).digest("hex");

// --- Decodeur CBOR minimal (suffisant pour l'attestation et la cle publique COSE) ---
function cbor(buf, o = 0) {
  const t = buf[o], maj = t >> 5, ai = t & 31;
  o++;
  let n = ai;
  if (ai === 24) { n = buf[o]; o += 1; }
  else if (ai === 25) { n = buf.readUInt16BE(o); o += 2; }
  else if (ai === 26) { n = buf.readUInt32BE(o); o += 4; }
  else if (ai === 27) { n = Number(buf.readBigUInt64BE(o)); o += 8; }
  else if (ai > 27) throw new Error("CBOR non gere");
  if (maj === 0) return [n, o];
  if (maj === 1) return [-1 - n, o];
  if (maj === 2) return [buf.subarray(o, o + n), o + n];
  if (maj === 3) return [buf.subarray(o, o + n).toString("utf8"), o + n];
  if (maj === 4) { const a = []; for (let i = 0; i < n; i++) { const [v, p] = cbor(buf, o); a.push(v); o = p; } return [a, o]; }
  if (maj === 5) { const m = new Map(); for (let i = 0; i < n; i++) { const [k, p1] = cbor(buf, o); const [v, p2] = cbor(buf, p1); m.set(k, v); o = p2; } return [m, o]; }
  if (maj === 6) return cbor(buf, o);
  if (maj === 7) return [ai === 20 ? false : ai === 21 ? true : null, o];
  throw new Error("CBOR non gere");
}

function analyserAuthData(ad) {
  if (ad.length < 37) throw new Error("authData trop court");
  const sortie = { rpIdHash: ad.subarray(0, 32), flags: ad[32], compteur: ad.readUInt32BE(33) };
  if (sortie.flags & 0x40) {
    const longueur = ad.readUInt16BE(53);
    sortie.idCle = ad.subarray(55, 55 + longueur);
    sortie.coseCle = cbor(ad, 55 + longueur)[0];
  }
  return sortie;
}

function cleVersSpki(cose) {
  const alg = cose.get(3), kty = cose.get(1);
  let jwk;
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) jwk = { kty: "EC", crv: "P-256", x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) };
  else if (kty === 3 && alg === -257) jwk = { kty: "RSA", n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) };
  else throw new Error("Type de clé non pris en charge.");
  return crypto.createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "der" });
}

// Identite du site : « rpId » = nom de domaine sans port ; origine attendue = https (http en local).
function identiteSite(req) {
  const host = String((req.headers && req.headers.host) || "").toLowerCase();
  const rpId = host.replace(/:\d+$/, "");
  const local = rpId === "localhost" || rpId === "127.0.0.1";
  if (!rpId || !/^[a-z0-9.-]+$/.test(rpId)) throw new Error("Adresse du site invalide.");
  return { rpId, origine: (local ? "http://" : "https://") + host };
}

function verifierClientData(clientDataJSON, attendu) {
  const brut = deB64u(clientDataJSON);
  let cd; try { cd = JSON.parse(brut.toString("utf8")); } catch (e) { throw new Error("Réponse illisible."); }
  if (cd.type !== attendu.type) throw new Error("Type de réponse inattendu.");
  if (cd.challenge !== attendu.defi) throw new Error("Défi invalide ou expiré.");
  if (cd.origin !== attendu.origine) throw new Error("Origine refusée.");
  return brut;
}

function jetonDefi(charge) { return jwt.sign(charge, secretDefi(), { expiresIn: 300 }); }
function lireJetonDefi(jeton, genre) {
  let p; try { p = jwt.verify(String(jeton || ""), secretDefi()); } catch (e) { throw new Error("Défi invalide ou expiré : recommence."); }
  if (p.k !== genre) throw new Error("Défi invalide.");
  return p;
}

const base = (ctx) => "https://api.airtable.com/v0/" + ctx.AIRTABLE_BASE + "/" + encodeURIComponent(ctx.UTILISATEURS_TABLE);
async function lireParId(ctx, id) {
  const r = await fetch(base(ctx) + "/" + encodeURIComponent(id), { headers: ctx.airtableHeaders() });
  return r.ok ? r.json() : null;
}

// --- Enregistrer une cle d'acces (utilisateur DEJA connecte avec son mot de passe) ---
export async function optionsEnregistrement(req, res, ctx) {
  const session = ctx.verifierSession(req);
  if (!session || session.mdpAChanger || !session.userId || session.userId === "demo") {
    return res.status(403).json({ erreur: "Connecte-toi d'abord avec ton compte personnel (identifiant + mot de passe)." });
  }
  const rec = await lireParId(ctx, session.userId);
  if (!rec) return res.status(404).json({ erreur: "Compte introuvable." });
  const { rpId } = identiteSite(req);
  const defi = b64u(crypto.randomBytes(32));
  const identifiant = (rec.fields || {})["Identifiant"] || "compte";
  return res.status(200).json({
    jeton: jetonDefi({ k: "enreg", c: defi, u: session.userId }),
    options: {
      challenge: defi, rp: { id: rpId, name: "IKO" },
      user: { id: b64u(Buffer.from(session.userId)), name: identifiant, displayName: identifiant },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", requireResidentKey: true, userVerification: "required" },
      attestation: "none", timeout: 60000,
    },
  });
}

export async function enregistrerCle(req, res, ctx) {
  const session = ctx.verifierSession(req);
  if (!session || session.mdpAChanger || !session.userId || session.userId === "demo") return res.status(403).json({ erreur: "Connexion requise." });
  const { jeton, clientDataJSON, attestationObject, appareil } = req.body || {};
  try {
    const defi = lireJetonDefi(jeton, "enreg");
    if (defi.u !== session.userId) throw new Error("Défi invalide.");
    const { rpId, origine } = identiteSite(req);
    verifierClientData(clientDataJSON, { type: "webauthn.create", defi: defi.c, origine });
    const att = cbor(deB64u(attestationObject))[0];
    const ad = analyserAuthData(att.get("authData"));
    if (!ad.rpIdHash.equals(sha256(rpId))) throw new Error("Site non reconnu.");
    if (!(ad.flags & 0x01) || !(ad.flags & 0x04)) throw new Error("Face ID / empreinte non confirmé.");
    if (!ad.idCle || !ad.coseCle) throw new Error("Clé absente de la réponse.");
    const spki = cleVersSpki(ad.coseCle);
    const champs = { [CHAMP_ID]: b64u(ad.idCle), [CHAMP_CLE]: spki.toString("base64"), [CHAMP_COMPTEUR]: ad.compteur, [CHAMP_APPAREIL]: String(appareil || "").replace(/[\u0000-\u001f]/g, "").slice(0, 80) };
    const r = await fetch(base(ctx) + "/" + encodeURIComponent(session.userId), { method: "PATCH", headers: ctx.airtableHeaders(), body: JSON.stringify({ fields: champs }) });
    if (!r.ok) {
      console.error("cle_enregistrer HTTP", r.status);
      return res.status(r.status === 422 ? 409 : 502).json({ erreur: r.status === 422 ? "Les champs « Clé d'accès … » n'existent pas encore dans la table Utilisateurs d'Airtable : à créer d'abord." : "Enregistrement impossible." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(400).json({ erreur: e.message || "Enregistrement refusé." }); }
}

export async function etatCle(req, res, ctx) {
  const session = ctx.verifierSession(req);
  if (!session || !session.userId || session.userId === "demo") return res.status(200).json({ possible: false, active: false });
  const rec = await lireParId(ctx, session.userId);
  const f = (rec && rec.fields) || {};
  return res.status(200).json({ possible: true, active: !!f[CHAMP_ID], appareil: f[CHAMP_APPAREIL] || "" });
}

export async function supprimerCle(req, res, ctx) {
  const session = ctx.verifierSession(req);
  if (!session || session.mdpAChanger || !session.userId || session.userId === "demo") return res.status(403).json({ erreur: "Connexion requise." });
  await ctx.majUtilisateur(session.userId, { [CHAMP_ID]: null, [CHAMP_CLE]: null, [CHAMP_COMPTEUR]: null, [CHAMP_APPAREIL]: null });
  return res.status(200).json({ ok: true });
}

// --- Connexion par cle d'acces (public, limite de debit cote appelant) ---
export function optionsConnexion(req, res) {
  const { rpId } = identiteSite(req);
  const defi = b64u(crypto.randomBytes(32));
  return res.status(200).json({ jeton: jetonDefi({ k: "conn", c: defi }), options: { challenge: defi, rpId, userVerification: "required", timeout: 60000, allowCredentials: [] } });
}

export async function connexionCle(req, res, ctx) {
  const { jeton, id, clientDataJSON, authenticatorData, signature } = req.body || {};
  const echec = () => { ctx.signalerAbus(req, "connexion-echouee"); return res.status(401).json({ erreur: "Connexion par empreinte / visage refusée." }); };
  try {
    if (!B64U.test(String(id || "")) || !authenticatorData || !signature) return echec();
    const defi = lireJetonDefi(jeton, "conn");
    const { rpId, origine } = identiteSite(req);
    const brutClient = verifierClientData(clientDataJSON, { type: "webauthn.get", defi: defi.c, origine });
    const url = base(ctx) + "?filterByFormula=" + encodeURIComponent("{" + CHAMP_ID + "}=\"" + id + "\"") + "&maxRecords=1";
    const r = await fetch(url, { headers: ctx.airtableHeaders() });
    const rec = r.ok ? ((await r.json()).records || [])[0] : null;
    if (!rec) return echec();
    const f = rec.fields || {};
    if ((f["Statut"] || "Actif") !== "Actif" || (f["Bloqué jusqu'à"] && new Date(f["Bloqué jusqu'à"]) > new Date())) return echec();
    const adBrut = deB64u(authenticatorData);
    const ad = analyserAuthData(adBrut);
    if (!ad.rpIdHash.equals(sha256(rpId)) || !(ad.flags & 0x01) || !(ad.flags & 0x04)) return echec();
    const cle = crypto.createPublicKey({ key: Buffer.from(f[CHAMP_CLE] || "", "base64"), format: "der", type: "spki" });
    const valide = crypto.verify("sha256", Buffer.concat([adBrut, sha256(brutClient)]), cle, deB64u(signature));
    if (!valide) return echec();
    const ancien = Number(f[CHAMP_COMPTEUR]) || 0;
    if ((ad.compteur || ancien) && ad.compteur <= ancien) return echec(); // compteur qui ne monte pas : cle clonee
    const tokenId = crypto.randomUUID();
    await ctx.majUtilisateur(rec.id, { [CHAMP_COMPTEUR]: ad.compteur, "Échecs de connexion": 0, "Bloqué jusqu'à": null, "Dernier tokenId refresh valide": tokenId, "Dernière connexion": new Date().toISOString() });
    const user = { userId: rec.id, tenantId: (f["tenantId"] || [])[0] || null, role: f["Rôle"] || null };
    res.setHeader("Set-Cookie", ctx.cookiesSession(user, tokenId));
    return res.status(200).json({ role: user.role });
  } catch (e) { return echec(); }
}
