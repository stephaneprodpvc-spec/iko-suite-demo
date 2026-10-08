// Theme IKO : applique window.IKO_THEME (couleur, logo, nom) par-dessus les
// variables de theme.css. Aucun appel reseau : window.IKO_THEME est fourni par
// la page (la lecture depuis le compte client viendra avec ADMIN).
// Forme : { couleur: "#RRGGBB", logo: "https://...", nom: "Mon entreprise" }
// Elements remplacables : <img data-iko-logo> et <* data-iko-nom>.
(function () {
  function rgb(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function melange(c, k, base) { // k = part de la couleur, base = 255 (blanc) ou 0 (noir)
    return 'rgb(' + c.map(function (v) { return Math.round(v * k + base * (1 - k)); }).join(',') + ')';
  }
  function logoValide(u) { return typeof u === 'string' && /^(https:\/\/|data:image\/|\/)/.test(u); }
  function appliquerElements() {
    var t = window.IKO_THEME;
    if (!t) return;
    if (logoValide(t.logo)) {
      document.querySelectorAll('img[data-iko-logo]').forEach(function (el) {
        if (el.getAttribute('src') !== t.logo) el.setAttribute('src', t.logo);
      });
    }
    if (typeof t.nom === 'string' && t.nom.trim()) {
      document.querySelectorAll('[data-iko-nom]').forEach(function (el) {
        if (el.textContent !== t.nom) el.textContent = t.nom;
      });
    }
  }
  function appliquer() {
    var t = window.IKO_THEME;
    if (!t) return;
    var c = rgb(t.couleur);
    if (c) {
      var s = document.documentElement.style;
      s.setProperty('--iko-primary', t.couleur);
      s.setProperty('--iko-primary-rgb', c.join(', '));
      s.setProperty('--iko-primary-clair', melange(c, 0.08, 255));
      s.setProperty('--iko-primary-pale', melange(c, 0.3, 255));
      s.setProperty('--iko-primary-fonce', melange(c, 0.75, 0));
    }
    appliquerElements();
  }
  window.IKO_applyTheme = appliquer;
  appliquer();

  // ---- Theme du client (couleur, logo, nom) -------------------------------
  // lireFicheClientPublic est le POINT UNIQUE de lecture de la fiche client par
  // les pages publiques. Il ne demande que des champs non sensibles (liste ci-
  // dessous). Quand la lecture publique de "Clients" sera fermee, il suffira de
  // rebrancher cette seule fonction sur une route dediee.
  var CHAMPS_FICHE_PUBLIQUE = ['Nom client', 'Slug', 'Couleur principale', 'Logo', 'Accès bloqué', 'Nombre agences'];
  var cacheFiches = {};
  function ficheDepuisFields(id, f) {
    f = f || {};
    var logo = f['Logo'] && f['Logo'][0] && f['Logo'][0].url;
    return {
      id: id || null,
      nom: typeof f['Nom client'] === 'string' ? f['Nom client'].trim() : '',
      slug: f['Slug'] || '',
      couleur: typeof f['Couleur principale'] === 'string' ? f['Couleur principale'].trim() : '',
      logo: logo || '',
      bloque: f['Accès bloqué'] === true,
      nombreAgences: parseInt(f['Nombre agences'], 10) || null
    };
  }
  window.IKO_lireFicheClientPublic = function (slug) {
    slug = String(slug || '').trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(slug)) return Promise.resolve(null);
    if (cacheFiches[slug]) return cacheFiches[slug];
    var url = '/api/airtable/Clients?filterByFormula=' + encodeURIComponent('{Slug}="' + slug + '"') + '&maxRecords=1' +
      CHAMPS_FICHE_PUBLIQUE.map(function (c) { return '&fields%5B%5D=' + encodeURIComponent(c); }).join('');
    cacheFiches[slug] = fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var rec = j && j.records && j.records[0];
        return rec ? ficheDepuisFields(rec.id, rec.fields) : null;
      })
      .catch(function () { return null; });
    return cacheFiches[slug];
  };
  // Applique couleur / logo / nom d'une fiche (champs deja lus) ; sinon thème par défaut.
  window.IKO_appliquerFiche = function (fields) {
    var fiche = ficheDepuisFields(null, fields);
    var t = {};
    if (/^#[0-9a-f]{6}$/i.test(fiche.couleur)) t.couleur = fiche.couleur;
    if (logoValide(fiche.logo)) t.logo = fiche.logo;
    if (fiche.nom) t.nom = fiche.nom;
    if (t.couleur || t.logo || t.nom) { window.IKO_THEME = t; appliquer(); }
  };
  // Pages publiques (<meta name="iko-theme-client">) : lit ?client=slug et applique le theme.
  // Echec de lecture = theme orange/noir par defaut, rien ne casse.
  window.IKO_chargerThemeClient = function () {
    var slug = new URLSearchParams(window.location.search).get('client');
    if (!slug) return Promise.resolve(null);
    return window.IKO_lireFicheClientPublic(slug).then(function (fiche) {
      if (!fiche) return null;
      var f = { 'Nom client': fiche.nom, 'Couleur principale': fiche.couleur, 'Logo': fiche.logo ? [{ url: fiche.logo }] : [] };
      window.IKO_appliquerFiche(f);
      return fiche;
    });
  };
  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('meta[name="iko-theme-client"]')) window.IKO_chargerThemeClient();
  });
  // Les pages React rendent leurs logos apres coup : on re-applique logo/nom.
  document.addEventListener('DOMContentLoaded', function () {
    appliquerElements();
    new MutationObserver(appliquerElements).observe(document.body, { childList: true, subtree: true });
  });
})();
