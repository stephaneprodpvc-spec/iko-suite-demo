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

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
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
    const rawBody = await readRawBody(req);
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
