// api/_mail.js — Aides pour les mails envoyés par Make (modèles dans IKO-TRAVAIL/MAILS-IKO).
// photosHtml : transforme la liste d'adresses de photos d'un ticket (séparées par des virgules) en miniatures
// cliquables, prêtes à être insérées dans le mail avec {{1.photos_html}}. Seules les adresses d'hébergement des photos
// IKO sont acceptées (jamais une adresse arbitraire fournie par un navigateur). Fonction pure, sans réseau.

const ADRESSE_AUTORISEE = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_\-./%]+$/;
const ADRESSE_LOCALE = /^http:\/\/localhost:\d+\/__iko-local\/fichier\/[A-Za-z0-9_\-.]+$/; // mode local uniquement

export function adressesPhotos(photos) {
  return String(photos || '').split(',').map((u) => u.trim()).filter((u) => (ADRESSE_AUTORISEE.test(u) || ADRESSE_LOCALE.test(u)) && u.length < 400).slice(0, 5);
}

export function photosHtml(photos) {
  const liste = adressesPhotos(photos);
  if (!liste.length) return '';
  const cases = liste.map((u, i) => /\.pdf($|\?)/i.test(u)
    ? '<a href="' + u + '" style="display:inline-block;width:96px;height:96px;line-height:96px;margin:0 8px 8px 0;border:1px solid #E5E5E5;border-radius:10px;background:#F5F5F5;color:#0D0D0D;font:700 13px Arial,sans-serif;text-align:center;text-decoration:none;">PDF ' + (i + 1) + '</a>'
    : '<a href="' + u + '" style="text-decoration:none;"><img src="' + u + '" width="96" height="96" alt="Photo ' + (i + 1) + '" style="display:inline-block;width:96px;height:96px;object-fit:cover;margin:0 8px 8px 0;border:1px solid #E5E5E5;border-radius:10px;"></a>').join('');
  return '<div style="font:700 12px Arial,sans-serif;color:#6B6B6B;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Photos jointes</div><div>' + cases + '</div>';
}
