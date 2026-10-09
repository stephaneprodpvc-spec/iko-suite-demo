// Rappel automatique la veille du rendez-vous (cron quotidien, voir vercel.json). Fichier utilitaire : appelé via
// api/yousign-webhook.js (limite de 12 fonctions Vercel Hobby).
//
// SÉCURITÉ / ACTIVATION : ne fait RIEN tant que RAPPEL_VEILLE_ACTIF=1 n'est pas défini et que la requête ne porte pas
// le secret CRON_SECRET (Vercel l'envoie automatiquement aux crons). Il envoie l'action « rappel_veille » au
// scénario Make : le SMS / e-mail part seulement quand une route correspondante existe dans Make.
import { lienSuivi } from './_suivi.js';

const MAKE_WEBHOOK = 'https://hook.eu1.make.com/n3lwi92wldkf22jcemmjfem334p4mv6a'; // scénario démo isolé (même URL que le proxy)

export async function handleRappelVeille(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== 'Bearer ' + secret) return res.status(401).json({ error: 'Non autorisé.' });
  if (process.env.RAPPEL_VEILLE_ACTIF !== '1') return res.status(200).json({ actif: false });

  const baseId = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
  const headers = { Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN };
  const demain = new Date(Date.now() + 24 * 3600 * 1000);
  const libelle = demain.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const formule = 'AND(OR({Statut}="Nouveau",{Statut}="En cours"), FIND("' + libelle.replace(/"/g, '') + '", {Créneau}))';
  let envoyes = 0, ignores = 0;
  try {
    const r = await fetch('https://api.airtable.com/v0/' + baseId + '/Tickets%20SAV?filterByFormula=' + encodeURIComponent(formule) + '&maxRecords=100', { headers });
    if (!r.ok) return res.status(502).json({ error: 'Lecture des tickets impossible.' });
    const j = await r.json();
    for (const t of (j.records || [])) {
      const f = t.fields || {};
      if (!f.Email && !f['Téléphone']) { ignores++; continue; }
      let lien = '';
      try { lien = lienSuivi(null, { email: f.Email, tel: f['Téléphone'], ticket: f.Name }) || ''; } catch (e) { /* lien facultatif */ }
      try {
        const w = await fetch(MAKE_WEBHOOK, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marque: 'iko', action: 'rappel_veille', ticket: f.Name, nom: f.Client, 'e-mail': f.Email || '', tel: f['Téléphone'] || '',
            agence: f.Agence, produit: f.Produit, creneau: f['Créneau'], lien_suivi: lien }),
        });
        if (w.ok) envoyes++; else ignores++;
      } catch (e) { ignores++; }
    }
  } catch (e) { return res.status(502).json({ error: 'Erreur du rappel.' }); }
  return res.status(200).json({ actif: true, date: libelle, envoyes, ignores });
}
