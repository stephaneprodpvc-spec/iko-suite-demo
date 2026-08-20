// Proxy générique vers l'API Airtable.
//
// Historique : ce fichier remplace l'ancienne route dynamique
// "api/airtable/[...path].js". Sur un déploiement Vercel sans framework
// (pas de Next.js), le pattern catch-all "[...path].js" ne route
// fiablement QUE le premier segment ("/api/airtable/Tickets%20SAV") et
// renvoie une 404 dès qu'un segment supplémentaire est présent
// ("/api/airtable/Tickets%20SAV/recXXXXXXXXXXXXXX"). Résultat concret :
// toutes les mises à jour (PATCH) de tickets - changement de statut,
// commentaire technicien, diagnostic, message client, etc. - échouaient
// silencieusement en production (l'interface se mettait à jour
// localement sans jamais persister dans Airtable).
//
// La solution robuste (indépendante des quirks de routing par fichier)
// consiste à utiliser une route FIXE ici, et à faire porter le sous-chemin
// Airtable par un paramètre de requête "path" via une règle de réécriture
// dans vercel.json (/api/airtable/:path* -> /api/airtable-proxy?path=:path*).
// Le code ci-dessous n'a donc plus jamais à dépendre du routing dynamique
// par fichier.
//
// Notifications push (path=push) : fusionnées ici plutôt que dans un
// fichier api/push.js séparé, car le projet est déjà au plafond de 12
// fonctions Vercel (Hobby) — voir la fonction handlerPush ci-dessous.
// Appelé via /api/airtable/push (même route réécrite que le reste).

import webpush from 'web-push';
import { verifierSession, verifierDebit, verifierOrigine } from './_securite.js';

// AUTH #004 — sécurisation serveur de ce proxy -------------------------------
// Principe retenu (mode de COEXISTENCE, volontairement non strict) :
//   - Session Auth #003 valide + role != SUPER_ADMIN_IKO -> on applique les
//     controles tenant/role ci-dessous (jamais confiance a un tenantId/slug
//     fourni par le navigateur).
//   - Session SUPER_ADMIN_IKO -> acces global conserve (comportement inchange).
//   - AUCUNE session -> comportement HISTORIQUE conserve tel quel. Tant que
//     toutes les pages internes n'envoient pas encore de session (migration
//     Auth #003 en cours page par page), rejeter categoriquement toute
//     requete sans session casserait des pages encore non migrees et les
//     pages PUBLIQUES legitimes (amandine.html, devis.html, avis.html,
//     suivi.html), qui n'ont et n'auront jamais de session utilisateur.
//
// Un futur mode strict (rejet sans session) pourra etre active plus tard via
// une variable d'environnement (ex. AUTH_ENFORCEMENT=strict), UNE FOIS que
// toutes les pages internes seront migrees et confirmees. Ce mode n'est PAS
// implemente ni active dans cette etape - seul le mode de coexistence l'est.
//
// Portee de l'enforcement tenant, mise a jour au fil des etapes :
//   - "Clients" : controle strict sur acces par recordId precis (#004).
//   - "Utilisateurs" : bloquee inconditionnellement (#004).
//   - "Devis", "Catalogue Produits", "Grille Main d'œuvre", "Mise en page
//     Devis", "Métrés", "Agences", "RDV Commercial" : controle par recordId
//     precis + (pour les 4 premieres, qui disposent d'un champ "Client
//     Record ID" dedie) filtrage de liste fiable via filterByFormula
//     (#004C, cf. audit #004B pour le detail champ par champ).
//   - "Planning" : protection ciblée (#004D) — enregistrement CONFIG
//     toujours exempté, créneaux réels liés à un tenant protégés par
//     recordId, créneaux sans tenant (démo publique index.html) toujours
//     laissés passer. Pas de filtrage de liste (cf. #004B).
//   - "Tickets SAV", "Planning Commercial" : PAS filtrees par tenant -
//     hors perimetre de #004C/#004D, ambiguites identifiees en #004B et
//     confirmees en #004D (chevauchement reel avec l'usage par recordId
//     des pages publiques pour Tickets SAV ; aucun champ de rattachement
//     du tout pour Planning Commercial). Cf. rapport #004D pour le detail.
//
// Bloquee INCONDITIONNELLEMENT, quelle que soit la session : la table
// "Utilisateurs" (hash de mots de passe, tokenId de rotation). Aucune page
// ne l'utilise via ce proxy a ce jour (verifie) - aucun risque de regression.

const CONFIG_RECORD_ID = 'rec45X231n9dXnyaU';

// CORRECTION SECURITE — webhook Make expose cote client. Jusqu'ici, plusieurs
// pages PUBLIQUES (index.html, suivi.html, devis.html) appelaient directement
// cette URL depuis le navigateur : visible en clair dans le code source,
// n'importe qui pouvait la rejouer avec un payload arbitraire (fausses
// notifications "devis_envoye"/"rdv_modifie" vers l'agence ou vers un client,
// usurpation de donnees). Deplacee ici, cote serveur : le navigateur n'appelle
// plus que /api/airtable/webhook (proxy relaye ensuite), l'URL Make n'est
// plus jamais transmise au client. Perimetre de ce correctif : les 3 pages
// publiques uniquement (index.html, suivi.html, devis.html) - dashboard.html/
// technicien.html/commerce.html restent inchanges pour l'instant (acces deja
// restreint a du personnel, priorite moindre).
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/n3lwi92wldkf22jcemmjfem334p4mv6a'; // scenario demo isole

async function lireConfigPush(baseId, headers) {
  const res = await fetch('https://api.airtable.com/v0/' + baseId + '/Planning/' + CONFIG_RECORD_ID, { headers });
  const json = await res.json();
  let config = {};
  try { config = JSON.parse(json.fields?.['Config JSON'] || '{}'); } catch (e) { config = {}; }
  if (!Array.isArray(config.pushSubscriptions)) config.pushSubscriptions = [];
  return config;
}

async function ecrireConfigPush(baseId, headers, config) {
  await fetch('https://api.airtable.com/v0/' + baseId + '/Planning/' + CONFIG_RECORD_ID, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { 'Config JSON': JSON.stringify(config) } }),
  });
}

async function handlerPush(req, res, baseId, headers, session) {
  // Push n'est utilise que par des pages internes (dashboard.html,
  // technicien.html) - aucune page publique ne l'appelle. Quand une session
  // existe, on peut donc deja restreindre aux roles internes attendus, sans
  // casser aucun usage public legitime. Sans session (page pas encore
  // migree), comportement historique conserve (mode de coexistence).
  if (session && session.role !== 'SUPER_ADMIN_IKO' && session.role !== 'TECHNICIEN') {
    return res.status(403).json({ error: 'Accès non autorisé.' });
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

  if (req.method === 'GET') {
    if (!vapidPublic) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY manquante.' });
    return res.status(200).json({ publicKey: vapidPublic });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!vapidPublic || !vapidPrivate) return res.status(500).json({ error: 'Configuration VAPID incomplète.' });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:stephane.prodpvc@gmail.com', vapidPublic, vapidPrivate);
  const body = req.body || {};

  try {
    if (body.subscribe && body.subscription && body.agence) {
      const config = await lireConfigPush(baseId, headers);
      const endpoint = body.subscription.endpoint;
      config.pushSubscriptions = config.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
      config.pushSubscriptions.push({ agence: body.agence, endpoint, keys: body.subscription.keys });
      await ecrireConfigPush(baseId, headers, config);
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'send' && body.agence) {
      const config = await lireConfigPush(baseId, headers);
      const cibles = config.pushSubscriptions.filter((s) => s.agence === body.agence);
      const payload = JSON.stringify({ title: body.title || 'Iko Suite', body: body.body || '', url: body.url || '/technicien.html' });
      const morts = [];
      await Promise.all(cibles.map(async (s) => {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload); }
        catch (err) { if (err.statusCode === 404 || err.statusCode === 410) morts.push(s.endpoint); }
      }));
      if (morts.length) {
        config.pushSubscriptions = config.pushSubscriptions.filter((s) => !morts.includes(s.endpoint));
        await ecrireConfigPush(baseId, headers, config);
      }
      return res.status(200).json({ ok: true, envoyes: cibles.length - morts.length });
    }
    return res.status(400).json({ error: 'Requête push invalide.' });
  } catch (err) {
    return res.status(502).json({ error: 'Erreur push', details: String(err) });
  }
}

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const appSecret = process.env.APP_PROXY_SECRET;

  if (!token) {
    return res.status(500).json({
      error: 'AIRTABLE_TOKEN manquant. Ajoute-le dans Vercel > Project Settings > Environment Variables.'
    });
  }

  // Verification d'un secret partage envoye par les pages de l'app (en-tete
  // X-App-Secret). Objectif : empecher qu'un tiers qui decouvrirait l'URL de
  // ce proxy puisse lire/ecrire dans Airtable sans jamais passer par une page
  // ou un mot de passe de l'app. Ce n'est pas une vraie authentification par
  // utilisateur (le secret est visible dans le code source des pages, comme
  // les mots de passe agence) - ca bloque les acces directs/automatises a
  // l'API, pas un attaquant determine qui lirait le JS des pages.
  if (appSecret) {
    const provided = req.headers['x-app-secret'];
    if (provided !== appSecret) {
      return res.status(401).json({ error: 'Non autorise.' });
    }
  }

  // AUTH #004 : verification de session, sans effet de bord. null si aucune
  // session valide (comportement historique conserve dans ce cas, cf.
  // commentaire de tete de fichier - mode de coexistence).
  const session = verifierSession(req);

  const { path, ...rest } = req.query || {};
  const subPathRaw = Array.isArray(path) ? path.join('/') : (path || '');
  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U'; // base démo Iko Suite
  const headers = { Authorization: 'Bearer ' + token };

  // Bloque inconditionnellement l'acces a la table Utilisateurs via ce
  // proxy, quelle que soit la session (voir commentaire de tete de fichier).
  const premierSegment = subPathRaw.split('/').filter(Boolean)[0] || '';
  if (premierSegment.toLowerCase() === 'utilisateurs') {
    return res.status(403).json({ error: 'Accès à cette ressource non autorisé via ce proxy.' });
  }

  // CORRECTION SECURITE #1 — recherche publique d'un ticket par numero.
  // suivi.html (aucune session, page publique) recherche un ticket via
  // GET Tickets SAV?filterByFormula=UPPER({Name})=UPPER("SAV-...") : c'est
  // le seul point d'entree ou un tiers peut "deviner" un ticket appartenant
  // a quelqu'un d'autre (numero genere sur ~9000 combinaisons/an, cf.
  // index.html). Rate-limit dedie et delibrement strict, cible UNIQUEMENT
  // sur ce motif exact (filtre par {Name} sur Tickets SAV) - jamais sur les
  // listes internes filtrees par Statut/Agence utilisees en continu par
  // dashboard.html/technicien.html (verifie : aucun autre appel du depot
  // n'utilise {Name} sur cette table). Seuil genereux pour un client qui se
  // trompe une ou deux fois, mais qui rend un balayage des ~9000
  // combinaisons totalement impraticable (des jours de tentatives continues
  // depuis la meme IP, deja tres au-dela de tout usage legitime).
  const SEUIL_RECHERCHE_TICKET = 5;
  const FENETRE_RECHERCHE_TICKET_MS = 10 * 60 * 1000; // 10 minutes
  if (
    req.method === 'GET' &&
    premierSegment === 'Tickets SAV' &&
    typeof rest.filterByFormula === 'string' &&
    rest.filterByFormula.includes('{Name}')
  ) {
    if (!verifierDebit(req, { max: SEUIL_RECHERCHE_TICKET, fenetreMs: FENETRE_RECHERCHE_TICKET_MS, cle: 'recherche-ticket' })) {
      return res.status(429).json({ error: 'Trop de tentatives de recherche. Réessayez dans quelques minutes.' });
    }
  }

  if (subPathRaw === 'webhook') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!verifierOrigine(req)) return res.status(403).json({ error: 'Origine non autorisée.' });
    try {
      const webhookRes = await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {}),
      });
      return res.status(webhookRes.ok ? 200 : 502).json({ ok: webhookRes.ok });
    } catch (err) {
      return res.status(502).json({ error: 'Erreur webhook', details: String(err) });
    }
  }

  if (subPathRaw === 'push') {
    return handlerPush(req, res, baseId, headers, session);
  }

  // Upload de pièces jointes (ex : PDF de devis généré côté client) : Airtable
  // sert cette route sur un domaine distinct (content.airtable.com) avec un
  // corps JSON dédié {contentType, file (base64), filename}. Convention :
  // /api/airtable/content/<recordId>/<fieldIdOrName>/uploadAttachment
  // On la détecte via le préfixe "content/" et on route vers ce domaine à la
  // place d'api.airtable.com, sans créer de fonction Vercel supplémentaire
  // (le projet est déjà au plafond de 12 fonctions sur le plan Hobby).
  if (subPathRaw.startsWith('content/')) {
    const contentSubPath = subPathRaw.slice('content/'.length).split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
    const contentUrl = 'https://content.airtable.com/v0/' + baseId + '/' + contentSubPath;
    try {
      const contentRes = await fetch(contentUrl, {
        method: req.method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      });
      const data = await contentRes.json().catch(() => ({}));
      return res.status(contentRes.status).json(data);
    } catch (err) {
      return res.status(502).json({ error: 'Erreur en contactant Airtable (content)', details: String(err) });
    }
  }

  // req.query est déjà décodé par Vercel/Node : on ré-encode proprement
  // chaque segment (utile notamment pour "Tickets SAV" -> "Tickets%20SAV").
  const encodedSubPath = subPathRaw.split('/').filter(Boolean).map(encodeURIComponent).join('/');

  // AUTH #004 : contrôle tenant strict, limité à la table "Clients" (seul
  // cas non ambigu — un enregistrement Clients EST le tenant, cf. commentaire
  // de tête de fichier). S'applique uniquement si une session existe et que
  // le rôle n'est pas SUPER_ADMIN_IKO (qui garde l'accès global).
  //
  // Limité au cas d'un recordId précis (ex. "Clients/recXXXX") : c'est le
  // seul cas non ambigu de fuite inter-tenant (accès direct à la fiche d'un
  // autre client). Une recherche filterByFormula sans recordId (ex. par
  // slug) n'est PAS bloquée ici même en présence d'une session : c'est
  // exactement le motif utilisé légitimement par les pages PUBLIQUES
  // (amandine.html, devis.html, avis.html, suivi.html), qui partagent le
  // même cookie de session que les pages internes si un utilisateur les
  // ouvre dans le même navigateur (ex. un technicien connecté qui ouvrirait
  // ensuite amandine.html). Bloquer ce cas casserait ces pages publiques —
  // cf. règle 5, à ne pas casser. Traité comme cas ambigu, pas de règle
  // inventée ici.
  if (premierSegment === 'Clients' && session && session.role !== 'SUPER_ADMIN_IKO') {
    const segmentsClients = subPathRaw.split('/').filter(Boolean);
    const recordIdDemande = segmentsClients[1]; // ex: "Clients/recXXXX"
    if (recordIdDemande && (!session.tenantId || recordIdDemande !== session.tenantId)) {
      return res.status(403).json({ error: "Accès refusé : ce tenant ne correspond pas à votre session." });
    }
  }

  // AUTH #004D : "Planning" — table à triple usage (cf. audit #004B) :
  // (1) l'enregistrement sentinelle CONFIG_RECORD_ID (config générale,
  //     tarifs, rapports — jamais lié à un tenant, partagé par toutes les
  //     pages internes) : TOUJOURS exempté, aucune vérification.
  // (2) de vrais créneaux internes, liés à "Compte client".
  // (3) des créneaux DÉMO publics (index.html), qui ne portent JAMAIS de
  //     valeur dans "Compte client" (index.html ne connaît aucun contexte
  //     tenant, il filtre uniquement par Agence/Créneau/Statut).
  // Règle retenue, structurellement sans risque pour (1) et (3) : on ne
  // bloque QUE si "Compte client" est réellement renseigné ET différent du
  // tenant de session. Un champ absent/vide laisse toujours passer
  // (comportement inchangé) — jamais de blocage par défaut ici, contrairement
  // aux 7 tables métier où un champ absent est traité comme une anomalie à
  // bloquer. Ce choix protège les vrais créneaux internes mal rattachés
  // sans jamais pouvoir casser index.html ni le CONFIG partagé.
  // Recherche/liste (filterByFormula) : NON filtrée, même limite que les
  // autres tables sans "Client Record ID" (cf. #004C) — documentée, pas
  // de règle inventée.
  if (premierSegment === 'Planning' && session && session.role !== 'SUPER_ADMIN_IKO') {
    const segmentsPlanning = subPathRaw.split('/').filter(Boolean);
    const recordIdPlanning = segmentsPlanning[1];
    if (recordIdPlanning && recordIdPlanning !== CONFIG_RECORD_ID) {
      let recPlanningCheck;
      try {
        const rP = await fetch('https://api.airtable.com/v0/' + baseId + '/Planning/' + recordIdPlanning, { headers });
        if (!rP.ok) {
          const errData = await rP.json().catch(() => ({}));
          return res.status(rP.status).json(errData);
        }
        recPlanningCheck = await rP.json();
      } catch (err) {
        return res.status(502).json({ error: 'Erreur en vérifiant la propriété tenant de ce créneau.', details: String(err) });
      }
      const valeurCompteClient = (recPlanningCheck.fields || {})['Compte client'];
      const idsLiesPlanning = Array.isArray(valeurCompteClient) ? valeurCompteClient : (valeurCompteClient ? [valeurCompteClient] : []);
      if (idsLiesPlanning.length > 0 && (!session.tenantId || !idsLiesPlanning.includes(session.tenantId))) {
        return res.status(403).json({ error: "Accès refusé : ce créneau n'appartient pas à votre tenant." });
      }
      // idsLiesPlanning vide -> creneau demo/CONFIG-like sans tenant : laisse passer.
    }
  }

  // AUTH #004D : "Tickets SAV" et "Planning Commercial" — hors périmètre,
  // volontairement non filtrées (documenté précisément, pas une omission) :
  //   - "Tickets SAV" : champ "Compte client" fiable, MAIS les 3 pages
  //     publiques (avis.html, devis.html, suivi.html) accèdent aussi à des
  //     enregistrements par recordId DIRECT (pas seulement par recherche),
  //     contrairement à "Clients". Un visiteur public qui aurait par
  //     ailleurs un cookie de session interne actif dans le même navigateur
  //     verrait son accès au ticket public bloqué si ce ticket appartient à
  //     un autre tenant que sa session — casserait la page publique dans ce
  //     cas précis. Contrairement à "Planning", il n'existe pas de sous-cas
  //     "champ absent" à exploiter ici : un ticket réel a TOUJOURS un
  //     "Compte client" renseigné, donc la règle utilisée pour Planning ne
  //     s'applique pas. Non filtrée, documentée, pas de règle inventée.
  //   - "Planning Commercial" : aucun champ de rattachement tenant, direct
  //     ou indirect (audit #004B). Dette structurelle — nécessiterait une
  //     modification du modèle de données Airtable, hors périmètre ici.

  // AUTH #004C : tables dont le rattachement tenant a été confirmé fiable
  // lors de l'audit #004B. Pour chacune, "champ" est le champ RÉELLEMENT
  // identifié dans le schéma Airtable (jamais supposé) :
  //   - "Client Record ID" : champ lookup dédié, renvoie le VRAI recordId
  //     du client lié (contourne le piège déjà documenté sur ce projet :
  //     ARRAYJOIN() sur un lien Airtable brut renvoie le NOM du client, pas
  //     son ID) — permet un filtrage de LISTE fiable via filterByFormula.
  //   - "Compte client" / "Client" : lien Airtable brut uniquement. Fiable
  //     pour vérifier la propriété d'UN enregistrement précis (on relit le
  //     champ après avoir récupéré le record par son ID), mais PAS pour
  //     construire un filtre de liste fiable (même piège ARRAYJOIN) — donc
  //     filtrageListeFiable=false pour ces tables : aucune tentative de
  //     filtrer une recherche/liste n'est faite ci-dessous, volontairement,
  //     plutôt que d'inventer un filtre par nom potentiellement faux.
  const TABLES_TENANT_CONFIRME = {
    'Devis': { champ: 'Client Record ID', filtrageListeFiable: true },
    'Catalogue Produits': { champ: 'Client Record ID', filtrageListeFiable: true },
    "Grille Main d'œuvre": { champ: 'Client Record ID', filtrageListeFiable: true },
    'Mise en page Devis': { champ: 'Client Record ID', filtrageListeFiable: true },
    'Métrés': { champ: 'Compte client', filtrageListeFiable: false },
    'Agences': { champ: 'Client', filtrageListeFiable: false },
    'RDV Commercial': { champ: 'Compte client', filtrageListeFiable: false },
  };

  if (session && session.role !== 'SUPER_ADMIN_IKO' && TABLES_TENANT_CONFIRME[premierSegment]) {
    const conf = TABLES_TENANT_CONFIRME[premierSegment];
    const segmentsTable = subPathRaw.split('/').filter(Boolean);
    const recordIdDemande = segmentsTable[1];

    if (recordIdDemande) {
      // Accès à un enregistrement précis (GET/PATCH/DELETE) : on relit le
      // record pour vérifier sa propriété réelle AVANT de laisser passer
      // l'opération demandée. Jamais de confiance dans un tenantId fourni
      // par le navigateur — seule la valeur réellement stockée sur
      // l'enregistrement compte.
      let recCheck;
      try {
        const rCheck = await fetch('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(premierSegment) + '/' + recordIdDemande, { headers });
        if (!rCheck.ok) {
          const errData = await rCheck.json().catch(() => ({}));
          return res.status(rCheck.status).json(errData);
        }
        recCheck = await rCheck.json();
      } catch (err) {
        return res.status(502).json({ error: 'Erreur en vérifiant la propriété tenant de cet enregistrement.', details: String(err) });
      }
      const valeurChamp = (recCheck.fields || {})[conf.champ];
      const idsLies = Array.isArray(valeurChamp) ? valeurChamp : (valeurChamp ? [valeurChamp] : []);
      if (!session.tenantId || !idsLies.includes(session.tenantId)) {
        return res.status(403).json({ error: "Accès refusé : cet enregistrement n'appartient pas à votre tenant." });
      }
    } else if (req.method === 'GET' && conf.filtrageListeFiable) {
      // Liste/recherche : on ajoute un filtre tenant obligatoire en plus de
      // tout filtre déjà fourni par le navigateur (jamais à sa place — le
      // filtre navigateur seul ne serait pas suffisant, il pourrait être
      // absent ou manipulé).
      const formuleTenant = 'FIND("' + session.tenantId + '", ARRAYJOIN({' + conf.champ + '}))';
      rest.filterByFormula = rest.filterByFormula ? 'AND(' + rest.filterByFormula + ', ' + formuleTenant + ')' : formuleTenant;
    } else if (req.method === 'GET' && !conf.filtrageListeFiable) {
      // Table sans champ ID fiable pour une recherche par formule (cf.
      // commentaire de configuration ci-dessus). NON FILTRÉ dans cette
      // étape, volontairement — signalé explicitement dans le rapport
      // plutôt que de deviner un filtre par nom.
    } else if (req.method === 'POST') {
      // Création : si le champ tenant est explicitement fourni par le
      // navigateur, il doit correspondre exactement au tenant de la
      // session — jamais un autre. S'il est absent, on laisse passer sans
      // le forcer (mode de coexistence, ne casse pas un flux de création
      // existant qui ne l'enverrait pas explicitement).
      const champsEnvoyes = (req.body && req.body.fields) || {};
      if (Object.prototype.hasOwnProperty.call(champsEnvoyes, conf.champ)) {
        const valeurEnvoyee = champsEnvoyes[conf.champ];
        const tableauEnvoye = Array.isArray(valeurEnvoyee) ? valeurEnvoyee : [valeurEnvoyee];
        if (!session.tenantId || tableauEnvoye.length !== 1 || tableauEnvoye[0] !== session.tenantId) {
          return res.status(403).json({ error: 'Création refusée : le tenant fourni ne correspond pas à votre session.' });
        }
      }
    } else {
      // PATCH/DELETE sans recordId : forme non valide pour une table
      // tenant-confirmée, aucun usage légitime connu — refusé par prudence.
      return res.status(400).json({ error: 'Requête invalide pour cette table.' });
    }
  }

  // Garde-fou métier : une annulation de ticket SAV doit toujours être
  // accompagnée d'un motif, même si l'appel contourne suivi.html (validation
  // front seule insuffisante).
  if (req.method === 'PATCH' && subPathRaw.startsWith('Tickets SAV/')) {
    const fields = req.body && req.body.fields;
    if (fields && fields.Statut === 'Annulé') {
      const raison = typeof fields['Raison annulation'] === 'string' ? fields['Raison annulation'].trim() : '';
      if (!raison) {
        return res.status(400).json({ error: "Motif d'annulation obligatoire (champ 'Raison annulation')." });
      }
    }
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else if (value !== undefined) {
      params.append(key, value);
    }
  }
  const qs = params.toString();
  const airtableUrl = 'https://api.airtable.com/v0/' + baseId + '/' + encodedSubPath + (qs ? '?' + qs : '');

  const init = {
    method: req.method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = JSON.stringify(req.body);
  }

  try {
    const airtableRes = await fetch(airtableUrl, init);
    const data = await airtableRes.json().catch(() => ({}));
    res.status(airtableRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Erreur en contactant Airtable', details: String(err) });
  }
}
