// Proxy générique vers l'API Yousign (signature électronique des devis).
//
// Même principe que api/airtable-proxy.js : la clé API (YOUSIGN_API_KEY)
// reste uniquement côté serveur, jamais exposée dans le code client.
// Route fixe + sous-chemin Yousign porté par le paramètre de requête "path"
// via la règle de réécriture dans vercel.json
// (/api/yousign/:path* -> /api/yousign-proxy?path=:path*).
//
// Particularité par rapport au proxy Airtable : certains appels Yousign
// (upload de document) utilisent multipart/form-data et non du JSON. Pour
// ces requêtes, Vercel ne doit pas parser le corps automatiquement — on le
// désactive via `config.api.bodyParser = false` et on relaie le corps brut
// tel quel, avec son Content-Type d'origine (qui contient la boundary
// multipart).
//
// Environnement : YOUSIGN_ENV=production bascule vers l'API de production
// (api.yousign.app). Par défaut (ou YOUSIGN_ENV=sandbox), on utilise
// l'environnement sandbox (api-sandbox.yousign.app), gratuit et illimité
// pour les tests.

import { verifierSession, verifierOrigine, verifierDebit } from './_securite.js';

// ETAPE 2 SECURITE : ce relais utilisait la cle Yousign du serveur sans AUCUN
// controle (ni session, ni origine, ni liste de chemins). Desormais :
//  - liste blanche stricte des chemins + methodes reellement utilises ;
//  - creation / envoi de signature : session obligatoire (admin du client,
//    technicien ou super admin) ;
//  - lecture du lien de signature d'un signataire (devis.html, client sans
//    compte) : autorisee si le couple (demande, signataire) correspond a un
//    devis existant dans Airtable (jeton de devis : ids Yousign inconnus de
//    tout tiers) ;
//  - origine du site + limite de debit.
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
const ID_YOUSIGN = '[A-Za-z0-9_-]{8,64}';
const CHEMINS_ECRITURE = [
  ['POST', new RegExp('^signature_requests$')],
  ['POST', new RegExp('^signature_requests/' + ID_YOUSIGN + '/documents$')],
  ['POST', new RegExp('^signature_requests/' + ID_YOUSIGN + '/signers$')],
  ['POST', new RegExp('^signature_requests/' + ID_YOUSIGN + '/activate$')],
];
const CHEMIN_LECTURE_SIGNATAIRE = new RegExp('^signature_requests/(' + ID_YOUSIGN + ')/signers/(' + ID_YOUSIGN + ')$');
const ROLES_AUTORISES_ECRITURE = ['SUPER_ADMIN_IKO', 'TENANT_ADMIN', 'TECHNICIEN'];
const TAILLE_MAX_CORPS = 12 * 1024 * 1024; // 12 Mo (PDF de devis)

async function devisCorrespond(requestId, signerId) {
  const jeton = process.env.AIRTABLE_TOKEN;
  if (!jeton) return false;
  const formule = 'AND({Yousign Request ID}="' + requestId + '",{Yousign Signer ID}="' + signerId + '")';
  try {
    const r = await fetch('https://api.airtable.com/v0/' + AIRTABLE_BASE_ID + '/Devis?filterByFormula=' + encodeURIComponent(formule) + '&maxRecords=1&fields%5B%5D=N%C2%B0%20devis', {
      headers: { Authorization: 'Bearer ' + jeton },
    });
    if (!r.ok) return false;
    const j = await r.json();
    return Array.isArray(j.records) && j.records.length > 0;
  } catch (e) {
    return false;
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > TAILLE_MAX_CORPS) throw new Error('corps trop volumineux');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const token = process.env.YOUSIGN_API_KEY;

  if (!token) {
    return res.status(500).json({
      error: 'YOUSIGN_API_KEY manquant. Ajoute-le dans Vercel > Project Settings > Environment Variables.'
    });
  }

  if (!verifierOrigine(req)) {
    return res.status(403).json({ error: 'Origine non autorisée.' });
  }
  if (!verifierDebit(req, { max: 30, fenetreMs: 60 * 1000, cle: 'yousign' })) {
    return res.status(429).json({ error: 'Trop de requêtes, réessayez dans une minute.' });
  }

  // Controle d'acces par liste blanche (chemin + methode), avant tout appel Yousign.
  const cheminDemande = (() => {
    const p = (req.query || {}).path;
    return (Array.isArray(p) ? p.join('/') : (p || '')).replace(/^\/+|\/+$/g, '');
  })();
  const session = verifierSession(req);
  const ecritureAutorisee = CHEMINS_ECRITURE.some(([m, re]) => m === req.method && re.test(cheminDemande));
  const lecture = req.method === 'GET' ? cheminDemande.match(CHEMIN_LECTURE_SIGNATAIRE) : null;
  if (ecritureAutorisee) {
    if (!session) return res.status(401).json({ error: 'Authentification requise.' });
    if (session.mdpAChanger || !ROLES_AUTORISES_ECRITURE.includes(session.role)) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }
  } else if (lecture) {
    const sessionValide = session && !session.mdpAChanger && ROLES_AUTORISES_ECRITURE.includes(session.role);
    if (!sessionValide && !(await devisCorrespond(lecture[1], lecture[2]))) {
      return res.status(403).json({ error: 'Accès refusé.' });
    }
  } else {
    return res.status(404).json({ error: 'Route non autorisée.' });
  }

  const base = process.env.YOUSIGN_ENV === 'production'
    ? 'https://api.yousign.app/v3'
    : 'https://api-sandbox.yousign.app/v3';

  const { path, ...rest } = req.query || {};
  const subPathRaw = Array.isArray(path) ? path.join('/') : (path || '');
  const encodedSubPath = subPathRaw.split('/').filter(Boolean).map(encodeURIComponent).join('/');

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, v));
    } else if (value !== undefined) {
      params.append(key, value);
    }
  }
  const qs = params.toString();
  const yousignUrl = base + '/' + encodedSubPath + (qs ? '?' + qs : '');

  const incomingContentType = req.headers['content-type'] || '';
  const init = {
    method: req.method,
    headers: {
      Authorization: 'Bearer ' + token,
    },
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let rawBody;
    try {
      rawBody = await readRawBody(req);
    } catch (e) {
      return res.status(413).json({ error: 'Corps de requête trop volumineux.' });
    }
    init.body = rawBody;
    // On relaie le Content-Type d'origine tel quel (important pour le
    // multipart/form-data : la boundary doit rester identique à celle du
    // corps déjà encodé par le client).
    init.headers['Content-Type'] = incomingContentType || 'application/json';
  }

  try {
    const yousignRes = await fetch(yousignUrl, init);
    const text = await yousignRes.text();
    const contentType = yousignRes.headers.get('content-type') || '';
    res.status(yousignRes.status);
    if (contentType.includes('application/json')) {
      res.setHeader('Content-Type', 'application/json');
      res.send(text);
    } else {
      res.send(text);
    }
  } catch (err) {
    res.status(502).json({ error: 'Erreur en contactant Yousign', details: String(err) });
  }
}
