// api/_mail.js — Mails IKO (orange et noir) construits côté serveur.
// Make reçoit déjà le mail terminé : champs `mail_objet` et `mail_html` (et `mail_objet_agence` / `mail_html_agence` pour
// une nouvelle demande). Dans Make, le champ « Sujet » du module Gmail ne contient que {{2.mail_objet}} et « Contenu » que {{2.mail_html}}.
// Toute valeur affichée est échappée ; les liens ne sont acceptés que s'ils sont en https (ou localhost en mode local).
// Fonctions pures, sans réseau.

const ADRESSE_AUTORISEE = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_\-./%]+$/;
const ADRESSE_LOCALE = /^http:\/\/localhost:\d+\/__iko-local\/fichier\/[A-Za-z0-9_\-.]+$/; // mode local uniquement
const OR_IKO = '#FF6B00', NOIR_IKO = '#0D0D0D';
let OR = OR_IKO, NOIR = NOIR_IKO, NOM_MARQUE = 'Iko Suite', SIGLE = 'IKO', MARQUE_CLIENT = false;
const HEX = /^#[0-9a-fA-F]{6}$/;
const luminance = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const contraste = (fond) => (luminance(fond) > 0.45 ? '#0D0D0D' : '#FFFFFF');          // texte lisible sur ce fond
const lisible = (fg, fond) => (ratio(fg, fond) >= 3 ? fg : contraste(fond));              // couleur d'accent lisible sur ce fond
// marque : { nom, principale, secondaire } (fiche client dans l'Admin). Couleurs invalides ou absentes : orange et noir IKO.
function appliquerMarque(m) {
  m = m || {};
  const pro = !!(m.nom || m.principale || m.secondaire);
  MARQUE_CLIENT = pro;
  OR = HEX.test(m.principale || '') ? m.principale : OR_IKO;
  NOIR = HEX.test(m.secondaire || '') ? m.secondaire : (pro ? '#111111' : NOIR_IKO);
  NOM_MARQUE = pro && m.nom ? String(m.nom).slice(0, 60) : 'Iko Suite';
  SIGLE = pro && m.nom ? String(m.nom).trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() : 'IKO';
}
const URL_SURE = /^(https:\/\/[^\s"'<>]+|http:\/\/localhost:\d+\/[^\s"'<>]*)$/;

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lien = (u) => (URL_SURE.test(String(u || '').trim()) ? String(u).trim() : '');

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

// ---------- éléments de mise en page ----------
const ligne = (l, v) => `<tr><td style="padding:8px 0;width:36%;font:700 12px Arial,sans-serif;color:#6B6B6B;text-transform:uppercase;letter-spacing:.5px;vertical-align:top;">${l}</td><td style="padding:8px 0;font:14px Arial,sans-serif;color:#0D0D0D;vertical-align:top;">${v}</td></tr>`;
const recap = (lignes) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #EEE;margin:18px 0 6px;">${lignes.filter(([, v]) => v !== '' && v != null).map(([l, v]) => ligne(l, v)).join('')}</table>`;
const bouton = (texte, url) => (lien(url) ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 6px;"><tr><td style="background:${OR};border-radius:10px;"><a href="${esc(lien(url))}" style="display:inline-block;padding:14px 30px;font:700 15px Arial,sans-serif;color:${contraste(OR)};text-decoration:none;">${esc(texte)}</a></td></tr></table>` : '');
const teinte = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`; // fond léger de la couleur du client
const encart = (html, fond = null, bord = OR) => `<div style="background:${fond || teinte(OR, 0.1)};border-left:4px solid ${bord};border-radius:8px;padding:14px 16px;margin:18px 0;font:14px/1.5 Arial,sans-serif;color:#0D0D0D;">${html}</div>`;
const p = (html) => `<p style="margin:0 0 14px;font:15px/1.6 Arial,sans-serif;color:#2B2B2B;">${html}</p>`;
const ticketBloc = (t) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NOIR};border-radius:12px;margin:6px 0 18px;"><tr><td style="padding:18px;text-align:center;"><div style="font:700 11px Arial,sans-serif;letter-spacing:2px;color:${contraste(NOIR) === '#FFFFFF' ? '#BDBDBD' : '#555555'};text-transform:uppercase;">Votre numéro de ticket</div><div style="font:900 28px 'Courier New',monospace;letter-spacing:2px;color:${lisible(OR, NOIR)};margin-top:6px;">${esc(t)}</div></td></tr></table>`;

function cadre({ resume, bandeau, titre, corps, pied }) {
  const basPage = pied || 'Cet e-mail est envoyé automatiquement par Iko Suite. Pour toute question, répondez simplement à ce message.';
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titre)}</title></head>
<body style="margin:0;padding:0;background:#F4F1EE;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(resume)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1EE;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
<tr><td style="background:${NOIR};padding:22px 28px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:${OR};border-radius:10px;width:46px;height:46px;text-align:center;font:900 ${SIGLE.length > 2 ? 15 : 20}px Arial,sans-serif;color:${contraste(OR)};">${esc(SIGLE)}</td>
<td style="padding-left:14px;font:700 15px Arial,sans-serif;color:${contraste(NOIR)};">${esc(NOM_MARQUE)}<br><span style="font:400 12px Arial,sans-serif;color:${contraste(NOIR) === '#FFFFFF' ? '#BDBDBD' : '#555555'};">${esc(bandeau)}</span></td></tr></table></td></tr>
<tr><td style="background:${OR};height:5px;line-height:5px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:30px 28px 10px;"><h1 style="margin:0 0 16px;font:800 22px/1.3 Arial,sans-serif;color:#0D0D0D;">${esc(titre)}</h1>${corps}</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #EEE;font:12px/1.5 Arial,sans-serif;color:#8A8A8A;text-align:center;">${esc(basPage)}<br>${MARQUE_CLIENT ? `<span style="color:${lisible(OR, '#FFFFFF')};font-weight:700;">${esc(NOM_MARQUE)}</span> — SAV propulsé par Iko Suite` : `<span style="color:${OR};font-weight:700;">Iko Suite</span> — le SAV intelligent`}</td></tr>
</table></td></tr></table></body></html>`;
}

const bonjour = (d) => p(d.nom ? `Bonjour ${esc(d.nom)},` : 'Bonjour,');
const SITE = 'https://iko-suite-demo.vercel.app';

// Construit les mails d'une action. Retourne { objet, html } (client) et, pour une nouvelle demande, { objet_agence, html_agence }.
export function construireMails(action, d, marque) {
  d = d || {};
  appliquerMarque(marque);
  const t = d.ticket || '';
  const photos = photosHtml(d.photos);
  switch (action || 'nouvelle_demande') {
    case 'nouvelle_demande': {
      const client = cadre({ resume: 'Votre demande a bien été enregistrée.', bandeau: 'Service après-vente', titre: 'Votre demande est enregistrée',
        corps: bonjour(d) + p('Nous avons bien reçu votre demande de SAV. Notre équipe va la traiter dans les meilleurs délais.') + ticketBloc(t) +
          encart('<b>Conservez ce numéro</b> : il vous permet de suivre votre demande à tout moment.') +
          recap([['Produit', esc(d.produit)], ['Problème', esc(d.probleme)], ['Rendez-vous', esc(d.creneau)], ['Adresse', esc(d.adresse)], ['Agence', esc(d.agence)]]) +
          photos + bouton('Suivre ma demande', d.lien_suivi) +
          p('<span style="font-size:13px;color:#6B6B6B;">Si un détail est inexact, répondez à ce message : nous corrigerons votre dossier.</span>') });
      const agence = cadre({ resume: "Une nouvelle demande SAV vient d'être enregistrée.", bandeau: 'Notification agence', titre: 'Nouvelle demande SAV', pied: 'Notification automatique Iko Suite — ne pas répondre à ce message.',
        corps: ticketBloc(t) + (d.urgent === 'Oui' ? `<div style="background:#FDECEC;border-left:4px solid #D92D20;border-radius:8px;padding:12px 16px;margin:0 0 14px;font:700 14px Arial,sans-serif;color:#B42318;">URGENT — à traiter en priorité</div>` : '') +
          recap([['Client', esc(d.nom)], ['Téléphone', esc(d.tel)], ['E-mail', esc(d['e-mail'])], ['Adresse', esc(d.adresse)], ['Produit', esc(d.produit)], ['Problème', esc(d.probleme)], ['Rendez-vous', esc(d.creneau)], ['Garantie', esc(d.garantie)], ['N° de facture', esc(d.facture)], ['Agence', esc(d.agence)]]) +
          photos + bouton('Ouvrir le tableau de bord', SITE + '/dashboard.html') });
      return { objet: `${t} : confirmation de votre demande SAV`, html: client, objet_agence: `Nouvelle demande SAV ${t} — ${d.produit || ''}${d.urgent === 'Oui' ? ' (URGENT)' : ''}`.trim(), html_agence: agence };
    }
    case 'message_client':
      return { objet: `${t} : nous avons bien reçu votre message`, html: cadre({ resume: 'Votre message a bien été transmis.', bandeau: 'Service après-vente', titre: 'Nous avons bien reçu votre message',
        corps: p('Bonjour,') + p(`Votre message concernant la demande <b>${esc(t)}</b> a bien été transmis à l'agence. Nous vous répondons dès que possible.`) + encart(`<b>Votre message :</b><br>${esc(d.message)}`) }) };
    case 'reponse_agence':
      return { objet: `${t} : l'agence vous répond`, html: cadre({ resume: "L'agence a répondu à votre message.", bandeau: 'Service après-vente', titre: "L'agence vous répond",
        corps: p('Bonjour,') + p(`Voici la réponse de l'agence à votre demande <b>${esc(t)}</b> :`) + encart(esc(d.message)) + p('Vous pouvez répondre depuis votre page de suivi ou directement à ce message.') }) };
    case 'rdv_modifie': {
      const agenceHtml = cadre({ resume: 'Un rendez-vous a été modifié.', bandeau: 'Notification agence', titre: 'Rendez-vous modifié', pied: 'Notification automatique Iko Suite — ne pas répondre à ce message.',
        corps: ticketBloc(t) + recap([['Client', esc(d.nom)], ['Téléphone', esc(d.tel)], ['Agence', esc(d.agence)], ['Ancien créneau', esc(d.ancien_creneau)], ['Nouveau créneau', `<b style="color:${lisible(OR, '#FFFFFF')};">${esc(d.nouveau_creneau)}</b>`], ['Modifié par', esc(d.auteur_modification || 'client')]]) + bouton('Ouvrir le tableau de bord', SITE + '/dashboard.html') });
      return { objet_agence: `RDV modifié — ${t}${d.nom ? ' — ' + d.nom : ''}`, html_agence: agenceHtml, objet: `${t} : votre rendez-vous a été modifié`, html: cadre({ resume: 'Votre rendez-vous a été modifié.', bandeau: 'Service après-vente', titre: 'Votre rendez-vous a été modifié',
        corps: p(`Le rendez-vous de votre demande <b>${esc(t)}</b>${d.agence ? ' (' + esc(d.agence) + ')' : ''} a été modifié.`) +
          recap([['Ancien créneau', esc(d.ancien_creneau)], ['Nouveau créneau', `<b style="color:${lisible(OR, '#FFFFFF')};">${esc(d.nouveau_creneau)}</b>`]]) +
          p("Si ce nouveau créneau ne vous convient pas, répondez à ce message : nous vous en proposerons un autre.") }) };
    }
    case 'technicien_en_route':
      return { objet: `${t} : votre technicien est en route`, html: cadre({ resume: `Votre technicien arrive vers ${d.arrivee || ''}.`, bandeau: 'Service après-vente', titre: 'Votre technicien est en route',
        corps: bonjour(d) + p('Votre technicien vient de partir pour votre intervention.') +
          encart(`Arrivée estimée vers <b style="font-size:20px;color:${lisible(OR, '#FFFFFF')};">${esc(d.arrivee)}</b>${d.minutes ? ' (dans environ ' + esc(d.minutes) + ' minutes)' : ''}.`) +
          recap([['Demande', esc(t)], ['Agence', esc(d.agence)]]) + p("<span style=\"font-size:13px;color:#6B6B6B;\">Merci de prévoir l'accès au produit concerné.</span>") }) };
    case 'rappel_veille':
      return { objet: `Rappel : votre rendez-vous de demain (${t})`, html: cadre({ resume: 'Rappel de votre rendez-vous de demain.', bandeau: 'Service après-vente', titre: 'Rappel de votre rendez-vous',
        corps: bonjour(d) + p('Nous vous rappelons votre rendez-vous de <b>demain</b> :') +
          recap([['Rendez-vous', `<b style="color:${lisible(OR, '#FFFFFF')};">${esc(d.creneau)}</b>`], ['Produit', esc(d.produit)], ['Agence', esc(d.agence)], ['Demande', esc(t)]]) + bouton('Voir ou modifier mon rendez-vous', d.lien_suivi) }) };
    case 'devis_envoye':
    case 'devis_auto_envoye':
      return { objet: `${t} : votre devis de ${d.montant || ''}`.trim(), html: cadre({ resume: 'Votre devis est disponible.', bandeau: 'Devis', titre: 'Votre devis est prêt',
        corps: bonjour(d) + p(`Suite à l'examen de votre demande <b>${esc(t)}</b>, voici votre devis.`) +
          recap([['Produit', esc(d.produit)], ['Problème', esc(d.probleme)], ['Montant TTC', `<b style="font-size:18px;color:${lisible(OR, '#FFFFFF')};">${esc(d.montant)}</b>`]]) +
          (d.message ? encart(esc(d.message)) : '') + bouton('Consulter et signer mon devis', d.lien) +
          p('<span style="font-size:13px;color:#6B6B6B;">Vous pouvez accepter ou refuser le devis en ligne, en quelques clics.</span>') }) };
    case 'devis_signe':
    case 'devis_accepte':
      return { objet: `${t} : votre devis est signé`, html: cadre({ resume: 'Merci, votre devis est signé.', bandeau: 'Devis', titre: 'Votre devis est signé',
        corps: bonjour(d) + p(`Nous avons bien reçu la signature de votre devis pour la demande <b>${esc(t)}</b>. Merci de votre confiance.`) +
          recap([['Produit', esc(d.produit)], ['Problème', esc(d.probleme)], ['Montant TTC', d.montant ? `<b style="color:${lisible(OR, '#FFFFFF')};">${esc(d.montant)}</b>` : '']]) +
          encart('<b>Et maintenant ?</b> L\'agence vous contacte pour planifier l\'intervention.') + bouton('Suivre ma demande', d.lien_suivi) }) };
    case 'devis_refuse':
      return { objet: `${t} : votre devis a été refusé`, html: cadre({ resume: 'Nous avons bien noté votre refus.', bandeau: 'Devis', titre: 'Nous avons bien noté votre décision',
        corps: bonjour(d) + p(`Votre devis pour la demande <b>${esc(t)}</b> a été refusé. Si vous souhaitez en discuter ou obtenir une autre proposition, répondez simplement à ce message.`) }) };
    case 'devis_deblocage':
      return { objet: `${t} : intervention avancée`, html: cadre({ resume: 'Votre intervention a été avancée.', bandeau: 'Service après-vente', titre: 'Votre intervention est avancée',
        corps: bonjour(d) + p(`Bonne nouvelle : l'intervention de votre demande <b>${esc(t)}</b> a été avancée.`) +
          recap([['Nouveau rendez-vous', `<b style="color:${lisible(OR, '#FFFFFF')};">${esc(d.creneau)}</b>`], ['Produit', esc(d.produit)], ['Montant du devis', esc(d.montant)]]) }) };
    case 'demande_note':
      return { objet: `${t} : votre avis nous intéresse`, html: cadre({ resume: 'Donnez-nous votre avis en 30 secondes.', bandeau: 'Votre avis', titre: "Comment s'est passée votre intervention ?",
        corps: bonjour(d) + p(`Votre intervention (<b>${esc(t)}</b>${d.produit ? ', ' + esc(d.produit) : ''}) est terminée. Votre avis nous aide à nous améliorer : cela prend 30 secondes.`) +
          bouton('Donner mon avis', d.lien) + (lien(d.lien_bon_intervention) ? `<p style="text-align:center;font:13px Arial,sans-serif;"><a href="${esc(lien(d.lien_bon_intervention))}" style="color:${lisible(OR, '#FFFFFF')};">Télécharger mon bon d'intervention</a></p>` : '') }) };
    case 'entretien_demande': {
      const client = cadre({ resume: "Votre demande de contrat d'entretien est enregistrée.", bandeau: "Contrat d'entretien", titre: 'Votre demande est enregistrée',
        corps: bonjour(d) + p("Nous avons bien reçu votre demande de contrat d'entretien. Un conseiller de votre agence vous rappelle pour vous présenter l'offre et fixer vos visites.") + ticketBloc(t) +
          recap([['Équipements', esc(d.equipements)], ['Fréquence souhaitée', esc(d.frequence)], ['Adresse', esc(d.adresse)], ['Agence', esc(d.agence)]]) + bouton('Suivre mon contrat', d.lien_suivi) });
      const agence = cadre({ resume: "Nouvelle demande de contrat d'entretien.", bandeau: 'Notification agence', titre: "Demande de contrat d'entretien", pied: 'Notification automatique Iko Suite — ne pas répondre à ce message.',
        corps: ticketBloc(t) + recap([['Client', esc(d.nom)], ['Téléphone', esc(d.tel)], ['E-mail', esc(d['e-mail'])], ['Adresse', esc(d.adresse)], ['Équipements', esc(d.equipements)], ['Fréquence', esc(d.frequence)], ['Précisions', esc(d.message)]]) +
          bouton('Traiter la demande', SITE + '/entretien.html') });
      return { objet: `${t} : votre demande de contrat d'entretien`, html: client, objet_agence: `Demande de contrat d'entretien ${t} — ${d.nom || ''}`.trim(), html_agence: agence };
    }
    case 'entretien_visite': {
      const client = cadre({ resume: "Votre visite d'entretien est planifiée.", bandeau: "Contrat d'entretien", titre: 'Votre visite est planifiée',
        corps: bonjour(d) + p("Votre prochaine visite d'entretien est confirmée.") + recap([['Date', `<b style="color:${lisible(OR, '#FFFFFF')};">${esc(d.date_visite)}</b>`], ['Créneau', esc(d.creneau)], ['Adresse', esc(d.adresse)], ['Équipements', esc(d.equipements)]]) + bouton('Gérer mes visites', d.lien_suivi) });
      const agence = cadre({ resume: "Une visite d'entretien a été planifiée.", bandeau: 'Notification agence', titre: "Visite d'entretien planifiée", pied: 'Notification automatique Iko Suite — ne pas répondre à ce message.',
        corps: recap([['Client', esc(d.nom)], ['Date', esc(d.date_visite)], ['Créneau', esc(d.creneau)], ['Adresse', esc(d.adresse)], ['Équipements', esc(d.equipements)]]) + bouton('Ouvrir les contrats', SITE + '/entretien.html') });
      return { objet: `Votre visite d'entretien : ${d.date_visite || ''}`.trim(), html: client, objet_agence: `Visite d'entretien planifiée — ${d.nom || ''} (${d.date_visite || ''})`, html_agence: agence };
    }
    case 'entretien_rappel':
      return { objet: `Votre visite d'entretien approche${d.date_visite ? ' (' + d.date_visite + ')' : ''}`, html: cadre({ resume: "Votre visite d'entretien approche.", bandeau: "Contrat d'entretien", titre: "Votre visite d'entretien approche",
        corps: bonjour(d) + p("Votre prochaine visite d'entretien est prévue prochainement.") +
          recap([['Date prévue', `<b style="color:${lisible(OR, '#FFFFFF')};">${esc(d.date_visite)}</b>`], ['Équipements', esc(d.equipements)], ['Agence', esc(d.agence)]]) + p('Répondez à ce message pour confirmer ou choisir une autre date.') }) };
    case 'piece_a_commander':
      return { objet: `${t} : pièce à commander`, html: cadre({ resume: 'Une pièce est à commander.', bandeau: 'Notification agence', titre: 'Pièce à commander', pied: 'Notification automatique Iko Suite — ne pas répondre à ce message.',
        corps: recap([['Demande', esc(t)], ['Client', esc(d.nom)], ['Agence', esc(d.agence)], ['Pièce', `<b>${esc(d.piece)}</b>`]]) + bouton('Ouvrir le tableau de bord', SITE + '/dashboard.html') }) };
    case 'alerte_incident':
      return { objet: `ALERTE IKO : ${d.titre || ''}`.trim(), html: cadre({ resume: d.titre, bandeau: "Alerte d'exploitation", titre: d.titre || 'Alerte', pied: 'Alerte automatique Iko Suite.',
        corps: encart(esc(d.message), '#FDECEC', '#D92D20') + p(`<span style="font-size:13px;color:#6B6B6B;">Signalé le ${esc(d.quand)}.</span>`) + bouton('Ouvrir le poste de pilotage', SITE + '/admin.html') }) };
    default:
      return null;
  }
}

// Ajoute au corps envoyé à Make les champs mail_objet / mail_html (et *_agence). Ne remplace jamais une valeur existante du navigateur :
// ces champs sont toujours recalculés ici.
export function ajouterMailsAuCorps(corps, action, marque) {
  try {
    const m = construireMails(action, corps, marque);
    if (!m) return corps;
    corps.mail_objet = m.objet; corps.mail_html = m.html;
    if (m.html_agence) {
      corps.mail_objet_agence = m.objet_agence; corps.mail_html_agence = m.html_agence;
      // Destinataire du mail agence : l'e-mail de l'agence s'il est renseigné, sinon le responsable IKO (variable EMAIL_RESPONSABLE_IKO).
      const valide = (e) => /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(String(e || '').trim());
      const secours = process.env.EMAIL_RESPONSABLE_IKO || 'stephane.prodpvc@gmail.com';
      corps.mail_a_agence = valide(corps.email_agence) ? String(corps.email_agence).trim() : secours;
    }
  } catch (e) { /* un souci de mise en page ne doit jamais empêcher l'envoi */ }
  return corps;
}

const cacheMarque = new Map();
// Retourne { nom, principale, secondaire } pour un client pro (identifiant rec…), ou null (mails aux couleurs d'IKO).
export async function marqueClient(clientId) {
  try {
    if (!/^rec[A-Za-z0-9]{14}$/.test(String(clientId || ''))) return null;
    const hit = cacheMarque.get(clientId);
    if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.v;
    const base = process.env.AIRTABLE_BASE_ID || 'appkI8RKHkYNWY86U';
    const r = await fetch('https://api.airtable.com/v0/' + base + '/Clients/' + clientId, { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN } });
    if (!r.ok) return null;
    const f = (await r.json()).fields || {};
    const v = { nom: f['Nom client'] || '', principale: f['Couleur principale'] || '', secondaire: f['Couleur secondaire'] || '' };
    cacheMarque.set(clientId, { t: Date.now(), v });
    return v;
  } catch (e) { return null; }
}

// Complète le corps d'un envoi avec les détails réels du ticket (nom, produit, créneau…) quand le navigateur n'a envoyé que le numéro.
// Ne remplace jamais une valeur déjà présente. Retourne l'identifiant du client pro du ticket (pour ses couleurs), ou null.
export async function enrichirDepuisTicket(corps, ctx) {
  try {
    const num = String(corps.ticket || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,30}$/.test(num) || !ctx || !ctx.baseId || !ctx.headers) return null;
    const r = await fetch('https://api.airtable.com/v0/' + ctx.baseId + '/Tickets%20SAV?filterByFormula=' + encodeURIComponent('UPPER({Name})="' + num + '"') + '&maxRecords=1', { headers: ctx.headers });
    if (!r.ok) return null;
    const rec = ((await r.json()).records || [])[0];
    if (!rec) return null;
    const f = rec.fields || {};
    const mettre = (k, v) => { if ((corps[k] === undefined || corps[k] === '') && v) corps[k] = String(v); };
    mettre('nom', f.Client); mettre('produit', f.Produit); mettre('probleme', f['Problème']); mettre('creneau', f['Créneau']);
    mettre('adresse', f.Adresse); mettre('tel', f['Téléphone']); mettre('e-mail', f.Email); mettre('agence', f.Agence);
    mettre('montant', f['Montant devis'] ? f['Montant devis'] + ' €' : '');
    return Array.isArray(f['Compte client']) && f['Compte client'][0] ? f['Compte client'][0] : null;
  } catch (e) { return null; }
}
