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
  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U'; // base démo Iko Suite
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
