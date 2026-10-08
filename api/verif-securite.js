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
import { verifierOrigine, verifierDebit, reponseBloquee, verifierSession } from "./_securite.js";

const AIRTABLE_BASE = "appkI8RKHkYNWY86U";
const CONFIG_RECORD_ID = "rec45X231n9dXnyaU";
const CLIENTS_TABLE = "Clients";
const PLANNING_TABLE = "Planning";
const UTILISATEURS_TABLE = "Utilisateurs";

const ACCESS_TOKEN_DUREE_S = 15 * 60;        // 15 minutes
const REFRESH_TOKEN_DUREE_S = 7 * 24 * 3600; // 7 jours
const MAX_ECHECS_AVANT_BLOCAGE = 5;
const MOT_DE_PASSE_LONGUEUR_MIN = 12;
const DUREE_BLOCAGE_MIN = 15;
// Roles provisionnables depuis l'admin (Poste de pilotage). SUPER_ADMIN_IKO
// est volontairement exclu de cette liste : ce role ne doit jamais etre
// creable via un formulaire de provisioning client, seulement en direct
// dans Airtable par RSIA.
const ROLES_PROVISIONNABLES = ["TENANT_ADMIN", "TECHNICIEN", "COMMERCIAL", "CLIENT"];

// Prefixe RESERVE aux mots de passe temporaires generes par "Creer son IKO".
// Un mot de passe qui commence par ce prefixe est toujours traite comme
// temporaire : changement impose a la connexion, et jamais accepte comme mot de
// passe choisi par un utilisateur (evaluerMotDePasse le refuse).
const PREFIXE_MDP_TEMPORAIRE = "Tmp-";

// Mots/suites interdits (comparaison sans accents ni casse, "contient").
const MOTS_INTERDITS = [
  "123456", "654321", "000000", "111111", "password", "passw0rd", "motdepasse", "mdp", "azerty", "qwerty",
  "admin", "iko", "rsia", "menuiserie", "bienvenue", "welcome", "letmein", "changeme", "secret", "soleil",
];

// Retourne un message d'erreur si le mot de passe est refuse, sinon null.
// Jamais journalise : le mot de passe ne sort pas de cette fonction.
function evaluerMotDePasse(motDePasse, identifiant) {
  const mdp = String(motDePasse || "");
  if (mdp.length < MOT_DE_PASSE_LONGUEUR_MIN) {
    return "Le mot de passe doit contenir au moins " + MOT_DE_PASSE_LONGUEUR_MIN + " caractères.";
  }
  if (mdp.toLowerCase().startsWith(PREFIXE_MDP_TEMPORAIRE.toLowerCase())) {
    return "Ce mot de passe commence par un préfixe réservé aux mots de passe temporaires : choisissez-en un autre.";
  }
  const norm = mdp.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (MOTS_INTERDITS.some((m) => norm.includes(m))) {
    return "Mot de passe trop courant : évitez les suites simples et les mots comme « password », « admin » ou le nom du produit.";
  }
  if (/^(.)\1+$/.test(mdp) || /^\d+$/.test(mdp)) {
    return "Le mot de passe ne doit pas être composé uniquement de chiffres ou d'un même caractère.";
  }
  const id = String(identifiant || "").trim().toLowerCase();
  if (id && (norm === id || norm === id.split("@")[0])) {
    return "Le mot de passe ne doit pas être identique à l'identifiant.";
  }
  return null;
}

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
    Object.assign({ userId: user.userId, tenantId: user.tenantId, role: user.role }, user.mdpAChanger ? { mdpAChanger: true } : {}),
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_DUREE_S }
  );
}

function signRefreshToken(user, tokenId) {
  return jwt.sign(
    Object.assign({ userId: user.userId, tokenId }, user.mdpAChanger ? { mdpAChanger: true } : {}),
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

  // Mot de passe interdit ou trop court : la session s'ouvre mais le changement
  // est impose (drapeau dans les jetons, refuse par le proxy et par ?action=session).
  user.mdpAChanger = evaluerMotDePasse(motDePasse, user.identifiant) !== null;

  const access = signAccessToken(user);
  const refresh = signRefreshToken(user, tokenId);

  res.setHeader("Set-Cookie", [
    cookie("iko_access", access, ACCESS_TOKEN_DUREE_S, "/"),
    cookie("iko_refresh", refresh, REFRESH_TOKEN_DUREE_S, "/api/verif-securite"),
  ]);
  return res.status(200).json(user.mdpAChanger ? { role: user.role, mdpAChanger: true } : { role: user.role });
}

// --- CHANGEMENT / REINITIALISATION DU MOT DE PASSE -------------------------
// changer_mot_de_passe : l'ancien mot de passe est obligatoire (verifie comme
// a la connexion, avec le meme compteur d'echecs/blocage). Ouvre ensuite une
// session propre (sans drapeau). reinitialiser_mot_de_passe : super admin.
async function gererChangementMotDePasse(req, res) {
  const { identifiant, motDePasse, nouveauMotDePasse } = req.body || {};
  if (!identifiant || !motDePasse || !nouveauMotDePasse) {
    return res.status(400).json({ erreur: "Identifiant, ancien et nouveau mot de passe requis." });
  }
  const user = await lireUtilisateurParIdentifiant(String(identifiant));
  if (!user) return reponseGeneriqueEchec(res, null);
  if (user.bloqueJusqua && new Date(user.bloqueJusqua) > new Date()) return reponseGeneriqueEchec(res, user.hash);

  const ancienValide = await bcrypt.compare(String(motDePasse), user.hash || HASH_FACTICE);
  if (!ancienValide || user.statut !== "Actif") {
    const nouveauxEchecs = (user.echecs || 0) + 1;
    const champs = { "Échecs de connexion": nouveauxEchecs };
    if (nouveauxEchecs >= MAX_ECHECS_AVANT_BLOCAGE) {
      champs["Bloqué jusqu'à"] = new Date(Date.now() + DUREE_BLOCAGE_MIN * 60000).toISOString();
    }
    await majUtilisateur(user.userId, champs);
    return res.status(401).json({ erreur: MESSAGE_GENERIQUE });
  }
  const refus = evaluerMotDePasse(nouveauMotDePasse, user.identifiant);
  if (refus) return res.status(400).json({ erreur: refus });
  if (String(nouveauMotDePasse) === String(motDePasse)) {
    return res.status(400).json({ erreur: "Le nouveau mot de passe doit être différent de l'ancien." });
  }

  const hash = await bcrypt.hash(String(nouveauMotDePasse), 12);
  const tokenId = crypto.randomUUID();
  await majUtilisateur(user.userId, {
    "Hash mot de passe": hash,
    "Échecs de connexion": 0,
    "Bloqué jusqu'à": null,
    "Dernier tokenId refresh valide": tokenId,
  });
  user.mdpAChanger = false;
  res.setHeader("Set-Cookie", [
    cookie("iko_access", signAccessToken(user), ACCESS_TOKEN_DUREE_S, "/"),
    cookie("iko_refresh", signRefreshToken(user, tokenId), REFRESH_TOKEN_DUREE_S, "/api/verif-securite"),
  ]);
  return res.status(200).json({ ok: true, role: user.role });
}

async function gererReinitialisationMotDePasse(req, res) {
  const session = verifierSession(req);
  if (!session || session.role !== "SUPER_ADMIN_IKO" || session.mdpAChanger) {
    return res.status(403).json({ erreur: "Accès refusé : droits administrateur requis." });
  }
  const { identifiant, nouveauMotDePasse } = req.body || {};
  if (!identifiant || !nouveauMotDePasse) {
    return res.status(400).json({ erreur: "Identifiant et nouveau mot de passe requis." });
  }
  const refus = evaluerMotDePasse(nouveauMotDePasse, String(identifiant));
  if (refus) return res.status(400).json({ erreur: refus });
  const user = await lireUtilisateurParIdentifiant(String(identifiant));
  if (!user) return res.status(404).json({ erreur: "Utilisateur introuvable." });
  const hash = await bcrypt.hash(String(nouveauMotDePasse), 12);
  // Revoque aussi la session de refresh de l'utilisateur (reconnexion obligatoire).
  await majUtilisateur(user.userId, {
    "Hash mot de passe": hash,
    "Échecs de connexion": 0,
    "Bloqué jusqu'à": null,
    "Dernier tokenId refresh valide": null,
  });
  return res.status(200).json({ ok: true });
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

// --- PROVISIONING : creation d'un compte utilisateur pour un client,
// depuis le Poste de pilotage (admin.html). Reutilise l'infra
// d'authentification deja validee (meme table, meme hachage bcrypt),
// aucune nouvelle fonction Vercel. Le hachage du mot de passe reste
// exclusivement serveur, jamais transmis ni calcule cote client.
//
// SECURITE (a jour) : cette route exige une session valide avec le role
// SUPER_ADMIN_IKO (verifiee cote serveur, cf. correctif AUTH #009
// ci-dessous), puis verifie que le tenantId fourni correspond a un vrai
// enregistrement Clients avant toute creation de compte.
async function gererCreationUtilisateur(req, res) {
  // Correctif AUTH #009 : le provisioning n'avait AUCUNE verification
  // serveur (ni session, ni role) — seul admin.html masquait le formulaire
  // aux non-admins cote client. Un appel direct a cette action, sans
  // session ou avec une session non-admin, pouvait creer un compte
  // rattache a n'importe quel tenantId fourni par le navigateur. Reutilise
  // verifierSession, deja utilise a l'identique dans api/airtable-proxy.js
  // (AUTH #007/#008) : aucune nouvelle logique d'authentification.
  const session = verifierSession(req);
  if (!session || session.role !== "SUPER_ADMIN_IKO") {
    return res.status(403).json({ erreur: "Accès refusé : droits administrateur requis pour créer un compte." });
  }

  const { identifiant, motDePasse, tenantId, role } = req.body || {};
  if (!identifiant || !motDePasse || !tenantId || !role) {
    return res.status(400).json({ erreur: "Identifiant, mot de passe, client et rôle sont requis." });
  }
  if (!ROLES_PROVISIONNABLES.includes(role)) {
    return res.status(400).json({ erreur: "Rôle invalide." });
  }
  const refusMdp = evaluerMotDePasse(motDePasse, identifiant);
  if (refusMdp) {
    return res.status(400).json({ erreur: refusMdp });
  }

  // Le tenantId reste choisi par l'admin (SUPER_ADMIN_IKO gere plusieurs
  // clients par nature — ce n'est pas un cas a restreindre a une session
  // mono-tenant), mais ne doit jamais etre pris pour argent comptant :
  // on verifie qu'il correspond a un VRAI enregistrement Clients avant de
  // rattacher un compte a ce tenant.
  try {
    const rTenant = await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/Clients/" + tenantId,
      { headers: airtableHeaders() }
    );
    if (!rTenant.ok) {
      return res.status(400).json({ erreur: "Client (tenant) introuvable." });
    }
  } catch (e) {
    return res.status(502).json({ erreur: "Erreur en vérifiant le client (tenant)." });
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

// --- "CREER SON IKO" : provisioning d'un client pro (super admin) -------------
// preparer_iko : controle en LECTURE SEULE + recapitulatif de ce qui serait cree.
// creer_iko    : cree les agences manquantes et le compte admin du client.
// Idempotent : chaque etape compare a l'existant (agences par nom, compte par
// identifiant) ; une interruption laisse un etat coherent et une relance
// complete sans rien dupliquer. Le mot de passe temporaire n'est JAMAIS
// journalise ni stocke en clair : il n'existe que dans la reponse HTTP
// (Cache-Control: no-store), une seule fois.

const ALPHABET_TEMPORAIRE = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // sans 0/O/1/l/I
const COULEURS_PAR_DEFAUT = ["#22c55e", "#ff6b00"];
const NOMS_AGENCE_GENERIQUES = /^(agence\s*\d*|nouvelle agence)$/i;

function genererMotDePasseTemporaire() {
  let corps = "";
  for (let i = 0; i < 16; i++) corps += ALPHABET_TEMPORAIRE[crypto.randomInt(ALPHABET_TEMPORAIRE.length)];
  return PREFIXE_MDP_TEMPORAIRE + corps;
}

function normaliserNom(v) {
  return String(v || "").trim().toLowerCase();
}

function premierEmail(texte) {
  const m = String(texte || "").split(/[\n;,\s]+/).map((e) => e.trim()).find((e) => e.includes("@"));
  return m || "";
}

function exigerSuperAdmin(req, res) {
  const session = verifierSession(req);
  if (!session || session.role !== "SUPER_ADMIN_IKO" || session.mdpAChanger) {
    res.status(403).json({ erreur: "Accès refusé : droits administrateur requis." });
    return null;
  }
  return session;
}

async function lireJsonAirtable(url) {
  const r = await fetch(url, { headers: airtableHeaders() });
  if (!r.ok) throw new Error("airtable " + r.status);
  return r.json();
}

// Controle + etat des lieux. Ne fait AUCUNE ecriture.
async function preparerIko(clientId, identifiantDemande) {
  const base = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/";
  const rec = await lireJsonAirtable(base + CLIENTS_TABLE + "/" + clientId);
  const f = rec.fields || {};
  const bloquants = [];
  const avertissements = [];

  // --- Bloquant : nom, slug unique, Nombre agences 1-10, module, metier ---
  const nom = String(f["Nom client"] || "").trim();
  if (!nom) bloquants.push("Nom du client manquant.");
  const slug = String(f["Slug"] || "").trim();
  if (!slug) bloquants.push("Slug manquant.");
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) bloquants.push("Slug invalide (minuscules, chiffres et tirets uniquement).");
  else {
    const formule = 'AND(LOWER({Slug})="' + slug + '", RECORD_ID()!="' + clientId + '")';
    const dup = await lireJsonAirtable(base + CLIENTS_TABLE + "?filterByFormula=" + encodeURIComponent(formule) + "&maxRecords=1");
    if ((dup.records || []).length) bloquants.push("Le slug « " + slug + " » est déjà utilisé par un autre client.");
  }
  const nbBrut = f["Nombre agences"];
  const nombre = Number(nbBrut);
  if (!Number.isInteger(nombre) || nombre < 1 || nombre > 10) bloquants.push("Nombre d'agences invalide (entier de 1 à 10 requis).");
  if (!Array.isArray(f["Modules actifs"]) || f["Modules actifs"].length === 0) bloquants.push("Aucun module actif.");
  if (!f["Métier"]) bloquants.push("Métier non renseigné.");

  // --- Avertissements (non bloquants) ---
  const logo = f["Logo"] && f["Logo"][0] && f["Logo"][0].url;
  if (!logo) avertissements.push("Aucun logo : le logo IKO par défaut sera affiché.");
  const couleur = String(f["Couleur principale"] || "").toLowerCase();
  if (!couleur || COULEURS_PAR_DEFAUT.includes(couleur)) avertissements.push("Couleur principale non personnalisée (orange IKO par défaut).");
  if (f["Statut client"] && f["Statut client"] !== "Actif") avertissements.push("Statut client « " + f["Statut client"] + " » (et non « Actif »).");
  if (f["Accès bloqué"] === true) avertissements.push("Accès bloqué : le client n'aura pas accès aux modules.");
  const emailContact = premierEmail(f["Emails contact"]);
  if (!emailContact) avertissements.push("Aucun e-mail de contact : à saisir pour l'identifiant du compte.");

  // --- Agences : etat des lieux (comparaison par nom + lien Client verifie par ID) ---
  let existantes = [];
  if (nom) {
    const formuleAg = 'FIND("' + nom.replace(/"/g, '\\"') + '", ARRAYJOIN({Client}))';
    const dataAg = await lireJsonAirtable(base + encodeURIComponent("Agences") + "?filterByFormula=" + encodeURIComponent(formuleAg) + "&maxRecords=50");
    existantes = (dataAg.records || [])
      .filter((a) => Array.isArray(a.fields && a.fields["Client"]) && a.fields["Client"].includes(clientId))
      .map((a) => ({
        id: a.id,
        nom: String(a.fields["Nom agence"] || "").trim(),
        emailAgence: a.fields["Email agence"] || "",
        emailTechnicien: a.fields["Email technicien SAV"] || "",
        actif: a.fields["Actif"] !== false,
      }));
  }
  const noms = new Set();
  existantes.forEach((a) => { if (a.nom) noms.add(normaliserNom(a.nom)); });
  const aCreer = [];
  if (Number.isInteger(nombre) && nombre >= 1 && nombre <= 10) {
    for (let k = 1; noms.size + aCreer.length < nombre && k <= 50; k++) {
      const candidat = "Agence " + k;
      if (!noms.has(normaliserNom(candidat))) aCreer.push(candidat);
    }
  }
  const enTrop = Math.max(0, noms.size - (Number.isInteger(nombre) ? nombre : noms.size));
  if (enTrop > 0) avertissements.push(enTrop + " agence(s) en base au-delà de « Nombre agences » : rien ne sera supprimé.");
  existantes.forEach((a) => {
    if (!a.nom || NOMS_AGENCE_GENERIQUES.test(a.nom)) avertissements.push("Agence « " + (a.nom || "sans nom") + " » : nom générique à renommer.");
    if (!a.emailAgence) avertissements.push("Agence « " + (a.nom || "sans nom") + " » : e-mail agence manquant.");
    if (!a.emailTechnicien) avertissements.push("Agence « " + (a.nom || "sans nom") + " » : e-mail technicien manquant.");
  });
  if (aCreer.length) avertissements.push(aCreer.length + " agence(s) seront créées avec un nom générique (« " + aCreer.join(" », « ") + " ») : e-mails et noms à renseigner ensuite.");

  // --- Compte admin du client ---
  const identifiant = String(identifiantDemande || emailContact || "").trim();
  const compte = { identifiant, role: "TENANT_ADMIN", etat: "a_creer" };
  if (!identifiant) {
    // Identifiant manquant / invalide / deja pris : NON bloquant (avertissement) ;
    // les agences sont creees, le compte est ignore jusqu'a correction.
    avertissements.push("Aucun identifiant de compte : le compte ne sera pas créé (saisir un e-mail puis relancer).");
    compte.etat = "inconnu";
  } else if (!/^[^\s"'\\<>@]+@[^\s"'\\<>@]+\.[^\s"'\\<>@]+$/.test(identifiant)) {
    avertissements.push("L'identifiant du compte doit être une adresse e-mail valide : le compte ne sera pas créé.");
    compte.etat = "invalide";
  } else {
    const existant = await lireUtilisateurParIdentifiant(identifiant);
    if (existant) {
      if (existant.tenantId === clientId) compte.etat = "existe";
      else {
        compte.etat = "conflit";
        avertissements.push("L'identifiant « " + identifiant + " » est déjà utilisé par un autre client : le compte ne sera pas créé, choisissez-en un autre.");
      }
    }
  }

  return {
    pret: bloquants.length === 0,
    bloquants,
    avertissements,
    client: { id: clientId, nom, slug },
    agences: { existantes, aCreer, enTrop },
    compte,
  };
}

function validerClientId(valeur) {
  return typeof valeur === "string" && /^rec[A-Za-z0-9]{14}$/.test(valeur);
}

async function gererPreparerIko(req, res) {
  if (!exigerSuperAdmin(req, res)) return;
  const { clientId, identifiant } = req.body || {};
  if (!validerClientId(clientId)) return res.status(400).json({ erreur: "Client invalide." });
  try {
    const bilan = await preparerIko(clientId, identifiant);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(bilan);
  } catch (e) {
    console.error("preparer_iko erreur:", e && e.message);
    return res.status(502).json({ erreur: "Lecture impossible (Airtable)." });
  }
}

async function gererCreerIko(req, res) {
  if (!exigerSuperAdmin(req, res)) return;
  const { clientId, identifiant, regenererMotDePasse } = req.body || {};
  if (!validerClientId(clientId)) return res.status(400).json({ erreur: "Client invalide." });
  res.setHeader("Cache-Control", "no-store");

  let bilan;
  try {
    bilan = await preparerIko(clientId, identifiant);
  } catch (e) {
    console.error("creer_iko controle erreur:", e && e.message);
    return res.status(502).json({ erreur: "Lecture impossible (Airtable)." });
  }
  if (!bilan.pret) return res.status(400).json({ erreur: "Contrôle préalable non satisfait.", bloquants: bilan.bloquants, bilan });

  const base = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/";
  const resultat = { ok: true, agencesCreees: [], compte: { identifiant: bilan.compte.identifiant, role: "TENANT_ADMIN", cree: false, motDePasseTemporaire: null }, avertissements: bilan.avertissements };

  // Etape 1 : agences manquantes (jamais de suppression, jamais de doublon de nom).
  if (bilan.agences.aCreer.length) {
    try {
      const r = await fetch(base + encodeURIComponent("Agences"), {
        method: "POST",
        headers: airtableHeaders(),
        body: JSON.stringify({ records: bilan.agences.aCreer.map((n) => ({ fields: { "Client": [clientId], "Nom agence": n, "Actif": true } })) }),
      });
      if (!r.ok) {
        console.error("creer_iko agences HTTP", r.status);
        return res.status(502).json({ ok: false, etape: "agences", erreur: "Création des agences impossible. Rien d'autre n'a été fait ; relance possible.", bilan });
      }
      const j = await r.json();
      resultat.agencesCreees = (j.records || []).map((a) => (a.fields && a.fields["Nom agence"]) || "");
    } catch (e) {
      console.error("creer_iko agences erreur:", e && e.message);
      return res.status(502).json({ ok: false, etape: "agences", erreur: "Création des agences impossible. Relance possible.", bilan });
    }
  }

  // Etape 2 : compte admin du client (mot de passe temporaire, hache cote serveur).
  const etat = bilan.compte.etat;
  if (etat === "a_creer" || (etat === "existe" && regenererMotDePasse === true)) {
    const temporaire = genererMotDePasseTemporaire();
    const hash = await bcrypt.hash(temporaire, 12);
    try {
      let r;
      if (etat === "a_creer") {
        r = await fetch(base + encodeURIComponent(UTILISATEURS_TABLE), {
          method: "POST",
          headers: airtableHeaders(),
          body: JSON.stringify({ records: [{ fields: {
            "Identifiant": bilan.compte.identifiant,
            "Hash mot de passe": hash,
            "tenantId": [clientId],
            "Rôle": "TENANT_ADMIN",
            "Statut": "Actif",
            "Échecs de connexion": 0,
          } }] }),
        });
      } else {
        const existant = await lireUtilisateurParIdentifiant(bilan.compte.identifiant);
        r = await fetch(base + encodeURIComponent(UTILISATEURS_TABLE) + "/" + existant.userId, {
          method: "PATCH",
          headers: airtableHeaders(),
          body: JSON.stringify({ fields: { "Hash mot de passe": hash, "Échecs de connexion": 0, "Bloqué jusqu'à": null, "Dernier tokenId refresh valide": null } }),
        });
      }
      if (!r.ok) {
        console.error("creer_iko compte HTTP", r.status);
        return res.status(502).json({ ok: false, etape: "compte", erreur: "Création du compte impossible. Les agences sont à jour ; relance possible.", agencesCreees: resultat.agencesCreees });
      }
      resultat.compte.cree = etat === "a_creer";
      resultat.compte.motDePasseTemporaire = temporaire;
    } catch (e) {
      console.error("creer_iko compte erreur:", e && e.message);
      return res.status(502).json({ ok: false, etape: "compte", erreur: "Création du compte impossible. Relance possible.", agencesCreees: resultat.agencesCreees });
    }
  }
  return res.status(200).json(resultat);
}

async function gererSession(req, res) {
  const accessBrut = lireCookie(req, "iko_access");
  if (accessBrut) {
    try {
      const payload = jwt.verify(accessBrut, process.env.JWT_ACCESS_SECRET);
      if (payload.mdpAChanger) return res.status(401).json({ erreur: "Changement de mot de passe obligatoire.", mdpAChanger: true });
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
  if (payload.mdpAChanger) return res.status(401).json({ erreur: "Changement de mot de passe obligatoire.", mdpAChanger: true });

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
      if (action === "changer_mot_de_passe") {
        if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
        if (!verifierDebit(req, { max: 10, fenetreMs: 10 * 60_000, cle: "chg-mdp" })) return reponseBloquee(res, "debit");
        return gererChangementMotDePasse(req, res);
      }
      if (action === "reinitialiser_mot_de_passe") {
        if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
        if (!verifierDebit(req)) return reponseBloquee(res, "debit");
        return gererReinitialisationMotDePasse(req, res);
      }
      if (action === "preparer_iko") {
        if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
        if (!verifierDebit(req)) return reponseBloquee(res, "debit");
        return gererPreparerIko(req, res);
      }
      if (action === "creer_iko") {
        if (!verifierOrigine(req)) return reponseBloquee(res, "origine");
        if (!verifierDebit(req, { max: 10, fenetreMs: 10 * 60_000, cle: "creer-iko" })) return reponseBloquee(res, "debit");
        return gererCreerIko(req, res);
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
