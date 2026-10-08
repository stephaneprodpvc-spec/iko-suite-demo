// creneaux.js : lecture des creneaux LIBRES du bon client et de la bonne agence,
// via la route serveur /api/airtable/creneaux (generation a la demande, voir
// api/_planning.js). Sans client = demo. Le serveur applique le delai minimum.
(function () {
  function qs(p) {
    var cles = ['agence', 'periode', 'creneau', 'mois', 'date', 'du', 'au', 'admin', 'client', 'clientId'];
    return cles.filter(function (k) { return p[k] !== undefined && p[k] !== null && p[k] !== ''; })
      .map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
  }
  window.IKO_creneaux = {
    // p : { agence, periode | creneau, mois, date, du, au, admin, client (slug) | clientId }
    charger: function (p) {
      return fetch('/api/airtable/creneaux?' + qs(p))
        .then(function (r) { return r.ok ? r.json() : { creneaux: [] }; })
        .then(function (j) { return j.creneaux || []; })
        .catch(function () { return []; });
    },
    // Regroupe par date : [{ date, ids: [...] }] (plusieurs ids = capacite > 1).
    parDate: function (liste) {
      var index = {}, out = [];
      liste.forEach(function (c) {
        if (!index[c.date]) { index[c.date] = { date: c.date, ids: [] }; out.push(index[c.date]); }
        index[c.date].ids.push(c.id);
      });
      return out;
    }
  };
})();
