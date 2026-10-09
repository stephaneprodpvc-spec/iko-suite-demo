// Paiement en ligne d'un devis signé (Stripe Checkout).
//
// Principes de sécurité :
//  - le MONTANT n'est jamais fourni par le navigateur : il est recalculé ici depuis l'enregistrement
//    Devis d'Airtable (Montant TTC), uniquement pour un devis au statut "Validé" ;
//  - un seul paramètre vient du client : l'identifiant du devis (+ "acompte" ou "solde") ;
//  - sans STRIPE_SECRET_KEY le service répond 503 { configure:false } : les pages masquent alors le bouton ;
//  - la confirmation du paiement n'est PAS prise sur la page de retour (falsifiable) mais uniquement via
//    le webhook signé (api/stripe-webhook.js).
import { verifierOrigine, verifierDebit, reponseBloquee } from './_securite.js';

const POURCENT_ACOMPTE = 30; // acompte par défaut (cohérent avec les conditions « Acompte de 30 % » proposées)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return res.status(503).json({ configure: false, error: 'Paiement en ligne non configuré.' });
  if (!verifierOrigine(req, { strict: true })) return reponseBloquee(res, 'origine');
  if (!verifierDebit(req, { max: 10, cle: 'paiement' })) return reponseBloquee(res, 'debit');

  const { devisId, type } = req.body || {};
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
