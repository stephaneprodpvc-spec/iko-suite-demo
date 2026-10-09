// Sauvegarde / export des données (RGPD, réversibilité) : une table par appel, réservé au super-admin IKO.
// Le poste de pilotage enchaîne les tables et assemble un fichier JSON téléchargeable.
import { verifierOrigine, verifierSession, reponseBloquee } from './_securite.js';

const TABLES = ['Clients', 'Agences', 'Tickets SAV', 'Interventions SAV', 'Devis', 'Catalogue Produits', "Grille Main d'œuvre",
  'Mise en page Devis', 'Métrés', 'Ouvertures Métré', 'Questionnaire SAV', 'RDV Commercial', 'Planning Commercial', 'Contrôles Chantier', 'Journal actions'];

export default async function handler(req, res) {
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
