// Services « paiement en ligne » (Stripe) et « sauvegarde » : fichier utilitaire, PAS une fonction serverless
// (Vercel Hobby plafonne à 12 fonctions). Ils sont appelés via api/yousign-webhook.js (réécritures de vercel.json).
import crypto from 'crypto';
import { verifierOrigine, verifierDebit, verifierSession, reponseBloquee } from './_securite.js';

// ======================= Paiement d'un devis signé (Stripe Checkout) =======================
// Le MONTANT n'est jamais fourni par le navigateur : recalculé depuis le devis Airtable (statut « Validé »).
// Sans STRIPE_SECRET_KEY → 503 { configure:false }. La confirmation du paiement vient UNIQUEMENT du webhook signé.
const POURCENT_ACOMPTE = 30; // acompte par défaut (cohérent avec les conditions « Acompte de 30 % » proposées)

export async function handlePaiement(req, res, corps) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return res.status(503).json({ configure: false, error: 'Paiement en ligne non configuré.' });
  if (!verifierOrigine(req, { strict: true })) return reponseBloquee(res, 'origine');
  if (!verifierDebit(req, { max: 10, cle: 'paiement' })) return reponseBloquee(res, 'debit');

  const { devisId, type } = corps || {};
  if (typeof devisId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(devisId)) return res.status(400).json({ error: 'Devis invalide.' });
  const typePaiement = type === 'solde' ? 'solde' : 'acompte';

  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
  const headers = { Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN };
  let devis;
  try {
    const r = await fetch('https://api.airtable.com/v0/' + baseId + '/Devis/' + devisId, { headers });
    if (!r.ok) return res.status(404).json({ error: 'Devis introuvable.' });
    devis = await r.json();
  } catch (e) { return res.status(502).json({ error: 'Erreur de lecture du devis.' }); }
  const f = devis.fields || {};
  if (f['Statut'] !== 'Validé') return res.status(409).json({ error: "Le devis doit d'abord être signé." });
  if (f['Statut paiement'] === 'Payé') return res.status(409).json({ error: 'Ce devis est déjà réglé.' });
  const ttc = Number(f['Montant TTC']);
  if (!(ttc > 0)) return res.status(422).json({ error: 'Montant du devis invalide.' });

  const dejaAcompte = f['Statut paiement'] === 'Acompte reçu';
  if (typePaiement === 'acompte' && dejaAcompte) return res.status(409).json({ error: "L'acompte est déjà réglé." });
  const acompteCents = Math.round(ttc * POURCENT_ACOMPTE); // = ttc × 30 % × 100 centimes
  const totalCents = Math.round(ttc * 100);
  const montantCents = typePaiement === 'acompte' ? acompteCents : (dejaAcompte ? totalCents - acompteCents : totalCents);
  if (montantCents < 50) return res.status(422).json({ error: 'Montant trop faible.' });

  const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', origin + '/devis.html?devisId=' + devisId + '&paiement=ok');
  p.set('cancel_url', origin + '/devis.html?devisId=' + devisId + '&paiement=annule');
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'eur');
  p.set('line_items[0][price_data][unit_amount]', String(montantCents));
  p.set('line_items[0][price_data][product_data][name]', (typePaiement === 'acompte' ? 'Acompte ' + POURCENT_ACOMPTE + ' % — ' : 'Solde — ') + 'devis ' + (f['N° devis'] || devisId));
  p.set('client_reference_id', devisId);
  p.set('metadata[devisId]', devisId);
  p.set('metadata[type]', typePaiement);
  p.set('payment_intent_data[metadata][devisId]', devisId);
  p.set('payment_intent_data[metadata][type]', typePaiement);
  try {
    const s = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cle, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: p.toString(),
    });
    const j = await s.json();
    if (!s.ok || !j.url) { console.error('Stripe checkout erreur', s.status, j && j.error && j.error.message); return res.status(502).json({ error: 'Le paiement n\'a pas pu être initialisé.' }); }
    return res.status(200).json({ url: j.url, montant: montantCents / 100, type: typePaiement });
  } catch (e) {
    console.error('Stripe injoignable', e);
    return res.status(502).json({ error: 'Service de paiement indisponible.' });
  }
}


// ======================= Webhook Stripe (signature vérifiée sur le corps brut) =======================
function signatureValide(brut, enTete, secret) {
  if (!enTete || !secret) return false;
  const parts = Object.fromEntries(enTete.split(',').map(x => x.split('=')).filter(x => x.length === 2));
  const t = parts.t; const v1 = enTete.split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  if (!t || !v1.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // rejoue d'un ancien événement
  const attendu = crypto.createHmac('sha256', secret).update(t + '.' + brut.toString('utf8')).digest('hex');
  return v1.some(s => s.length === attendu.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(attendu)));
}

export async function handleStripe(req, res, brut) {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook Stripe non configuré.' });
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


// ======================= Sauvegarde / export (super-admin) =======================
const TABLES = ['Clients', 'Agences', 'Tickets SAV', 'Interventions SAV', 'Devis', 'Catalogue Produits', "Grille Main d'œuvre",
  'Mise en page Devis', 'Métrés', 'Ouvertures Métré', 'Questionnaire SAV', 'RDV Commercial', 'Planning Commercial', 'Contrôles Chantier', 'Journal actions'];

export async function handleSauvegarde(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée.' });
  if (!verifierOrigine(req, { strict: true })) return reponseBloquee(res, 'origine');
  const session = verifierSession(req);
  if (!session || session.role !== 'SUPER_ADMIN_IKO') return res.status(403).json({ error: 'Réservé au super-administrateur.' });
  if (req.query.liste !== undefined) return res.status(200).json({ tables: TABLES });
  const table = req.query.table;
  if (!TABLES.includes(table)) return res.status(400).json({ error: 'Table inconnue.' });
  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
  const headers = { Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN };
  const records = [];
  let offset = typeof req.query.offset === 'string' ? req.query.offset : '';
  const debut = Date.now();
  try {
    do {
      const url = 'https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(table) + '?pageSize=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '');
      const r = await fetch(url, { headers });
      if (!r.ok) return res.status(r.status).json({ error: 'Lecture impossible : ' + table });
      const j = await r.json();
      (j.records || []).forEach(x => records.push({ id: x.id, createdTime: x.createdTime, fields: x.fields }));
      offset = j.offset || '';
      if (offset && Date.now() - debut > 6500) break; // reprise au prochain appel (limite de durée Vercel)
    } while (offset);
  } catch (e) { return res.status(502).json({ error: 'Erreur en contactant Airtable.' }); }
  return res.status(200).json({ table, records, offset });
}
