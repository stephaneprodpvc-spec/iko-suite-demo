// Notifications push technicien.
//
// Pas de nouvelle table Airtable : les abonnements (un par appareil/agence)
// sont stockés dans le champ "Config JSON" déjà existant sur le record
// sentinelle Planning (CONFIG_RECORD_ID), sous une nouvelle clé
// "pushSubscriptions" — lecture/fusion/écriture à chaque appel, sans
// toucher aux autres clés déjà présentes (couleurAccent, logoUrl, etc.).
//
// GET  -> renvoie la clé publique VAPID (le client en a besoin pour
//         pushManager.subscribe).
// POST { subscribe: true, agence, subscription } -> enregistre/actualise
//         l'abonnement de cet appareil pour cette agence.
// POST { action: 'send', agence, title, body, url } -> envoie une
//         notification à tous les appareils abonnés de l'agence.

import webpush from 'web-push';

const CONFIG_RECORD_ID = 'rec45X231n9dXnyaU';

async function lireConfig(baseId, headers) {
  const res = await fetch('https://api.airtable.com/v0/' + baseId + '/Planning/' + CONFIG_RECORD_ID, { headers });
  const json = await res.json();
  let config = {};
  try { config = JSON.parse(json.fields?.['Config JSON'] || '{}'); } catch (e) { config = {}; }
  if (!Array.isArray(config.pushSubscriptions)) config.pushSubscriptions = [];
  return config;
}

async function ecrireConfig(baseId, headers, config) {
  await fetch('https://api.airtable.com/v0/' + baseId + '/Planning/' + CONFIG_RECORD_ID, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { 'Config JSON': JSON.stringify(config) } }),
  });
}

export default async function handler(req, res) {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const airtableToken = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';

  if (req.method === 'GET') {
    if (!vapidPublic) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY manquante.' });
    return res.status(200).json({ publicKey: vapidPublic });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!vapidPublic || !vapidPrivate || !airtableToken) {
    return res.status(500).json({ error: 'Configuration serveur incomplète (VAPID ou AIRTABLE_TOKEN).' });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:stephane.prodpvc@gmail.com',
    vapidPublic,
    vapidPrivate
  );

  const headers = { Authorization: 'Bearer ' + airtableToken };
  const body = req.body || {};

  try {
    if (body.subscribe && body.subscription && body.agence) {
      const config = await lireConfig(baseId, headers);
      const endpoint = body.subscription.endpoint;
      config.pushSubscriptions = config.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
      config.pushSubscriptions.push({ agence: body.agence, endpoint, keys: body.subscription.keys });
      await ecrireConfig(baseId, headers, config);
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'send' && body.agence) {
      const config = await lireConfig(baseId, headers);
      const cibles = config.pushSubscriptions.filter((s) => s.agence === body.agence);
      const payload = JSON.stringify({
        title: body.title || 'Iko Suite',
        body: body.body || '',
        url: body.url || '/technicien.html',
      });
      const morts = [];
      await Promise.all(cibles.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
        } catch (err) {
          // 404/410 = abonnement expiré côté navigateur, à retirer.
          if (err.statusCode === 404 || err.statusCode === 410) morts.push(s.endpoint);
        }
      }));
      if (morts.length) {
        config.pushSubscriptions = config.pushSubscriptions.filter((s) => !morts.includes(s.endpoint));
        await ecrireConfig(baseId, headers, config);
      }
      return res.status(200).json({ ok: true, envoyes: cibles.length - morts.length });
    }

    return res.status(400).json({ error: 'Requête invalide (subscribe+subscription+agence, ou action=send+agence attendus).' });
  } catch (err) {
    return res.status(502).json({ error: 'Erreur push', details: String(err) });
  }
}
