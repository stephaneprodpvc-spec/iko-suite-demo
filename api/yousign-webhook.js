// Webhook Yousign : reçoit la confirmation de signature d'un devis et met
// à jour le ticket correspondant dans Airtable ("Devis Signé" = true).
//
// Sécurité : chaque requête est vérifiée via la signature HMAC SHA-256
// fournie par Yousign dans l'en-tête X-Yousign-Signature-256, calculée sur
// le corps BRUT de la requête (d'où bodyParser désactivé ci-dessous). Le
// secret utilisé est celui de l'abonnement webhook créé dans le tableau de
// bord Yousign (Developers > Webhooks), stocké dans la variable
// d'environnement YOUSIGN_WEBHOOK_SECRET — jamais en dur dans le code.
//
// Événement traité : "signature_request.done" (toutes les signatures
// requises ont été apposées). Les autres événements sont accusés
// (HTTP 200) mais ignorés, pour éviter que Yousign ne les retente en boucle.

import crypto from 'crypto';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.YOUSIGN_WEBHOOK_SECRET;
  const airtableToken = process.env.AIRTABLE_TOKEN;

  if (!secret || !airtableToken) {
    console.error('YOUSIGN_WEBHOOK_SECRET ou AIRTABLE_TOKEN manquant.');
    return res.status(500).json({ error: 'Configuration serveur incomplète.' });
  }

  const rawBody = await readRawBody(req);
  const signatureHeader = req.headers['x-yousign-signature-256'] || '';
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const computedSignature = 'sha256=' + digest;

  const sigBuf = Buffer.from(signatureHeader);
  const compBuf = Buffer.from(computedSignature);
  const isValid = sigBuf.length === compBuf.length && crypto.timingSafeEqual(sigBuf, compBuf);

  if (!isValid) {
    console.error('Signature Yousign invalide — requête rejetée.');
    return res.status(401).json({ error: 'Signature invalide' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf-8'));
  } catch (e) {
    return res.status(400).json({ error: 'JSON invalide' });
  }

  // On acquitte tout de suite les événements qui ne nous intéressent pas,
  // Yousign attend un 2xx sous 1s sinon il retente l'envoi.
  if (payload.event_name !== 'signature_request.done') {
    return res.status(200).json({ ok: true, ignored: payload.event_name });
  }

  try {
    const signatureRequestId = payload.data?.signature_request?.id;
    if (!signatureRequestId) {
      return res.status(200).json({ ok: true, note: 'Pas de signature_request.id dans le payload' });
    }

    const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U'; // base démo Iko Suite
    const filter = encodeURIComponent('{Yousign Request ID}="' + signatureRequestId + '"');
    const headers = { Authorization: 'Bearer ' + airtableToken };

    // Nouveau flux itemisé (table Devis, catalogue + mise en page) : on
    // cherche en priorité ici. Ancien flux (montant libre sur le ticket)
    // conservé en repli pour ne pas casser des liens déjà envoyés.
    const devisSearchUrl = 'https://api.airtable.com/v0/' + baseId + '/Devis?filterByFormula=' + filter + '&maxRecords=1';
    const devisSearchRes = await fetch(devisSearchUrl, { headers });
    const devisSearchJson = await devisSearchRes.json();
    const devisRecord = devisSearchJson.records?.[0];

    if (devisRecord) {
      await fetch('https://api.airtable.com/v0/' + baseId + '/Devis/' + devisRecord.id, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { "Statut": "Validé", "Date validation client": new Date().toISOString() } })
      });

      // Planifie automatiquement le prochain créneau libre de l'agence
      // concernée (même logique que l'ancien parcours devis.html côté
      // client), pour que la date d'intervention soit retournée sans
      // intervention manuelle de l'agence.
      try {
        const ticketId = devisRecord.fields?.["Ticket lié"]?.[0];
        if (ticketId) {
          const ticketRes = await fetch('https://api.airtable.com/v0/' + baseId + '/Tickets%20SAV/' + ticketId, { headers });
          const ticketJson = await ticketRes.json();
          const agence = ticketJson.fields?.Agence;
          if (agence) {
            const planFilter = encodeURIComponent('AND({Agence}="' + agence + '",{Statut}="Libre")');
            const planUrl = 'https://api.airtable.com/v0/' + baseId + '/Planning?filterByFormula=' + planFilter + '&sort[0][field]=Date&sort[0][direction]=asc&maxRecords=1';
            const planRes = await fetch(planUrl, { headers });
            const planJson = await planRes.json();
            const slot = planJson.records?.[0];
            if (slot) {
              const dateObj = new Date((slot.fields.Date || '') + 'T12:00:00');
              const dateLabel = isNaN(dateObj) ? slot.fields.Date : dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
              const creneauLabel = (slot.fields.Créneau || '') + ' — ' + dateLabel;

              await fetch('https://api.airtable.com/v0/' + baseId + '/Planning/' + slot.id, {
                method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { Statut: 'Pris' } })
              });
              await fetch('https://api.airtable.com/v0/' + baseId + '/Devis/' + devisRecord.id, {
                method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { "Date intervention proposée": slot.fields.Date } })
              });
              await fetch('https://api.airtable.com/v0/' + baseId + '/Tickets%20SAV/' + ticketId, {
                method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { Statut: 'Nouveau', "Créneau": creneauLabel, PlanningID: slot.id } })
              });
            } else {
              console.error('Aucun créneau Planning libre pour l\'agence', agence, '- date intervention non planifiée automatiquement.');
            }
          }
        }
      } catch (planErr) {
        // Non bloquant : le devis reste validé même si la planification
        // automatique échoue ; l'agence peut planifier manuellement.
        console.error('Erreur planification automatique après signature', planErr);
      }

      return res.status(200).json({ ok: true, table: 'Devis' });
    }

    const searchUrl = 'https://api.airtable.com/v0/' + baseId + '/Tickets%20SAV?filterByFormula=' + filter + '&maxRecords=1';
    const searchRes = await fetch(searchUrl, { headers });
    const searchJson = await searchRes.json();
    const record = searchJson.records?.[0];

    if (!record) {
      console.error('Aucun ticket ni devis trouvé pour Yousign Request ID', signatureRequestId);
      return res.status(200).json({ ok: true, note: 'Introuvable (Devis et Tickets SAV)' });
    }

    await fetch('https://api.airtable.com/v0/' + baseId + '/Tickets%20SAV/' + record.id, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { "Devis Signé": true } })
    });

    return res.status(200).json({ ok: true, table: 'Tickets SAV' });
  } catch (err) {
    console.error('Erreur traitement webhook Yousign', err);
    // On répond quand même 200 pour éviter des retries infinis sur une
    // erreur qui ne se résoudra pas toute seule ; l'erreur est loguée.
    return res.status(200).json({ ok: false, error: String(err) });
  }
}
