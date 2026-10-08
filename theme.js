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
  // Les pages React rendent leurs logos apres coup : on re-applique logo/nom.
  document.addEventListener('DOMContentLoaded', function () {
    appliquerElements();
    new MutationObserver(appliquerElements).observe(document.body, { childList: true, subtree: true });
  });
})();
