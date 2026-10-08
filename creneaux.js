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
        if (!index[c.date]) { index[c.date] = { date: c.date, ids: [], horaire: c.creneau || '', creneaux: [] }; out.push(index[c.date]); }
        index[c.date].ids.push(c.id);
        index[c.date].creneaux.push({ id: c.id, horaire: c.creneau || '' });
      });
      // Heures dans l'ordre chronologique ; le jour est represente par son premier horaire.
      var debut = function (h) { var m = /^(\d{1,2})h(\d{2})/.exec(h || ''); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0; };
      out.forEach(function (d) {
        d.creneaux.sort(function (a, b) { return debut(a.horaire) - debut(b.horaire); });
        d.ids = d.creneaux.map(function (c) { return c.id; });
        d.horaire = d.creneaux[0].horaire;
      });
      return out;
    },
    // Horaire precis ("9h00 — 10h00") d'un jour propose, uniquement en mode heures precises ;
    // sinon renvoie la valeur par defaut (la plage matin / apres-midi deja affichee).
    // Mode heures : un jour avec plusieurs horaires DIFFERENTS -> une option par horaire
    // ({ date, ids: [id], horaire }). Sinon (demi-journees, ou un seul horaire) -> le jour tel quel.
    options: function (dateInfo) {
      var vus = {}, opts = [];
      (dateInfo.creneaux || []).forEach(function (c) {
        if (!/^\d{1,2}h\d{2}/.test(c.horaire) || vus[c.horaire]) return;
        vus[c.horaire] = true;
        opts.push({ date: dateInfo.date, ids: [c.id], horaire: c.horaire });
      });
      return opts.length > 1 ? opts : [dateInfo];
    },
    heure: function (dateInfo, defaut) {
      var h = dateInfo && dateInfo.horaire;
      return h && /^\d{1,2}h\d{2}/.test(h) ? h : defaut;
    }
  };
})();
