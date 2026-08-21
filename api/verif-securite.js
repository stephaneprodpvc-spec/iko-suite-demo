// api/verif-securite.js
// Verifications de securite et de bon fonctionnement du poste de pilotage
// et de la plateforme Iko Suite. Deux modes d'appel :
//  - Manuel : POST depuis admin.html (bouton "Lancer maintenant"), execute
//    toujours immediatement.
//  - Automatique : GET declenche par le cron Vercel (voir vercel.json,
//    toutes les heures). Ne fait le vrai travail que si l'heure/jour
//    programmes par Stephane (record CONFIG, table Planning) correspondent
//    a l'heure actuelle - sinon repond immediatement sans rien faire.
//
// Le rapport est toujours ecrit sur le record CONFIG (champ "Verif Dernier
// Rapport") pour que admin.html puisse l'afficher au prochain chargement.
//
// AUTHENTIFICATION (ajout IKO #003/#004) -----------------------------------
// Ce fichier heberge AUSSI l'authentification (login/session/logout), fusionnee
// ici pour respecter le plafond de 12 fonctions serverless Vercel Hobby deja
// atteint par le projet (voir audit IKO #001 et conception #004-B, choix
// justifie par comparaison avec _securite.js et detecter-demande-client.js).
//
// Routage additif, sans toucher au comportement existant :
//   - POST sans "action" dans le corps  -> comportement INCHANGE (declenchement
//     manuel de la verification depuis admin.html).
//   - POST avec action="login"/"logout" -> nouvelle authentification.
//   - GET sans "action" en query        -> comportement INCHANGE (cron).
//   - GET avec action="session" en query -> nouvelle verification de session.
//
// Cette brique est ISOLEE : aucune page existante ne l'appelle encore. Un
// ecran de connexion autonome (auth-login.html) l'utilise en isolation pour
// les tests, mais rien dans admin.html/dashboard.html/technicien.html/etc.
// n'a ete modifie ni branche a ce jour.
//
// Table Airtable "Utilisateurs" : DOIT ETRE CREEE MANUELLEMENT PAR STEPHANE
// avant tout test reel (voir plan IKO #003, etape 1). Ce code suppose le
// schema suivant, mais n'a pas pu etre teste contre de vraies donnees
// Airtable tant que la table n'existe pas :
//   Identifiant (texte, email recommande)
//   Hash mot de passe (texte, bcrypt uniquement)
//   tenantId (lien vers table Clients)
//   Rôle (select : SUPER_ADMIN_IKO / TENANT_ADMIN / TECHNICIEN / COMMERCIAL / CLIENT)
//   Statut (select : Actif / Bloqué)
//   Échecs de connexion (nombre)
//   Bloqué jusqu'à (date/heure)
//   Dernière connexion (date/heure)
//   Dernier tokenId refresh valide (texte) — pour la rotation/anti-reutilisation

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { verifierOrigine, verifierDebit, reponseBloquee } from "./_securite.js";

const AIRTABLE_BASE = "appkI8RKHkYNWY86U";
const CONFIG_RECORD_ID = "rec45X231n9dXnyaU";
const CLIENTS_TABLE = "Clients";
const PLANNING_TABLE = "Planning";
const UTILISATEURS_TABLE = "Utilisateurs";

const ACCESS_TOKEN_DUREE_S = 15 * 60;        // 15 minutes
const REFRESH_TOKEN_DUREE_S = 7 * 24 * 3600; // 7 jours
const MAX_ECHECS_AVANT_BLOCAGE = 8;
const DUREE_BLOCAGE_MIN = 15;
// Roles provisionnables depuis l'admin (Poste de pilotage). SUPER_ADMIN_IKO
// est volontairement exclu de cette liste : ce role ne doit jamais etre
// creable via un formulaire de provisioning client, seulement en direct
// dans Airtable par RSIA.
const ROLES_PROVISIONNABLES = ["TENANT_ADMIN", "TECHNICIEN", "COMMERCIAL", "CLIENT"];

const MESSAGE_GENERIQUE = "Identifiant ou mot de passe incorrect.";
// Hash factice pour egaliser le temps de reponse quand le compte n'existe pas
// (evite qu'une absence de compte reponde plus vite qu'un mauvais mot de passe).
const HASH_FACTICE = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q0G1n2Bxw3aQK6bK6bK6bK6bK6bK6";

function airtableHeaders() {
  return {
    Authorization: "Bearer " + process.env.AIRTABLE_TOKEN,
    "Content-Type": "application/json",
  };
}

async function lireConfig() {
  const r = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(PLANNING_TABLE) + "/" + CONFIG_RECORD_ID,
    { headers: airtableHeaders() }
  );
  if (!r.ok) return null;
  const json = await r.json();
  return json.fields || {};
}

async function ecrireRapport(texte) {
  try {
    await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(PLANNING_TABLE) + "/" + CONFIG_RECORD_ID,
      {
        method: "PATCH",
        headers: airtableHeaders(),
        body: JSON.stringify({
          fields: {
            "Verif Dernier Rapport": texte,
            "Verif Derniere Exec": new Date().toISOString(),
          },
        }),
      }
    );
  } catch (e) {
    console.error("Ecriture rapport verif echouee:", e);
  }
}

// --- AUTHENTIFICATION : helpers -------------------------------------------

function cookie(nom, valeur, maxAgeSec, path) {
  const base = nom + "=" + valeur + "; HttpOnly; Secure; SameSite=Strict; Path=" + path;
  return maxAgeSec === 0 ? base + "; Max-Age=0" : base + "; Max-Age=" + maxAgeSec;
}

function lireCookie(req, nom) {
  const brut = req.headers.cookie || "";
  const m = brut.match(new RegExp("(?:^|; )" + nom + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function signAccessToken(user) {
  return jwt.sign(
    { userId: user.userId, tenantId: user.tenantId, role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_DUREE_S }
  );
}

function signRefreshToken(user, tokenId) {
  return jwt.sign(
    { userId: user.userId, tokenId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_DUREE_S }
  );
}

async function lireUtilisateurParIdentifiant(identifiant) {
  const formule = "LOWER({Identifiant})=\"" + identifiant.toLowerCase().replace(/"/g, '\\"') + "\"";
  const url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(UTILISATEURS_TABLE) +
    "?filterByFormula=" + encodeURIComponent(formule) + "&maxRecords=1";
  const r = await fetch(url, { headers: airtableHeaders() });
  if (!r.ok) return null;
  const json = await r.json();
  const rec = (json.records || [])[0];
  if (!rec) return null;
  const f = rec.fields || {};
  return {
    userId: rec.id,
    identifiant: f["Identifiant"] || "",
    hash: f["Hash mot de passe"] || "",
    tenantId: (f["tenantId"] || [])[0] || null,
    role: f["Rôle"] || null,
    statut: f["Statut"] || "Actif",
    echecs: f["Échecs de connexion"] || 0,
    bloqueJusqua: f["Bloqué jusqu'à"] || null,
    dernierTokenId: f["Dernier tokenId refresh valide"] || null,
  };
}

async function majUtilisateur(recordId, champs) {
  await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(UTILISATEURS_TABLE) + "/" + recordId,
    { method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ fields: champs }) }
  );
}

async function reponseGeneriqueEchec(res, hashACompare) {
  // Delai constant : on execute toujours un bcrypt.compare, meme si le
  // compte n'existe pas (contre HASH_FACTICE), pour eviter une attaque par
  // mesure de temps qui reveleraient qu'un identifiant existe ou non.
  await bcrypt.compare("x", hashACompare || HASH_FACTICE);
  return res.status(401).json({ erreur: MESSAGE_GENERIQUE });
}

async function gererLogin(req, res) {
  const { identifiant, motDePasse } = req.body || {};
  if (!identifiant || !motDePasse) {
    return res.status(400).json({ erreur: "Identifiant et mot de passe requis." });
  }

  const user = await lireUtilisateurParIdentifiant(identifiant);

  if (!user) return reponseGeneriqueEchec(res, null);

  if (user.bloqueJusqua && new Date(user.bloqueJusqua) > new Date()) {
    return reponseGeneriqueEchec(res, user.hash);
  }

  const motDePasseValide = await bcrypt.compare(motDePasse, user.hash || HASH_FACTICE);
  if (!motDePasseValide || user.statut !== "Actif") {
    const nouveauxEchecs = (user.echecs || 0) + 1;
    const champs = { "Échecs de connexion": nouveauxEchecs };
    if (nouveauxEchecs >= MAX_ECHECS_AVANT_BLOCAGE) {
      champs["Bloqué jusqu'à"] = new Date(Date.now() + DUREE_BLOCAGE_MIN * 60000).toISOString();
    }
    await majUtilisateur(user.userId, champs);
    return res.status(401).json({ erreur: MESSAGE_GENERIQUE });
  }

  // Succes : remise a zero des echecs, rotation refresh token.
  const tokenId = crypto.randomUUID();
  await majUtilisateur(user.userId, {
    "Échecs de connexion": 0,
    "Bloqué jusqu'à": null,
    "Dernier tokenId refresh valide": tokenId,
    "Dernière connexion": new Date().toISOString(),
  });

  const access = signAccessToken(user);
  const refresh = signRefreshToken(user, tokenId);

  res.setHeader("Set-Cookie", [
    cookie("iko_access", access, ACCESS_TOKEN_DUREE_S, "/"),
    cookie("iko_refresh", refresh, REFRESH_TOKEN_DUREE_S, "/api/verif-securite"),
  ]);
  return res.status(200).json({ role: user.role });
}

async function gererLogout(req, res) {
  const refreshBrut = lireCookie(req, "iko_refresh");
  if (refreshBrut) {
    try {
      const payload = jwt.verify(refreshBrut, process.env.JWT_REFRESH_SECRET);
      await majUtilisateur(payload.userId, { "Dernier tokenId refresh valide": null });
    } catch (e) {
      // Token deja invalide/expire : rien a revoquer, on nettoie quand meme les cookies.
    }
  }
  res.setHeader("Set-Cookie", [
    cookie("iko_access", "", 0, "/"),
    cookie("iko_refresh", "", 0, "/api/verif-securite"),
  ]);
  return res.status(200).json({ ok: true });
}

// --- PROVISIONING (ajout) : creation d'un compte utilisateur pour un
// client, depuis le Poste de pilotage (admin.html). Reutilise l'infra
// d'authentification deja validee (meme table, meme hachage bcrypt),
// aucune nouvelle fonction Vercel. Le hachage du mot de passe reste
// exclusivement serveur, jamais transmis ni calcule cote client.
//
// SECURITE : cette route n'a aujourd'hui pas de verification d'identite
// de l'appelant au-dela de verifierOrigine/verifierDebit (memes garde-fous
// que login), car admin.html n'a pas encore de session admin reelle
// branchee (mot de passe code en dur, point deja documente comme en
// attente de validation Stephane). Tant que ce point n'est pas resolu,
// cette route offre le meme niveau de protection que le reste de
// l'admin, pas plus : a durcir en priorite des que l'auth admin reelle
// sera active (cf. failles documentees dans les memoires du projet).
async function gererCreationUtilisateur(req, res) {
  const { identifiant, motDePasse, tenantId, role } = req.body || {};
  if (!identifiant || !motDePasse || !tenantId || !role) {
    return res.status(400).json({ erreur: "Identifiant, mot de passe, client et rôle sont requis." });
  }
  if (!ROLES_PROVISIONNABLES.includes(role)) {
    return res.status(400).json({ erreur: "Rôle invalide." });
  }
  if (String(motDePasse).length < 8) {
    return res.status(400).json({ erreur: "Le mot de passe doit contenir au moins 8 caractères." });
  }

  const existant = await lireUtilisateurParIdentifiant(identifiant);
  if (existant) {
    return res.status(409).json({ erreur: "Cet identifiant existe déjà." });
  }

  const hash = await bcrypt.hash(motDePasse, 12);
  const r = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(UTILISATEURS_TABLE),
    {
      method: "POST",
      headers: airtableHeaders(),
      body: JSON.stringify({
        records: [{ fields: {
          "Identifiant": String(identifiant).trim(),
          "Hash mot de passe": hash,
          "tenantId": [tenantId],
          "Rôle": role,
          "Statut": "Actif",
          "Échecs de connexion": 0,
        } }],
      }),
    }
  );
  if (!r.ok) {
    const detail = await r.text();
    console.error("Erreur creation utilisateur:", r.status, detail);
    return res.status(502).json({ erreur: "Création du compte impossible." });
  }
  const json = await r.json();
  const rec = json.records && json.records[0];
  return res.status(200).json({ id: rec ? rec.id : null, identifiant, role });
}

async function gererSession(req, res) {
  const accessBrut = lireCookie(req, "iko_access");
  if (accessBrut) {
    try {
      const payload = jwt.verify(accessBrut, process.env.JWT_ACCESS_SECRET);
      return res.status(200).json({ userId: payload.userId, tenantId: payload.tenantId, role: payload.role });
    } catch (e) {
      // Access token absent/expire : on tente le refresh ci-dessous.
    }
  }

  const refreshBrut = lireCookie(req, "iko_refresh");
  if (!refreshBrut) return res.status(401).json({ erreur: "Session absente." });

  let payload;
  try {
    payload = jwt.verify(refreshBrut, process.env.JWT_REFRESH_SECRET);
  } catch (e) {
    return res.status(401).json({ erreur: "Session expirée." });
  }

  // Relecture directe par userId (pas par identifiant) pour la rotation.
  const r = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(UTILISATEURS_TABLE) + "/" + payload.userId,
    { headers: airtableHeaders() }
  );
  if (!r.ok) return res.status(401).json({ erreur: "Session invalide." });
  const rec = await r.json();
  const f = rec.fields || {};
  const dernierTokenId = f["Dernier tokenId refresh valide"] || null;

  if (!dernierTokenId || dernierTokenId !== payload.tokenId) {
    // Reutilisation d'un refresh token deja tourne : invalidation totale par securite.
    await majUtilisateur(payload.userId, { "Dernier tokenId refresh valide": null });
    res.setHeader("Set-Cookie", [cookie("iko_access", "", 0, "/"), cookie("iko_refresh", "", 0, "/api/verif-securite")]);
    return res.status(401).json({ erreur: "Session invalidée, reconnexion nécessaire." });
  }

  // Rotation : nouveau tokenId, nouveaux tokens.
  const nouveauTokenId = crypto.randomUUID();
  await majUtilisateur(payload.userId, { "Dernier tokenId refresh valide": nouveauTokenId });

  const userPourSignature = { userId: payload.userId, tenantId: f["tenantId"] ? f["tenantId"][0] : null, role: f["Rôle"] || null };
  const nouvelAccess = signAccessToken(userPourSignature);
  const nouveauRefresh = signRefreshToken(userPourSignature, nouveauTokenId);

  res.setHeader("Set-Cookie", [
    cookie("iko_access", nouvelAccess, ACCESS_TOKEN_DUREE_S, "/"),
    cookie("iko_refresh", nouveauRefresh, REFRESH_TOKEN_DUREE_S, "/api/verif-securite"),
  ]);
  return res.status(200).json({ userId: userPourSignature.userId, tenantId: userPourSignature.tenantId, role: userPourSignature.role });
}

// Determine si le cron doit executer une verification maintenant.
//
// IMPORTANT - contrainte du plan Vercel gratuit (Hobby) : un cron ne peut
// s'executer qu'UNE FOIS PAR JOUR, a une heure fixe definie dans
// vercel.json (pas modifiable dynamiquement sans redeploiement, et pas
// precise a la minute). Le champ "Verif Heure" configure par Stephane est
// donc informatif seulement pour l'instant : la verification automatique
// s'execute au moment ou Vercel declenche reellement le cron (voir
// vercel.json), pas a l'heure exacte choisie. Pour un choix d'heure
// vraiment precis, il faudrait passer sur le plan Vercel Pro. Le
// declenchement MANUEL (bouton "Lancer maintenant"), lui, n'a aucune
// limite et s'execute instantanement a la demande.
function estLeMomentProgramme(config) {
  if (!config || !config["Verif Active"]) return false;

  const maintenant = new Date();
  if (config["Verif Frequence"] === "Hebdomadaire") {
    const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    const jourActuel = JOURS[maintenant.getUTCDay()];
    if (config["Verif Jour"] && config["Verif Jour"] !== jourActuel) return false;
  }

  // Anti double-declenchement : si deja execute aujourd'hui, on saute.
  const derniere = config["Verif Derniere Exec"];
  if (derniere) {
    const d = new Date(derniere);
    if (!isNaN(d.getTime()) && d.getUTCFullYear() === maintenant.getUTCFullYear() &&
        d.getUTCMonth() === maintenant.getUTCMonth() && d.getUTCDate() === maintenant.getUTCDate()) {
      return false;
    }
  }
  return true;
}

async function executerVerifications() {
  const resultats = [];
  const ajouter = (ok, libelle, detail) => resultats.push({ ok, libelle, detail: detail || "" });

  // 1. Variables d'environnement critiques
  ajouter(!!process.env.ANTHROPIC_API_KEY, "Cle API Anthropic configuree");
  ajouter(!!process.env.AIRTABLE_TOKEN, "Token Airtable configure");

  // 2. Connexion Airtable + comptage clients
  try {
    const r = await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(CLIENTS_TABLE) + "?maxRecords=100",
      { headers: airtableHeaders() }
    );
    if (r.ok) {
      const json = await r.json();
      const clients = json.records || [];
      const actifs = clients.filter((c) => c.fields && c.fields["Statut client"] === "Actif").length;
      ajouter(true, "Connexion Airtable OK", clients.length + " client(s), " + actifs + " actif(s)");

      // 3. Coherence des fiches client : slug, metier et modules renseignes
      const incomplets = clients.filter((c) => {
        const f = c.fields || {};
        return !f["Slug"] || !f["Métier"] || !(f["Modules actifs"] || []).length;
      });
      ajouter(
        incomplets.length === 0,
        "Fiches clients completes",
        incomplets.length ? incomplets.length + " fiche(s) incomplete(s) (slug/metier/modules manquant)" : "Toutes les fiches sont completes"
      );
    } else {
      ajouter(false, "Connexion Airtable OK", "HTTP " + r.status);
    }
  } catch (e) {
    ajouter(false, "Connexion Airtable OK", String(e));
  }

  // 4. Config generale (mode concepteur) lisible
  try {
    const cfg = await lireConfig();
    ajouter(!!cfg, "Configuration generale lisible");
  } catch (e) {
    ajouter(false, "Configuration generale lisible", String(e));
  }

  const dateStr = new Date().toLocaleString("fr-FR", { timeZone: "UTC" }) + " UTC";
  const echecs = resultats.filter((r) => !r.ok);
  const entete = "Verification du " + dateStr + " — " + (echecs.length ? echecs.length + " probleme(s) detecte(s)" : "tout est OK");
  const corps = resultats.map((r) => (r.ok ? "OK" : "ECHEC") + " — " + r.libelle + (r.detail ? " (" + r.detail + ")" : "")).join("\n");
  const texte = entete + "\n\n" + corps;

  await ecrireRapport(texte);
  return { resultats, texte, aDesEchecs: echecs.length > 0 };
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") {
      const action = req.body && req.body.action;

      // --- Authentification (ajout, n'existait pas avant) ---
      if (action === "login") {
        if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
        if (!verifierDebit(req)) return reponseBloquee(res, "debit");
        return gererLogin(req, res);
      }
      if (action === "logout") {
        return gererLogout(req, res);
      }
      if (action === "creer_utilisateur") {
        if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
        if (!verifierDebit(req)) return reponseBloquee(res, "debit");
        return gererCreationUtilisateur(req, res);
      }

      // --- Comportement EXISTANT, inchangé : pas d'"action" = déclenchement
      // manuel de la vérification depuis admin.html ("Lancer maintenant"). ---
      const rapport = await executerVerifications();
      return res.status(200).json(rapport);
    }

    if (req.method === "GET") {
      // --- Authentification (ajout) : ?action=session ---
      if (req.query && req.query.action === "session") {
        return gererSession(req, res);
      }

      // --- Comportement EXISTANT, inchangé : déclenchement automatique
      // (cron Vercel), vérifie d'abord si c'est le bon moment programmé. ---
      const config = await lireConfig();
      if (!estLeMomentProgramme(config)) {
        return res.status(200).json({ execute: false, raison: "hors programmation" });
      }
      const rapport = await executerVerifications();
      return res.status(200).json(Object.assign({ execute: true }, rapport));
    }

    return res.status(405).json({ erreur: "Methode non autorisee" });
  } catch (e) {
    console.error("Erreur verif-securite:", e);
    return res.status(500).json({ erreur: "Une erreur est survenue." });
  }
}
