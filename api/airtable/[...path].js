// DEPRECIE - ne plus modifier ce fichier.
// La route reelle utilisee en production est desormais api/airtable-proxy.js,
// atteinte via la reecriture definie dans vercel.json
// ("/api/airtable/:path*" -> "/api/airtable-proxy?path=:path*").
// Raison : ce fichier catch-all ([...path].js) ne route fiablement que le
// premier segment de chemin sur un deploiement Vercel sans Next.js ; tout
// segment supplementaire (ex: /api/airtable/Tickets%20SAV/recXXXX) renvoyait
// une 404, ce qui cassait silencieusement les mises a jour (PATCH) de
// tickets. Conserve ici uniquement en filet de securite si jamais la
// reecriture ne s'applique pas ; le code est identique a airtable-proxy.js.
export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const appSecret = process.env.APP_PROXY_SECRET;

  if (!token) {
    return res.status(500).json({
      error: 'AIRTABLE_TOKEN manquant. Ajoute-le dans Vercel > Project Settings > Environment Variables.'
    });
  }

  // Meme verification que api/airtable-proxy.js (voir ce fichier pour le detail).
  if (appSecret) {
    const provided = req.headers['x-app-secret'];
    if (provided !== appSecret) {
      return res.status(401).json({ error: 'Non autorise.' });
    }
  }

  const suffix = req.url.replace(/^\/api\/airtable\//, '');
  const airtableUrl = 'https://api.airtable.com/v0/appkI8RKHkYNWY86U/' + suffix;

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
