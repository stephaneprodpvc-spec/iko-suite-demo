// Webhook Stripe : confirme un paiement de devis (signature vérifiée sur le corps BRUT).
// Variables : STRIPE_WEBHOOK_SECRET (whsec_…), AIRTABLE_TOKEN. Événement traité : checkout.session.completed.
import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

async function corpsBrut(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function signatureValide(brut, enTete, secret) {
  if (!enTete || !secret) return false;
  const parts = Object.fromEntries(enTete.split(',').map(x => x.split('=')).filter(x => x.length === 2));
  const t = parts.t; const v1 = enTete.split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // rejoue d'un ancien événement
  const attendu = crypto.createHmac('sha256', secret).update(t + '.' + brut.toString('utf8')).digest('hex');
  return v1.some(s => s.length === attendu.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(attendu)));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook Stripe non configuré.' });
  const brut = await corpsBrut(req);
  if (!signatureValide(brut, req.headers['stripe-signature'], secret)) return res.status(400).json({ error: 'Signature invalide.' });
  let evt;
  try { evt = JSON.parse(brut.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'Corps illisible.' }); }
  if (evt.type !== 'checkout.session.completed') return res.status(200).json({ ignore: true });
  const s = evt.data && evt.data.object || {};
  if (s.payment_status !== 'paid') return res.status(200).json({ ignore: true });
  const devisId = s.metadata && s.metadata.devisId;
  const type = s.metadata && s.metadata.type;
  if (!/^rec[A-Za-z0-9]{14}$/.test(devisId || '')) return res.status(200).json({ ignore: true });
  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
  const headers = { Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' };
  try {
    await fetch('https://api.airtable.com/v0/' + baseId + '/Devis/' + devisId, {
      method: 'PATCH', headers,
      body: JSON.stringify({ fields: {
        'Statut paiement': type === 'solde' ? 'Payé' : 'Acompte reçu',
        'Date paiement': new Date().toISOString().slice(0, 10),
        'Mode règlement': 'Carte bancaire',
      } }),
    });
  } catch (e) { console.error('Mise à jour paiement Airtable', e); return res.status(500).json({ error: 'Erreur Airtable.' }); }
  return res.status(200).json({ ok: true });
}
