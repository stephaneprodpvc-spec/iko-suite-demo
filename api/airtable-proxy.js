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
//   - "Tickets SAV" : PAS filtree par tenant a ce niveau - hors perimetre
//     de #004C/#004D, ambiguite reelle avec l'usage par recordId des pages
//     publiques (cf. #004B). Isolee depuis via une ROUTE DEDIEE distincte,
//     voir le bloc AUTH #006 plus bas dans ce fichier.
//   - "Planning Commercial" : longtemps sans champ de rattachement tenant
//     (dette structurelle documentee en #004B/#004D). Le champ "Compte
//     client" a ete ajoute cote schema Airtable (table vide au moment de
//     la creation, aucune donnee existante affectee) - isolation tenant
//     serveur implementee depuis AUTH #007 (Jalon 2.5), voir le bloc dedie
//     plus bas dans ce fichier. Session desormais OBLIGATOIRE pour cette
//     table (echec ferme), contrairement au mode de coexistence des autres
//     tables : commerce.html envoie deja systematiquement une session
//     (migre Auth #003), aucun flux existant a casser.
//
// Bloquee INCONDITIONNELLEMENT, quelle que soit la session : la table
// "Utilisateurs" (hash de mots de passe, tokenId de rotation). Aucune page
// ne l'utilise via ce proxy a ce jour (verifie) - aucun risque de regression.

const CONFIG_RECORD_ID = 'rec45X231n9dXnyaU';

// CORRECTION SECURITE — webhook Make expose cote client. Plusieurs pages
// appelaient directement cette URL depuis le navigateur : visible en clair
// dans le code source, n'importe qui pouvait la rejouer avec un payload
// arbitraire (fausses notifications vers l'agence ou vers un client,
// usurpation de donnees). Deplacee ici, cote serveur : le navigateur
// n'appelle plus que /api/airtable/webhook (proxy relaye ensuite), l'URL
// Make n'est plus jamais transmise au client.
// Etape 1 (deja en prod) : 3 pages publiques (index.html, suivi.html,
// devis.html), scenario Make principal, POST + corps JSON uniquement.
// Etape 2 (ce correctif) : 4 pages internes (dashboard.html, technicien.html,
// commerce.html, metreur.html). Deux particularites reelles decouvertes a la
// verification prealable des flux, traitees sans changer le comportement :
//   - dashboard.html envoie 2 appels historiques en GET avec action/ticket
//     dans la query string (jamais de corps JSON) : /webhook accepte donc
//     aussi GET, en relayant la meme query string telle quelle vers Make -
//     jamais convertie en POST (le parsing cote scenario Make n'est pas
//     verifiable depuis ce depot, une conversion aurait ete un changement de
//     comportement non maitrise).
//   - metreur.html utilise un scenario Make DIFFERENT (URL distincte) : route
//     separee /webhook-metreur, avec sa propre URL et sa propre whitelist.
const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/n3lwi92wldkf22jcemmjfem334p4mv6a'; // scenario demo isole (principal)
const MAKE_WEBHOOK_URL_METREUR = 'https://hook.eu1.make.com/xczscdk40wh653mmnxnx7x63kawjcgx4'; // scenario metreur/BE, distinct

// Whitelist stricte des actions webhook reellement utilisees par les pages
// publiques (index.html : aucun champ "action" - cas "nouvelle demande SAV",
// traite a part ci-dessous ; suivi.html : message_client, rdv_modifie ;
// devis.html : devis_refuse, devis_accepte) et par les 4 pages internes
// (dashboard.html : aucun champ "action" - creation ticket agent -, egalement
// traite a part, + devis_envoye, reponse_agence, renvoi_technicien,
// renvoi_client ; technicien.html : devis_auto_envoye, renvoi_client,
// devis_deblocage, demande_note ; commerce.html : rdv_commercial). Toute
// autre valeur est rejetee : reduit la surface reelle exploitable par un
// tiers qui connaitrait le secret applicatif (deja documente comme limite
// acceptee du proxy) - sans empecher completement l'usurpation de contenu
// sur une action legitime (necessiterait de verifier l'existence/propriete
// du ticket cote Airtable avant de relayer, hors perimetre de ce correctif).
const ACTIONS_WEBHOOK_AUTORISEES = [
  'message_client', 'rdv_modifie', 'devis_refuse', 'devis_accepte',
  'devis_envoye', 'reponse_agence', 'renvoi_technicien', 'renvoi_client',
  'devis_auto_envoye', 'devis_deblocage', 'demande_note', 'rdv_commercial',
];
// Whitelist separee et distincte pour le scenario metreur/BE (URL Make
// differente ci-dessus) : jamais melangee avec la liste principale.
const ACTIONS_WEBHOOK_METREUR_AUTORISEES = ['metreur_envoye', 'resume_be_envoye'];

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

// AUTH #010 — Contrôle centralisé "Modules actifs". Extrait du bloc
// Planning Commercial (AUTH #007), où cette même logique existait déjà en
// ligne pour le module "Commerce" : réutilisé ici tel quel, pas une
// nouvelle règle. Le tenant DOIT venir d'une session déjà vérifiée par
// l'appelant (jamais une valeur fournie par le navigateur) — cette
// fonction ne fait que résoudre "Modules actifs" depuis le VRAI
// enregistrement Clients/<tenantId> et vérifier que le module demandé y
// figure. Ne s'applique qu'aux tables où le mapping module <-> route est
// déjà certain dans le code existant (voir commentaires aux points
// d'appel) — jamais inventé pour une table où ce lien n'est pas prouvé.
async function verifierModuleActif(baseId, headers, tenantId, moduleRequis) {
  let recClient;
  try {
    const r = await fetch('https://api.airtable.com/v0/' + baseId + '/Clients/' + tenantId, { headers });
    if (!r.ok) return { ok: false, status: 403, error: 'Accès refusé : tenant de session introuvable.' };
    recClient = await r.json();
  } catch (err) {
    return { ok: false, status: 502, error: 'Erreur en résolvant le tenant de session.', details: String(err) };
  }
  const modulesActifs = (recClient.fields || {})['Modules actifs'];
  const liste = Array.isArray(modulesActifs) ? modulesActifs : [];
  if (!liste.includes(moduleRequis)) {
    return { ok: false, status: 403, error: "Accès refusé : le module " + moduleRequis + " n'est pas activé pour ce tenant." };
  }
  return { ok: true, recClient };
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

// Relais webhook partage entre /webhook (scenario principal) et
// /webhook-metreur (scenario distinct) : whitelist + URL cible passees en
// parametre pour ne jamais melanger les deux. Supporte GET (query string
// relayee telle quelle, cas historique dashboard.html) et POST (corps JSON
// relaye tel quel, tous les autres appels du depot) - jamais l'un converti
// en l'autre, pour ne rien changer au comportement reellement observe.
async function relayerWebhook(req, res, urlCible, actionsAutorisees) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifierOrigine(req)) {
    return res.status(403).json({ error: 'Origine non autorisée.' });
  }

  if (req.method === 'GET') {
    const { path, ...restQuery } = req.query || {};
    const actionDemandee = restQuery.action;
    if (actionDemandee !== undefined && !actionsAutorisees.includes(actionDemandee)) {
      return res.status(400).json({ error: 'Action non reconnue.' });
    }
    const qs = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(restQuery)) {
      if (valeur !== undefined) qs.append(cle, valeur);
    }
    try {
      const webhookRes = await fetch(urlCible + (qs.toString() ? '?' + qs.toString() : ''));
      return res.status(webhookRes.ok ? 200 : 502).json({ ok: webhookRes.ok });
    } catch (err) {
      console.error('Erreur relais webhook Make (GET):', err);
      return res.status(502).json({ error: 'Erreur webhook' });
    }
  }

  // POST
  const actionDemandee = req.body && req.body.action;
  // Certaines pages (index.html, dashboard.html - creation de ticket) n'envoient
  // jamais de champ "action" : cas legitime distinct, laisse passer. Toute
  // AUTRE valeur doit figurer dans la whitelist fournie.
  if (actionDemandee !== undefined && !actionsAutorisees.includes(actionDemandee)) {
    return res.status(400).json({ error: 'Action non reconnue.' });
  }
  try {
    const webhookRes = await fetch(urlCible, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    return res.status(webhookRes.ok ? 200 : 502).json({ ok: webhookRes.ok });
  } catch (err) {
    // Ne jamais renvoyer le detail brut de l'erreur au client : un message
    // d'erreur reseau (DNS, connexion) peut contenir l'URL/l'hote Make, ce
    // qui romprait exactement la protection visee par ce relais. Logue cote
    // serveur uniquement (visible dans les logs Vercel).
    console.error('Erreur relais webhook Make (POST):', err);
    return res.status(502).json({ error: 'Erreur webhook' });
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
  const cheminBrut = Array.isArray(path) ? path.join('/') : (path || '');

  // CHANTIER MULTI-TENANT #1 (Option B) — route interne dédiée pour
  // "Tickets SAV" : /api/airtable/tenant/Tickets SAV. Le préfixe "tenant/"
  // est un simple signal de ROUTAGE, jamais un signal de sécurité fourni
  // par le client (contrairement à l'ancien en-tête X-Iko-Contexte,
  // retiré : un appel direct qui l'omettait désactivait entièrement le
  // contrôle — faille démontrée et corrigée ici). Une fois détecté, le
  // préfixe est retiré pour reconstruire le VRAI chemin Airtable
  // ("Tickets SAV" ou "Tickets SAV/recXXXX") : toute la logique existante
  // ci-dessous (rate-limit recherche, garde-fou annulation, construction
  // de l'URL finale) s'applique alors de façon transparente, sans
  // duplication. La route PUBLIQUE historique (/api/airtable/Tickets SAV,
  // sans préfixe) reste strictement inchangée : routeTenantTickets est
  // false pour tout appel à cette route.
  const routeTenantTickets = cheminBrut === 'tenant/Tickets SAV' || cheminBrut.startsWith('tenant/Tickets SAV/');

  // JALON 3c — même mécanisme de préfixe pour "Planning Commercial" et
  // "RDV Commercial" (AUTH #007 / AUTH #004C) : ces deux tables n'ont
  // AUCUN usage public (contrairement à "Tickets SAV"), donc pas besoin
  // d'une route publique séparée — mais le préfixe "tenant/" est conservé
  // pour la même raison de clarté et de cohérence de nommage dans toute
  // l'architecture serveur. Le préfixe reste un simple signal de ROUTAGE,
  // jamais un signal de sécurité : la protection réelle (bloc AUTH #007
  // plus bas) s'applique de façon identique que le préfixe soit présent
  // ou non, puisque ces tables sont déjà protégées sur leur route brute.
  const routeTenantPlanningCommercial = cheminBrut === 'tenant/Planning Commercial' || cheminBrut.startsWith('tenant/Planning Commercial/');
  const routeTenantRdvCommercial = cheminBrut === 'tenant/RDV Commercial' || cheminBrut.startsWith('tenant/RDV Commercial/');
  // AUTH #008 — même principe de préfixe pour "Interventions SAV" : table
  // 100% interne (technicien.html), aucun usage public, protection réelle
  // dans le bloc AUTH #008 plus bas.
  const routeTenantInterventionsSAV = cheminBrut === 'tenant/Interventions SAV' || cheminBrut.startsWith('tenant/Interventions SAV/');

  const subPathRaw = (routeTenantTickets || routeTenantPlanningCommercial || routeTenantRdvCommercial || routeTenantInterventionsSAV)
    ? cheminBrut.slice('tenant/'.length)
    : cheminBrut;
  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U'; // base démo Iko Suite
  const headers = { Authorization: 'Bearer ' + token };

  // Bloque inconditionnellement l'acces a la table Utilisateurs via ce
  // proxy, quelle que soit la session (voir commentaire de tete de fichier).
  const premierSegment = subPathRaw.split('/').filter(Boolean)[0] || '';

  // AUTH #013 — Exception étroite au blocage générique ci-dessous (qui
  // reste inchangé pour tout le reste : autre rôle, autre méthode, pas de
  // session). Seul un SUPER_ADMIN_IKO peut GET (liste) ou PATCH (Statut
  // uniquement) sur Utilisateurs — jamais "Hash mot de passe" ni
  // "Dernier tokenId refresh valide", ni aucun autre champ, ni en lecture
  // ni en écriture. admin.html appelle déjà /api/airtable/Utilisateurs
  // (inchangé, non modifié) : c'est cette route exacte qui est ici
  // autorisée, à la marge, pour ce seul rôle et ces deux méthodes.
  if (premierSegment.toLowerCase() === 'utilisateurs' && session && session.role === 'SUPER_ADMIN_IKO') {
    const CHAMPS_UTILISATEURS_SURS = ['Identifiant', 'tenantId', 'Rôle', 'Statut', 'Échecs de connexion', 'Bloqué jusqu\'à', 'Dernière connexion'];
    const segmentsAU = subPathRaw.split('/').filter(Boolean);
    const recordIdAU = segmentsAU[1];

    if (req.method === 'GET' && !recordIdAU) {
      const qs = new URLSearchParams(rest);
      CHAMPS_UTILISATEURS_SURS.forEach(c => qs.append('fields[]', c));
      try {
        const rAU = await fetch('https://api.airtable.com/v0/' + baseId + '/Utilisateurs?' + qs.toString(), { headers });
        const dataAU = await rAU.json();
        return res.status(rAU.status).json(dataAU);
      } catch (err) {
        return res.status(502).json({ error: 'Erreur en contactant Airtable', details: String(err) });
      }
    }
    if (req.method === 'PATCH' && recordIdAU) {
      const champsRecus = Object.keys((req.body || {}).fields || {});
      const champsIllegaux = champsRecus.filter(c => c !== 'Statut');
      if (champsIllegaux.length > 0) {
        return res.status(400).json({ error: 'Seul le champ Statut est modifiable via cette route.' });
      }
      try {
        const rAU = await fetch('https://api.airtable.com/v0/' + baseId + '/Utilisateurs/' + recordIdAU, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { Statut: req.body.fields.Statut } }),
        });
        const dataAU = await rAU.json();
        if (dataAU && dataAU.fields) {
          const filtre = {};
          CHAMPS_UTILISATEURS_SURS.forEach(c => { if (c in dataAU.fields) filtre[c] = dataAU.fields[c]; });
          dataAU.fields = filtre;
        }
        return res.status(rAU.status).json(dataAU);
      } catch (err) {
        return res.status(502).json({ error: 'Erreur en contactant Airtable', details: String(err) });
      }
    }
    // Autre méthode (POST/DELETE) ou GET avec recordId : hors périmètre
    // de cette exception, retombe sur le blocage générique ci-dessous.
  }

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
    return relayerWebhook(req, res, MAKE_WEBHOOK_URL, ACTIONS_WEBHOOK_AUTORISEES);
  }

  if (subPathRaw === 'webhook-metreur') {
    return relayerWebhook(req, res, MAKE_WEBHOOK_URL_METREUR, ACTIONS_WEBHOOK_METREUR_AUTORISEES);
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
  // AUTH #011 — Écriture sur Clients : session obligatoire. Le bloc
  // ci-dessous (déjà existant) ne s'exécute que si "session" est déjà
  // vrai — sans session, RIEN ne bloquait un POST/PATCH sur Clients, qui
  // atteignait Airtable directement (le X-App-Secret vérifié plus haut
  // n'est pas une authentification par utilisateur, seulement un filtre
  // anti-accès direct/automatisé, déjà documenté comme tel). Corrigé ici,
  // AVANT le bloc existant, uniquement pour les méthodes d'écriture — les
  // LECTURES ne sont pas concernées : les pages publiques (amandine.html,
  // devis.html, avis.html, suivi.html) lisent Clients par slug SANS
  // session, comportement volontaire et inchangé (cf. commentaire
  // ci-dessus). verifierSession() renvoie null aussi bien pour une
  // session absente qu'expirée/invalide (jwt.verify échoué) : les deux
  // cas sont donc couverts par ce seul contrôle.
  if (premierSegment === 'Clients' && (req.method === 'POST' || req.method === 'PATCH')) {
    if (!session) {
      return res.status(401).json({ error: 'Authentification requise pour modifier Clients.' });
    }
  }
  // AUTH #014 — Unicité du Slug, contrôlée SERVEUR (jamais uniquement
  // côté admin.html). Ne s'applique que si le champ Slug est réellement
  // présent dans la requête (une PATCH qui touche un autre champ ne doit
  // pas être bloquée). Comparaison insensible à la casse, cohérente avec
  // slugifier() qui normalise déjà en minuscules côté client — le
  // serveur ne fait pas confiance à cette normalisation et revérifie
  // lui-même avec LOWER(). Sur une modification (PATCH), le client lui-
  // même est exclu de la recherche (RECORD_ID() différent) pour pouvoir
  // conserver son propre slug inchangé.
  if (premierSegment === 'Clients' && (req.method === 'POST' || req.method === 'PATCH')) {
    const slugDemande = (req.body && req.body.fields && typeof req.body.fields.Slug === 'string') ? req.body.fields.Slug.trim() : null;
    if (slugDemande) {
      const segmentsSlug = subPathRaw.split('/').filter(Boolean);
      const recordIdActuel = segmentsSlug[1];
      const slugEchappe = slugDemande.replace(/"/g, '\\"');
      let formuleSlug = 'LOWER({Slug})=LOWER("' + slugEchappe + '")';
      if (recordIdActuel) {
        formuleSlug = 'AND(' + formuleSlug + ', RECORD_ID()!="' + recordIdActuel + '")';
      }
      try {
        const rSlug = await fetch(
          'https://api.airtable.com/v0/' + baseId + '/Clients?filterByFormula=' + encodeURIComponent(formuleSlug) + '&maxRecords=1',
          { headers }
        );
        if (!rSlug.ok) {
          return res.status(502).json({ error: 'Erreur en vérifiant l\'unicité du slug.' });
        }
        const dataSlug = await rSlug.json();
        if (Array.isArray(dataSlug.records) && dataSlug.records.length > 0) {
          return res.status(409).json({ error: 'Ce slug est déjà utilisé par un autre client.' });
        }
      } catch (err) {
        return res.status(502).json({ error: 'Erreur en vérifiant l\'unicité du slug.', details: String(err) });
      }
    }
  }
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

  // AUTH #004D (historique) / AUTH #006 (voir plus bas) : "Tickets SAV" —
  // longtemps volontairement non filtrée côté serveur à cause d'une
  // ambiguïté réelle (pages publiques accédant aussi par recordId direct
  // sur la MÊME route que les pages internes). Résolu depuis le Chantier
  // Multi-Tenant #1 par une ROUTE SERVEUR DÉDIÉE (Option B), jamais par un
  // signal client — voir le bloc AUTH #006 après TABLES_TENANT_CONFIRME.

  // AUTH #007 (Jalon 2.5) — "Planning Commercial" : isolation tenant
  // serveur. Contrairement aux tables de TABLES_TENANT_CONFIRME ci-dessous
  // (mode de coexistence, session optionnelle), cette table applique un
  // contrôle STRICT et OBLIGATOIRE :
  //   - Session obligatoire, quel que soit le rôle — aucune session =
  //     échec fermé (401). Sans risque de régression : commerce.html est
  //     déjà migré Auth #003 et envoie systématiquement une session ; il
  //     n'existe aucune page PUBLIQUE utilisant cette table (contrairement
  //     à "Tickets SAV"/"Planning", partagées avec des pages sans session).
  //   - tenant TOUJOURS résolu depuis session.tenantId (JWT vérifié
  //     serveur), jamais depuis une valeur fournie par le navigateur.
  //   - SUPER_ADMIN_IKO : accès global conservé, aucune restriction ni
  //     stamping (comportement identique aux autres tables du fichier).
  //   - Lecture d'un enregistrement précis (recordId) : relecture serveur
  //     + vérification stricte de "Compte client". Contrairement au bloc
  //     "Planning" (#004D) qui laisse passer un enregistrement SANS tenant
  //     (créneaux démo publics légitimes), "Planning Commercial" n'a AUCUN
  //     usage public connu : un enregistrement sans "Compte client", ou
  //     dont la valeur ne contient pas le tenant de session, est REFUSÉ
  //     (échec fermé, jamais de laisser-passer par défaut).
  //   - Lecture de liste (GET sans recordId) : filtre tenant OBLIGATOIRE
  //     injecté serveur, même limite technique que "Tickets SAV"/"RDV
  //     Commercial" — "Compte client" est un lien Airtable brut (pas de
  //     "Client Record ID" dédié sur cette table), ARRAYJOIN() renvoie le
  //     NOM du client et non son recordId (piège déjà documenté sur ce
  //     projet). Le nom du tenant est donc résolu par un appel séparé à
  //     Clients/<tenantId> (jamais depuis une valeur fournie par le
  //     navigateur) avant de construire le filtre — c'est la lecture liste
  //     la plus sécurisée que ce modèle de données permette actuellement.
  //   - Écriture (POST création, PATCH sur un enregistrement déjà vérifié
  //     tenant) : "Compte client" est STAMPÉ CÔTÉ SERVEUR, systématiquement
  //     écrasé avec [session.tenantId] — jamais une confiance dans une
  //     valeur envoyée par le navigateur, même si elle semblait correcte.
  //   - PATCH/DELETE sans recordId, ou toute autre méthode : refusé (400),
  //     aucun usage légitime connu, pas de règle inventée.
  //   - Module "Commerce" OBLIGATOIRE : en plus de la session et du
  //     tenant, le champ "Modules actifs" du client (table "Clients")
  //     doit contenir exactement "Commerce" pour un rôle non
  //     SUPER_ADMIN_IKO — sinon refusé (403), quelle que soit la validité
  //     de la session/du tenant par ailleurs. Résolu en un seul appel
  //     serveur à Clients/<tenantId> (jamais une valeur fournie par le
  //     navigateur), réutilisé pour la résolution du nom de tenant sur la
  //     lecture de liste (évite un second appel).
  if (premierSegment === 'Planning Commercial') {
    if (!session) {
      return res.status(401).json({ error: 'Authentification requise pour accéder à Planning Commercial.' });
    }
    if (session.role !== 'SUPER_ADMIN_IKO') {
      if (!session.tenantId) {
        return res.status(403).json({ error: 'Accès refusé : session sans tenant valide.' });
      }
      // Résolution + vérification du module "Commerce" (obligatoire pour
      // cette table), via la fonction centralisée AUTH #010. recClient
      // renvoyé est réutilisé plus bas pour résoudre le nom du tenant sur
      // une liste (ARRAYJOIN renvoie le nom, pas le recordId — piège déjà
      // documenté sur ce projet), sans second appel serveur.
      const controleModulePC = await verifierModuleActif(baseId, headers, session.tenantId, 'Commerce');
      if (!controleModulePC.ok) {
        return res.status(controleModulePC.status).json({ error: controleModulePC.error, details: controleModulePC.details });
      }
      const recClientSessionPC = controleModulePC.recClient;
      const segmentsPC = subPathRaw.split('/').filter(Boolean);
      const recordIdPC = segmentsPC[1];

      if (recordIdPC) {
        // GET/PATCH/DELETE sur un enregistrement précis : relecture serveur
        // AVANT toute opération, jamais de confiance dans un tenantId fourni
        // par le navigateur.
        let recPC;
        try {
          const rPC = await fetch('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(premierSegment) + '/' + recordIdPC, { headers });
          if (!rPC.ok) {
            const errData = await rPC.json().catch(() => ({}));
            return res.status(rPC.status).json(errData);
          }
          recPC = await rPC.json();
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en vérifiant la propriété tenant de ce créneau commercial.', details: String(err) });
        }
        const valeurCompteClientPC = (recPC.fields || {})['Compte client'];
        const idsLiesPC = Array.isArray(valeurCompteClientPC) ? valeurCompteClientPC : (valeurCompteClientPC ? [valeurCompteClientPC] : []);
        // Échec fermé : aucun laisser-passer pour un enregistrement sans
        // tenant (contrairement au bloc "Planning" #004D) — table 100%
        // interne, sans usage public connu.
        if (!idsLiesPC.includes(session.tenantId)) {
          return res.status(403).json({ error: "Accès refusé : ce créneau commercial n'appartient pas à votre tenant." });
        }
        // Stamping serveur en écriture : le champ n'est jamais accepté tel
        // quel depuis le navigateur, toujours recalculé côté serveur.
        if (req.method === 'PATCH') {
          if (!req.body) req.body = {};
          if (!req.body.fields) req.body.fields = {};
          req.body.fields['Compte client'] = [session.tenantId];
        }
      } else if (req.method === 'GET') {
        // Liste/recherche : filtre tenant obligatoire, résolu depuis le
        // client de session déjà chargé ci-dessus (jamais depuis le
        // navigateur, aucun second appel nécessaire).
        const nomTenantPC = (recClientSessionPC.fields || {})['Nom client'];
        if (!nomTenantPC) return res.status(403).json({ error: 'Accès refusé : tenant de session incomplet.' });
        const formuleTenantPC = 'FIND("' + String(nomTenantPC).replace(/"/g, '\\"') + '", ARRAYJOIN({Compte client}))';
        rest.filterByFormula = rest.filterByFormula ? 'AND(' + rest.filterByFormula + ', ' + formuleTenantPC + ')' : formuleTenantPC;
      } else if (req.method === 'POST') {
        // Création : stamping serveur systématique, jamais de confiance
        // dans une valeur fournie par le navigateur (présente ou non).
        if (!req.body) req.body = {};
        if (!req.body.fields) req.body.fields = {};
        req.body.fields['Compte client'] = [session.tenantId];
      } else {
        // PATCH/DELETE sans recordId, ou toute autre méthode : aucun usage
        // légitime connu — refusé par prudence, pas de règle inventée.
        return res.status(400).json({ error: 'Requête invalide pour cette table.' });
      }
    }
    // SUPER_ADMIN_IKO : accès global conservé, aucune restriction ni stamping.
  }

  // AUTH #008 (Chantier Interventions SAV) — "Interventions SAV" : même
  // modèle STRICT que AUTH #007 (Planning Commercial) ci-dessus — session
  // obligatoire, tenant résolu uniquement depuis session.tenantId, échec
  // fermé sur tout enregistrement sans tenant. Différences : pas de
  // vérification de module (fonctionnalité SAV cœur, pas un module
  // optionnel), et vérification supplémentaire que le "Ticket SAV" lié
  // (en écriture) appartient bien au même tenant — une intervention ne
  // doit jamais pouvoir être rattachée au ticket d'un autre client.
  if (premierSegment === 'Interventions SAV') {
    if (!session) {
      return res.status(401).json({ error: 'Authentification requise pour accéder à Interventions SAV.' });
    }
    if (session.role !== 'SUPER_ADMIN_IKO') {
      if (!session.tenantId) {
        return res.status(403).json({ error: 'Accès refusé : session sans tenant valide.' });
      }
      let recClientSessionISAV;
      try {
        const rClientSessionISAV = await fetch('https://api.airtable.com/v0/' + baseId + '/Clients/' + session.tenantId, { headers });
        if (!rClientSessionISAV.ok) return res.status(403).json({ error: 'Accès refusé : tenant de session introuvable.' });
        recClientSessionISAV = await rClientSessionISAV.json();
      } catch (err) {
        return res.status(502).json({ error: 'Erreur en résolvant le tenant de session.', details: String(err) });
      }
      const segmentsISAV = subPathRaw.split('/').filter(Boolean);
      const recordIdISAV = segmentsISAV[1];

      if (recordIdISAV) {
        let recISAV;
        try {
          const rISAV = await fetch('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(premierSegment) + '/' + recordIdISAV, { headers });
          if (!rISAV.ok) {
            const errData = await rISAV.json().catch(() => ({}));
            return res.status(rISAV.status).json(errData);
          }
          recISAV = await rISAV.json();
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en vérifiant la propriété tenant de cette intervention.', details: String(err) });
        }
        const valeurCompteClientISAV = (recISAV.fields || {})['Compte client'];
        const idsLiesISAV = Array.isArray(valeurCompteClientISAV) ? valeurCompteClientISAV : (valeurCompteClientISAV ? [valeurCompteClientISAV] : []);
        if (!idsLiesISAV.includes(session.tenantId)) {
          return res.status(403).json({ error: "Accès refusé : cette intervention n'appartient pas à votre tenant." });
        }
        if (req.method === 'PATCH') {
          if (!req.body) req.body = {};
          if (!req.body.fields) req.body.fields = {};
          req.body.fields['Compte client'] = [session.tenantId];
        }
      } else if (req.method === 'GET') {
        const nomTenantISAV = (recClientSessionISAV.fields || {})['Nom client'];
        if (!nomTenantISAV) return res.status(403).json({ error: 'Accès refusé : tenant de session incomplet.' });
        const formuleTenantISAV = 'FIND("' + String(nomTenantISAV).replace(/"/g, '\\"') + '", ARRAYJOIN({Compte client}))';
        rest.filterByFormula = rest.filterByFormula ? 'AND(' + rest.filterByFormula + ', ' + formuleTenantISAV + ')' : formuleTenantISAV;
      } else if (req.method === 'POST') {
        if (!req.body) req.body = {};
        if (!req.body.fields) req.body.fields = {};
        // AUTH #008 correctif A1 : Ticket SAV obligatoire. Sans lui, aucun
        // moyen de garantir qu'une intervention se rattache reellement a un
        // dossier existant du tenant appelant - on refuse plutot que de
        // creer un enregistrement orphelin (fausserait Nb Passages
        // Technicien / Cout SAV Reel sans que rien ne le signale).
        const ticketLieId = Array.isArray(req.body.fields['Ticket SAV']) ? req.body.fields['Ticket SAV'][0] : null;
        if (!ticketLieId) {
          return res.status(400).json({ error: "Ticket SAV obligatoire pour créer une intervention." });
        }
        // Verification que le ticket lie appartient au meme tenant AVANT
        // toute creation : sans ca, un ticket_id fourni par erreur (ou de
        // mauvaise foi) pourrait rattacher une intervention au dossier
        // d'un autre client.
        try {
          const rTicketCheck = await fetch('https://api.airtable.com/v0/' + baseId + '/Tickets%20SAV/' + ticketLieId, { headers });
          if (!rTicketCheck.ok) return res.status(403).json({ error: 'Ticket SAV lié introuvable.' });
          const recTicketCheck = await rTicketCheck.json();
          const compteClientTicket = (recTicketCheck.fields || {})['Compte client'];
          const idsTicket = Array.isArray(compteClientTicket) ? compteClientTicket : (compteClientTicket ? [compteClientTicket] : []);
          if (!idsTicket.includes(session.tenantId)) {
            return res.status(403).json({ error: "Accès refusé : ce ticket n'appartient pas à votre tenant." });
          }
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en vérifiant le ticket lié.', details: String(err) });
        }
        // AUTH #008 correctif A2 : meme principe pour le Technicien fourni,
        // si present. Sans ce controle, un appel API forge (session valide
        // mais payload trafique) pourrait lier l'intervention a un compte
        // Utilisateurs d'un AUTRE tenant - jamais atteignable en usage
        // normal (IKO_USER_ID vient du JWT du technicien lui-meme, non
        // falsifiable sans le secret de signature), mais le serveur ne doit
        // jamais faire confiance a une valeur fournie par le navigateur.
        const technicienId = Array.isArray(req.body.fields['Technicien']) ? req.body.fields['Technicien'][0] : null;
        if (technicienId) {
          try {
            const rTechCheck = await fetch('https://api.airtable.com/v0/' + baseId + '/Utilisateurs/' + technicienId, { headers });
            if (!rTechCheck.ok) return res.status(403).json({ error: 'Technicien introuvable.' });
            const recTechCheck = await rTechCheck.json();
            const tenantTech = (recTechCheck.fields || {})['tenantId'];
            const idsTech = Array.isArray(tenantTech) ? tenantTech : (tenantTech ? [tenantTech] : []);
            if (!idsTech.includes(session.tenantId)) {
              return res.status(403).json({ error: "Accès refusé : ce technicien n'appartient pas à votre tenant." });
            }
          } catch (err) {
            return res.status(502).json({ error: 'Erreur en vérifiant le technicien lié.', details: String(err) });
          }
        }
        req.body.fields['Compte client'] = [session.tenantId];
      } else {
        return res.status(400).json({ error: 'Requête invalide pour cette table.' });
      }
    }
    // SUPER_ADMIN_IKO : accès global conservé, aucune restriction ni stamping.
  }

  // JALON 3c — correctif "RDV Commercial" : cette table est gérée par le
  // mode de COEXISTENCE générique de TABLES_TENANT_CONFIRME ci-dessous
  // (session optionnelle, "Compte client" validé UNIQUEMENT s'il est
  // explicitement fourni par le navigateur — jamais stampé d'office).
  // commerce.html (seul appelant réel de cette table, vérifié) n'envoie
  // JAMAIS "Compte client" à la création : aucune raison de le faire, cf.
  // principe général "jamais confiance dans une valeur du navigateur".
  // Sans correctif, un RDV créé via commerce.html se retrouvait donc SANS
  // tenant — et devenait illisible même par son propre créateur (échec
  // fermé du bloc générique ci-dessous, recordId sans tenant correspondant
  // = refus). Stampé ici, EN AMONT du mode coexistence générique (que ce
  // bloc-ci ne modifie pas pour les 6 autres tables qui le partagent —
  // Devis, Catalogue Produits, Grille Main d'œuvre, Mise en page Devis,
  // Métrés, Agences), avec le même principe que le stamping AUTH #007 :
  // tenant TOUJOURS résolu depuis session.tenantId, jamais une valeur
  // fournie par le navigateur, écrasée si présente.
  if (premierSegment === 'RDV Commercial' && req.method === 'POST' && session && session.role !== 'SUPER_ADMIN_IKO') {
    if (!session.tenantId) {
      return res.status(403).json({ error: 'Accès refusé : session sans tenant valide.' });
    }
    // AUTH #010 : RDV Commercial appartient à la même famille que Planning
    // Commercial (même appelant commerce.html, même module "Commerce" —
    // cf. commentaire AUTH #007 ci-dessus), mais ce contrôle manquait ici.
    // Corrigé avec la fonction centralisée, comportement identique à
    // Planning Commercial.
    const controleModuleRDV = await verifierModuleActif(baseId, headers, session.tenantId, 'Commerce');
    if (!controleModuleRDV.ok) {
      return res.status(controleModuleRDV.status).json({ error: controleModuleRDV.error, details: controleModuleRDV.details });
    }
    if (!req.body) req.body = {};
    if (!req.body.fields) req.body.fields = {};
    req.body.fields['Compte client'] = [session.tenantId];
  }

  // AUTH #012 — RDV Commercial GET/PATCH/DELETE : jusqu'ici, ces méthodes
  // dépendaient entièrement du mode de coexistence de TABLES_TENANT_CONFIRME
  // ci-dessous, qui ne s'applique QUE si une session non-admin est déjà
  // présente — sans session du tout, aucun filtre tenant n'était appliqué
  // (accès anonyme possible à la liste ou à un enregistrement précis).
  // Le module "Commerce" n'était pas non plus vérifié sur ces méthodes
  // (déjà fait sur POST via AUTH #010). Corrigé ici : session obligatoire,
  // SUPER_ADMIN_IKO inchangé, sinon module "Commerce" vérifié AVANT de
  // laisser le contrôle tenant existant (bloc TABLES_TENANT_CONFIRME juste
  // après) s'exécuter normalement — pas de duplication de cette logique
  // tenant, seulement l'ajout du préalable session+module manquant.
  // session.tenantId (jamais req.body, localStorage ou query string) est
  // la seule source utilisée pour l'autorisation.
  if (premierSegment === 'RDV Commercial' && (req.method === 'GET' || req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!session) {
      return res.status(401).json({ error: 'Authentification requise pour accéder à RDV Commercial.' });
    }
    if (session.role !== 'SUPER_ADMIN_IKO') {
      if (!session.tenantId) {
        return res.status(403).json({ error: 'Accès refusé : session sans tenant valide.' });
      }
      const controleModuleRDVLecture = await verifierModuleActif(baseId, headers, session.tenantId, 'Commerce');
      if (!controleModuleRDVLecture.ok) {
        return res.status(controleModuleRDVLecture.status).json({ error: controleModuleRDVLecture.error, details: controleModuleRDVLecture.details });
      }
    }
  }

  // AUTH #004C : tables dont le rattachement tenant a été confirmé fiable
  // lors de l'audit #004B. Pour chacune, "champ" est le champ RÉELLEMENT
  // identifié dans le schéma Airtable (jamais supposé) :
  //   - "Client Record ID" : champ lookup dédié, renvoie le VRAI recordId
  //     du client lié (contourne le piège déjà documenté sur ce projet :
  //     ARRAYJOIN() sur un lien Airtable brut renvoie le NOM du client, pas
  //     son ID) — permet un filtrage de LISTE fiable via filterByFormula.
  //   - "Compte client" / "Client" : lien Airtable brut uniquement. Fiable
  //     pour vérifier la propriété d'UN enregistrement précis (on relit le
  //     champ après avoir récupéré le record par son ID). Pour le
  //     filtrage de LISTE, ARRAYJOIN() sur ce lien brut renvoie le NOM du
  //     client et non son recordId (même piège) — filtrageListeFiable=false
  //     signale ce cas, résolu depuis le Jalon 5 (audit sécurité) par une
  //     résolution du nom de tenant via un appel serveur séparé à
  //     Clients/<tenantId> (voir bloc GET ci-dessous) plutôt que par
  //     l'absence de filtre pratiquée avant ce correctif.
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
      // JALON 5 — CORRECTIF SÉCURITÉ : auparavant non filtré du tout ici
      // (fuite de liste inter-tenant réelle, trouvée lors de l'audit —
      // n'importe quelle session valide d'un tenant pouvait lister TOUTES
      // les listes/recherches Métrés, Agences, RDV Commercial de TOUS les
      // tenants). Corrigé avec la même technique que AUTH #007 (Planning
      // Commercial) : "conf.champ" est un lien Airtable brut (ARRAYJOIN
      // renvoie le NOM du client, pas son recordId — piège déjà documenté
      // sur ce projet), donc le nom du tenant est résolu via un appel
      // serveur séparé à Clients/<tenantId> — jamais depuis une valeur
      // fournie par le navigateur — avant de construire le filtre.
      let nomTenantListe;
      try {
        const rTenantListe = await fetch('https://api.airtable.com/v0/' + baseId + '/Clients/' + session.tenantId, { headers });
        if (!rTenantListe.ok) return res.status(403).json({ error: 'Accès refusé : tenant de session introuvable.' });
        const recTenantListe = await rTenantListe.json();
        nomTenantListe = (recTenantListe.fields || {})['Nom client'];
      } catch (err) {
        return res.status(502).json({ error: 'Erreur en résolvant le tenant de session.', details: String(err) });
      }
      if (!nomTenantListe) return res.status(403).json({ error: 'Accès refusé : tenant de session incomplet.' });
      const formuleTenantListe = 'FIND("' + String(nomTenantListe).replace(/"/g, '\\"') + '", ARRAYJOIN({' + conf.champ + '}))';
      rest.filterByFormula = rest.filterByFormula ? 'AND(' + rest.filterByFormula + ', ' + formuleTenantListe + ')' : formuleTenantListe;
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

  // JALON 5 — "Ouvertures Métré" : AUCUNE protection tenant n'existait pour
  // cette table (ni dans TABLES_TENANT_CONFIRME, ni bloc dédié) — trouvé
  // lors de l'audit de sécurité demandé. Contrairement aux autres tables,
  // elle n'a PAS de champ "Compte client" direct : le rattachement tenant
  // passe UNIQUEMENT par son lien "Métré" vers la table Métrés (qui, elle,
  // porte "Compte client"). Protection en DEUX SAUTS : on relit le Métré
  // lié pour vérifier sa propriété, jamais de confiance dans une valeur
  // fournie par le navigateur.
  if (premierSegment === 'Ouvertures Métré') {
    if (!session) {
      return res.status(401).json({ error: 'Authentification requise pour accéder à Ouvertures Métré.' });
    }
    if (session.role !== 'SUPER_ADMIN_IKO') {
      if (!session.tenantId) {
        return res.status(403).json({ error: 'Accès refusé : session sans tenant valide.' });
      }

      // Vérifie qu'un recordId Métrés donné appartient au tenant de session
      // (2e saut) — jamais de confiance dans une valeur fournie par le
      // navigateur, seule la valeur réellement stockée sur Métrés compte.
      const metreAppartientAuTenant = async (idMetre) => {
        try {
          const r = await fetch('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent('Métrés') + '/' + idMetre, { headers });
          if (!r.ok) return false;
          const rec = await r.json();
          const v = (rec.fields || {})['Compte client'];
          const ids = Array.isArray(v) ? v : (v ? [v] : []);
          return ids.includes(session.tenantId);
        } catch (e) { return false; }
      };

      const segmentsOM = subPathRaw.split('/').filter(Boolean);
      const recordIdOM = segmentsOM[1];

      if (recordIdOM) {
        // GET/PATCH/DELETE sur une ouverture précise : relit l'ouverture,
        // vérifie que SON Métré actuel appartient au tenant — échec fermé
        // (aucune ouverture sans Métré rattaché légitime connu).
        let recOM;
        try {
          const rOM = await fetch('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(premierSegment) + '/' + recordIdOM, { headers });
          if (!rOM.ok) {
            const errData = await rOM.json().catch(() => ({}));
            return res.status(rOM.status).json(errData);
          }
          recOM = await rOM.json();
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en vérifiant la propriété tenant de cette ouverture.', details: String(err) });
        }
        const metreLies = (recOM.fields || {})['Métré'];
        const idsMetre = Array.isArray(metreLies) ? metreLies : (metreLies ? [metreLies] : []);
        const appartient = idsMetre.length > 0 && (await Promise.all(idsMetre.map(metreAppartientAuTenant))).some(Boolean);
        if (!appartient) {
          return res.status(403).json({ error: "Accès refusé : cette ouverture n'appartient pas à votre tenant." });
        }
        // PATCH : si un nouveau lien "Métré" est envoyé, il doit LUI AUSSI
        // appartenir au tenant — empêche un re-rattachement vers un autre
        // tenant via une valeur du navigateur.
        if (req.method === 'PATCH' && req.body && req.body.fields && Object.prototype.hasOwnProperty.call(req.body.fields, 'Métré')) {
          const nouveauxMetre = req.body.fields['Métré'];
          const idsNouveaux = Array.isArray(nouveauxMetre) ? nouveauxMetre : (nouveauxMetre ? [nouveauxMetre] : []);
          const nouveauOk = idsNouveaux.length > 0 && (await Promise.all(idsNouveaux.map(metreAppartientAuTenant))).every(Boolean);
          if (!nouveauOk) {
            return res.status(403).json({ error: 'Accès refusé : le métré cible ne correspond pas à votre tenant.' });
          }
        }
      } else if (req.method === 'POST') {
        // Création : le Métré cible fourni ("Métré": [recordId]) doit
        // appartenir au tenant de session — jamais de création orpheline
        // ni rattachée à un autre tenant.
        const champsOM = (req.body && req.body.fields) || {};
        const metreVoulu = champsOM['Métré'];
        const idsVoulu = Array.isArray(metreVoulu) ? metreVoulu : (metreVoulu ? [metreVoulu] : []);
        const ok = idsVoulu.length > 0 && (await Promise.all(idsVoulu.map(metreAppartientAuTenant))).every(Boolean);
        if (!ok) {
          return res.status(403).json({ error: 'Création refusée : le métré cible ne correspond pas à votre tenant.' });
        }
      } else if (req.method === 'GET') {
        // JALON 5bis — CORRECTIF (suite audit demandé) : le rate-limit seul
        // ne bloquait qu'un BALAYAGE massif (30 req/10min/IP) — il ne
        // protégeait pas un accès CIBLÉ unique (un seul appel avec un nom
        // de fiche Métré connu ou deviné suffisait à lire les ouvertures
        // d'un autre tenant). Un filtrage FIABLE reste impossible par
        // filterByFormula (2 sauts de lien Airtable, aucun champ lookup
        // dédié — modification de schéma non faite, non nécessaire ici),
        // mais un filtrage fiable EST possible par POST-FILTRAGE serveur :
        // on connaît déjà, via le correctif Métrés de ce même jalon, quels
        // recordId Métrés appartiennent réellement au tenant — on ne garde
        // ensuite que les ouvertures dont le Métré lié en fait partie.
        // Jamais de confiance dans le filterByFormula fourni par le
        // navigateur : il est relayé (nécessaire à la recherche elle-même)
        // mais son résultat est systématiquement revérifié ci-dessous.
        if (!verifierDebit(req, { max: 30, fenetreMs: 10 * 60 * 1000, cle: 'recherche-ouvertures-metre' })) {
          return res.status(429).json({ error: 'Trop de requêtes sur Ouvertures Métré. Réessayez dans quelques minutes.' });
        }

        let nomTenantOM;
        try {
          const rTenantOM = await fetch('https://api.airtable.com/v0/' + baseId + '/Clients/' + session.tenantId, { headers });
          if (!rTenantOM.ok) return res.status(403).json({ error: 'Accès refusé : tenant de session introuvable.' });
          const recTenantOM = await rTenantOM.json();
          nomTenantOM = (recTenantOM.fields || {})['Nom client'];
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en résolvant le tenant de session.', details: String(err) });
        }
        if (!nomTenantOM) return res.status(403).json({ error: 'Accès refusé : tenant de session incomplet.' });

        // Recordid Métrés appartenant réellement au tenant (même requête
        // que le correctif liste Métrés de ce jalon — cf. plus haut).
        let idsMetresDuTenant = [];
        try {
          const formuleMetresTenant = 'FIND("' + String(nomTenantOM).replace(/"/g, '\\"') + '", ARRAYJOIN({Compte client}))';
          const rMetresOM = await fetch('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent('Métrés') + '?filterByFormula=' + encodeURIComponent(formuleMetresTenant) + '&maxRecords=500', { headers });
          if (rMetresOM.ok) {
            const jsonMetresOM = await rMetresOM.json();
            idsMetresDuTenant = (jsonMetresOM.records || []).map(r => r.id);
          }
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en résolvant les métrés du tenant.', details: String(err) });
        }

        // Relaie la recherche du navigateur (filterByFormula par nom de
        // fiche, cf. metreur.html/technicien.html) telle quelle — étape
        // nécessaire à la recherche, jamais suffisante seule (voir
        // post-filtrage ci-dessous).
        const paramsOM = new URLSearchParams();
        for (const [key, value] of Object.entries(rest)) {
          if (Array.isArray(value)) value.forEach(v => paramsOM.append(key, v));
          else if (value !== undefined) paramsOM.append(key, value);
        }
        const qsOM = paramsOM.toString();
        let dataOM;
        try {
          const rOM = await fetch('https://api.airtable.com/v0/' + baseId + '/' + encodedSubPath + (qsOM ? '?' + qsOM : ''), { headers });
          dataOM = await rOM.json().catch(() => ({}));
          if (!rOM.ok) return res.status(rOM.status).json(dataOM);
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en contactant Airtable', details: String(err) });
        }

        // Post-filtrage — échec fermé : ne garde que les ouvertures dont
        // le Métré lié appartient réellement au tenant. C'est la SEULE
        // étape qui empêche une lecture ciblée inter-tenant (le
        // filterByFormula seul ne le fait pas, cf. plus haut).
        const ensembleMetresTenant = new Set(idsMetresDuTenant);
        const enregistrementsFiltresOM = (dataOM.records || []).filter(rec => {
          const metreLies = (rec.fields || {})['Métré'];
          const idsMetreRec = Array.isArray(metreLies) ? metreLies : (metreLies ? [metreLies] : []);
          return idsMetreRec.some(id => ensembleMetresTenant.has(id));
        });
        return res.status(200).json(Object.assign({}, dataOM, { records: enregistrementsFiltresOM }));
      } else {
        return res.status(400).json({ error: 'Requête invalide pour cette table.' });
      }
    }
  }

  // AUTH #006 — Chantier Multi-Tenant #1 (Option B) : isolation serveur de
  // "Tickets SAV" par ROUTE DÉDIÉE, jamais par un signal client.
  //
  // Historique : une première tentative (AUTH #005) reposait sur un
  // en-tête "X-Iko-Contexte: interne" envoyé par le wrapper fetch des
  // pages internes. Faille démontrée : un utilisateur authentifié pouvait
  // appeler le proxy directement (curl, devtools) avec son cookie de
  // session réel, en omettant simplement cet en-tête, désactivant
  // intégralement le contrôle. Un en-tête est une CONVENTION cliente, pas
  // une garantie serveur — corrigé ici en supprimant toute dépendance à un
  // signal fourni par le navigateur.
  //
  // Solution retenue : deux routes strictement séparées au niveau du
  // ROUTAGE SERVEUR lui-même (jamais un flag optionnel) :
  //   - /api/airtable/Tickets SAV (historique, publique) : AUCUN contrôle
  //     tenant, comportement strictement inchangé, quelle que soit la
  //     présence d'une session (cf. usage par avis.html, devis.html,
  //     suivi.html — accès par numéro/token, pas par tenant).
  //   - /api/airtable/tenant/Tickets SAV (nouvelle, réservée aux pages
  //     internes authentifiées) : session OBLIGATOIRE (401 sinon), tenant
  //     TOUJOURS résolu depuis session.tenantId (JWT vérifié serveur),
  //     jamais depuis une valeur fournie par le client. Un appel direct
  //     (curl/devtools) avec un cookie de session réel subit exactement le
  //     même contrôle que l'interface officielle : la route elle-même
  //     l'impose, il n'existe plus aucun signal à omettre pour le
  //     contourner.
  if (routeTenantTickets) {
    if (!session) {
      return res.status(401).json({ error: 'Authentification requise pour cette route.' });
    }
    if (session.role !== 'SUPER_ADMIN_IKO') {
      const segmentsTickets = subPathRaw.split('/').filter(Boolean);
      const recordIdTicket = segmentsTickets[1];

      if (recordIdTicket) {
        // Accès à un ticket précis (GET/PATCH/DELETE) : on relit le ticket
        // pour vérifier sa propriété réelle AVANT l'opération demandée —
        // jamais de confiance dans un filtre fourni par le navigateur.
        let recTicketCheck;
        try {
          const rTicket = await fetch('https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(premierSegment) + '/' + recordIdTicket, { headers });
          if (!rTicket.ok) {
            const errData = await rTicket.json().catch(() => ({}));
            return res.status(rTicket.status).json(errData);
          }
          recTicketCheck = await rTicket.json();
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en vérifiant la propriété tenant de ce ticket.', details: String(err) });
        }
        const valeurCompteClient = (recTicketCheck.fields || {})['Compte client'];
        const idsLiesTicket = Array.isArray(valeurCompteClient) ? valeurCompteClient : (valeurCompteClient ? [valeurCompteClient] : []);
        if (!session.tenantId || !idsLiesTicket.includes(session.tenantId)) {
          return res.status(403).json({ error: "Accès refusé : ce ticket n'appartient pas à votre tenant." });
        }
      } else if (req.method === 'GET') {
        // Liste/recherche interne : injecte un filtre tenant obligatoire,
        // en PLUS (jamais à la place) du filtre déjà fourni par le
        // navigateur (cf. filtreAvecClient() côté client, conservée comme
        // optimisation de volume — le serveur reste seul juge). "Compte
        // client" est un lien Airtable brut (pas de "Client Record ID"
        // dédié sur cette table) : ARRAYJOIN() renvoie le NOM du client,
        // pas son recordId (piège déjà documenté sur ce projet) — le nom
        // du tenant est donc résolu depuis la session vérifiée serveur,
        // jamais depuis une valeur fournie par le navigateur.
        if (!session.tenantId) {
          return res.status(403).json({ error: 'Accès refusé : session sans tenant valide.' });
        }
        let nomTenant;
        try {
          const rTenant = await fetch('https://api.airtable.com/v0/' + baseId + '/Clients/' + session.tenantId, { headers });
          if (!rTenant.ok) return res.status(403).json({ error: 'Accès refusé : tenant de session introuvable.' });
          const recTenant = await rTenant.json();
          nomTenant = (recTenant.fields || {})['Nom client'];
        } catch (err) {
          return res.status(502).json({ error: 'Erreur en résolvant le tenant de session.', details: String(err) });
        }
        if (!nomTenant) return res.status(403).json({ error: 'Accès refusé : tenant de session incomplet.' });
        const formuleTenantTicket = 'FIND("' + String(nomTenant).replace(/"/g, '\\"') + '", ARRAYJOIN({Compte client}))';
        rest.filterByFormula = rest.filterByFormula ? 'AND(' + rest.filterByFormula + ', ' + formuleTenantTicket + ')' : formuleTenantTicket;
      } else {
        // PATCH/DELETE/POST sans recordId sur cette route : aucun usage
        // légitime connu (pas de création de "Tickets SAV" via ce proxy à
        // ce jour, vérifié) — refusé par prudence, pas de règle inventée.
        return res.status(400).json({ error: 'Requête invalide pour cette route.' });
      }
    }
    // SUPER_ADMIN_IKO : accès global conservé, aucune restriction supplémentaire.
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
    // Enrichissement serveur (AUTH #008 suite) : pour une LISTE
    // d'Interventions SAV, on resout le nom affichable ("Identifiant") de
    // chaque technicien lie, uniquement pour cette reponse JSON (jamais
    // ecrit dans Airtable, jamais expose comme un champ "Nom technicien"
    // duplique - decision deja prise de ne pas creer ce champ). Ceci ne
    // rouvre PAS l'acces a la table Utilisateurs pour le client : c'est
    // un appel serveur-a-serveur, cible sur des IDs deja connus et
    // deja verifies appartenir au tenant de la session (records
    // Interventions SAV filtres tenant juste au-dessus). Plafonne a 20
    // techniciens distincts par reponse (largement suffisant pour une
    // page d'analytics, evite tout risque de derive de quota).
    if (
      premierSegment === 'Interventions SAV' &&
      req.method === 'GET' &&
      Array.isArray(data.records)
    ) {
      const idsTechniciens = Array.from(new Set(
        data.records
          .map(r => Array.isArray(r.fields?.['Technicien']) ? r.fields['Technicien'][0] : null)
          .filter(Boolean)
      )).slice(0, 20);
      if (idsTechniciens.length) {
        const nomsParId = {};
        await Promise.all(idsTechniciens.map(async (idTech) => {
          try {
            const rTech = await fetch('https://api.airtable.com/v0/' + baseId + '/Utilisateurs/' + idTech, { headers });
            if (!rTech.ok) return;
            const recTech = await rTech.json();
            nomsParId[idTech] = (recTech.fields || {})['Identifiant'] || null;
          } catch (e) { /* silencieux : enrichissement best-effort, jamais bloquant */ }
        }));
        data.records.forEach(r => {
          const idTech = Array.isArray(r.fields?.['Technicien']) ? r.fields['Technicien'][0] : null;
          if (idTech && nomsParId[idTech]) {
            r.fields['_technicienIdentifiant'] = nomsParId[idTech];
          }
        });
      }
    }
    res.status(airtableRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Erreur en contactant Airtable', details: String(err) });
  }
}
