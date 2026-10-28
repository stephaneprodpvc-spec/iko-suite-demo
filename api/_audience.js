// api/_audience.js — Audience du site vitrine IKO SYSTÈMES : comptage ANONYME des visites.
// Appelé via api/yousign-webhook.js (?service=audience, réécriture /api/audience) : Vercel Hobby plafonne à 12 fonctions.
//
// Respect de la vie privée : aucun cookie, aucun identifiant de visiteur, aucune adresse IP conservée, aucune donnée personnelle.
// On ne stocke que des COMPTEURS par jour : { evenement: { ordinateur: n, mobile: n } } (une ligne par jour dans la table Airtable « Audience »,
// champs « Jour » (texte AAAA-MM-JJ) et « Donnees » (texte long, JSON)). Le navigateur qui demande « ne pas me suivre » n'envoie rien (côté site).
//
//  - POST (public, depuis le site vitrine) : { e: "visite", a: "mobile" | "ordinateur" }  -> +1 sur le compteur du jour.
//  - GET  (super-administrateur, depuis le Poste de pilotage) : renvoie les compteurs des N derniers jours.
import { verifierOrigine, verifierDebit, verifierSession } from './_securite.js';

const TABLE = 'Audience';
export const EVENEMENTS = [
  'visite', 'film_interaction', 'film_fini', 'orbite_vue', 'orbite_utilisee', 'assistant_ecoute', 'demos_vue',
  'onglet_direct', 'onglet_amandine', 'onglet_parcours', 'onglet_suivi', 'demo_clic', 'formulaire_ouvert', 'formulaire_valide',
];
const APPAREILS = ['ordinateur', 'mobile'];
const ROBOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp|curl|wget|python|monitor|uptime/i;

const baseId = () => process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
const entetes = () => ({ Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' });
const urlTable = (suite = '') => 'https://api.airtable.com/v0/' + baseId() + '/' + encodeURIComponent(TABLE) + suite;

// Sites autorisés à envoyer des mesures : le site vitrine publié (+ ceux listés dans AUDIENCE_ORIGINES, séparés par des virgules) et localhost (essais).
function origineAutorisee(origine) {
  if (!origine) return false;
  let hote = '';
  try { hote = new URL(origine).hostname.toLowerCase(); } catch (e) { return false; }
  if (hote === 'localhost' || hote === '127.0.0.1') return true;
  const liste = ['iko-systemes-demo.vercel.app'].concat(String(process.env.AUDIENCE_ORIGINES || '').split(',').map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean));
  return liste.includes(hote);
}

function entetesCors(req, res) {
  const origine = req.headers.origin || '';
  if (origineAutorisee(origine)) {
    res.setHeader('Access-Control-Allow-Origin', origine);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
}

async function lireCorps(req) {
  const morceaux = [];
  let taille = 0;
  for await (const m of req) { taille += m.length; if (taille > 2000) break; morceaux.push(m); }
  try { return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}'); } catch (e) { return {}; }
}

function jourParis() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
}

async function compterUneFois(evenement, appareil) {
  const jour = jourParis();
  const formule = encodeURIComponent("{Jour}='" + jour + "'");
  const r = await fetch(urlTable('?maxRecords=1&filterByFormula=' + formule), { headers: entetes() });
  if (!r.ok) throw new Error('lecture audience ' + r.status);
  const j = await r.json();
  const rec = (j.records || [])[0];
  let donnees = {};
  if (rec) { try { donnees = JSON.parse((rec.fields && rec.fields.Donnees) || '{}'); } catch (e) { donnees = {}; } }
  if (!donnees[evenement] || typeof donnees[evenement] !== 'object') donnees[evenement] = {};
  donnees[evenement][appareil] = (Number(donnees[evenement][appareil]) || 0) + 1;
  const corps = { fields: { Jour: jour, Donnees: JSON.stringify(donnees) } };
  const ecr = rec
    ? await fetch(urlTable('/' + rec.id), { method: 'PATCH', headers: entetes(), body: JSON.stringify({ fields: { Donnees: corps.fields.Donnees } }) })
    : await fetch(urlTable(), { method: 'POST', headers: entetes(), body: JSON.stringify(corps) });
  if (!ecr.ok) throw new Error('écriture audience ' + ecr.status);
}

export async function handleAudience(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  entetesCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Lecture : super-administrateur, depuis le Poste de pilotage.
  if (req.method === 'GET') {
    if (!verifierOrigine(req, { strict: true })) return res.status(403).json({ error: 'Origine non autorisée.' });
    const session = verifierSession(req);
    if (!session || session.mdpAChanger || session.role !== 'SUPER_ADMIN_IKO') return res.status(403).json({ error: 'Accès refusé.' });
    const nb = Math.max(1, Math.min(400, parseInt(req.query && req.query.jours, 10) || 90));
    try {
      const jours = [];
      let offset = '';
      do {
        const r = await fetch(urlTable('?pageSize=100&sort%5B0%5D%5Bfield%5D=Jour&sort%5B0%5D%5Bdirection%5D=desc' + (offset ? '&offset=' + encodeURIComponent(offset) : '')), { headers: entetes() });
        if (!r.ok) return res.status(502).json({ error: 'Table « Audience » introuvable ou illisible.' });
        const j = await r.json();
        for (const rec of j.records || []) {
          let d = {}; try { d = JSON.parse((rec.fields && rec.fields.Donnees) || '{}'); } catch (e) { d = {}; }
          jours.push({ jour: rec.fields && rec.fields.Jour, donnees: d });
        }
        offset = j.offset || '';
      } while (offset && jours.length < nb);
      return res.status(200).json({ jours: jours.slice(0, nb), evenements: EVENEMENTS });
    } catch (e) {
      console.error('Audience (lecture)', e);
      return res.status(502).json({ error: 'Audience indisponible.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée.' });

  // Écriture : publique, mais seulement depuis le site vitrine, sans robots, avec limite de débit. Réponse toujours discrète (204).
  if (!origineAutorisee(req.headers.origin || req.headers.referer || '')) return res.status(204).end();
  if (ROBOTS.test(String(req.headers['user-agent'] || ''))) return res.status(204).end();
  if (!verifierDebit(req, { max: 40, fenetreMs: 60_000, cle: 'audience' })) return res.status(204).end();
  const corps = await lireCorps(req);
  const evenement = String(corps.e || '');
  const appareil = APPAREILS.includes(corps.a) ? corps.a : 'ordinateur';
  if (!EVENEMENTS.includes(evenement)) return res.status(204).end();
  try { await compterUneFois(evenement, appareil); }
  catch (e) { console.error('Audience (écriture)', e.message); }
  return res.status(204).end();
}
