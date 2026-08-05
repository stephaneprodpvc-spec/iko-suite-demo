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

  const { path, ...rest } = req.query || {};
  const subPathRaw = Array.isArray(path) ? path.join('/') : (path || '');
  // req.query est déjà décodé par Vercel/Node : on ré-encode proprement
  // chaque segment (utile notamment pour "Tickets SAV" -> "Tickets%20SAV").
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
  const airtableUrl = 'https://api.airtable.com/v0/app1AcRl9r6vB7W6e/' + encodedSubPath + (qs ? '?' + qs : '');

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
