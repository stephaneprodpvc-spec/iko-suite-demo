// iko-aide.js — aide intégrée d'IKO : bouton « ? » en bas à gauche de chaque écran de travail.
// Un panneau propose : 1) l'aide de la page en cours, 2) la liste « Bien démarrer » du rôle (cases à cocher mémorisées sur cet appareil),
// 3) une recherche dans tout le guide. Le texte vient de /guide-contenu.json (même source que guide.html et que l'assistant IKO).
// Aucune donnée client n'est lue ni envoyée ici ; seule la préférence de rôle et les cases cochées sont gardées dans le navigateur.
(function () {
  if (window.IKO_AIDE_CHARGE) return;
  window.IKO_AIDE_CHARGE = true;

  var PAGES = { 'dashboard': 'dashboard', 'technicien': 'technicien', 'acces': 'acces', 'equipe': 'equipe', 'entretien': 'entretien', 'admin': 'admin' };
  var page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  if (!PAGES[page]) return;

  var NOMS_ROLES = { patron: 'Patron / direction', agence: "Responsable d'agence", technicien: 'Technicien', editeur: "Éditeur IKO" };
  var ROLE_PAR_PAGE = { dashboard: 'patron', technicien: 'technicien', acces: 'patron', equipe: 'patron', entretien: 'agence', admin: 'editeur' };
  var contenu = null;

  function lire(cle, defaut) { try { var v = localStorage.getItem(cle); return v === null ? defaut : v; } catch (e) { return defaut; } }
  function ecrire(cle, val) { try { localStorage.setItem(cle, val); } catch (e) { /* stockage indisponible : l'aide marche quand même */ } }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function sansAccent(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function roleCourant() {
    var r = lire('iko_aide_role', '');
    if (r && NOMS_ROLES[r]) return r;
    var s = window.IKO_ROLE;
    if (page === 'technicien') return 'technicien';
    if (s === 'SUPER_ADMIN_IKO') return page === 'admin' ? 'editeur' : 'patron';
    if (s === 'TECHNICIEN') return 'technicien';
    return ROLE_PAR_PAGE[page] || 'patron';
  }

  var CSS = '#iko-aide-btn{position:fixed;left:14px;bottom:14px;z-index:2147483000;width:44px;height:44px;border-radius:50%;border:2px solid #111;background:#FF7A00;color:#111;font:800 20px -apple-system,Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35)}' +
    '#iko-aide-btn:focus-visible,#iko-aide-fermer:focus-visible,#iko-aide-q:focus-visible{outline:3px solid #111;outline-offset:2px}' +
    '#iko-aide-pan{position:fixed;left:14px;bottom:68px;z-index:2147483000;width:min(380px,calc(100vw - 28px));max-height:min(70vh,560px);overflow:auto;background:#fff;color:#111;border:2px solid #111;border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,.4);font:14px/1.45 -apple-system,Segoe UI,Arial,sans-serif;display:none}' +
    '#iko-aide-pan.ouvert{display:block}' +
    '#iko-aide-pan header{position:sticky;top:0;background:#111;color:#fff;padding:10px 12px;display:flex;align-items:center;gap:8px;border-radius:13px 13px 0 0}' +
    '#iko-aide-pan header b{flex:1;font-size:14px}' +
    '#iko-aide-fermer{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}' +
    '#iko-aide-pan .bloc{padding:10px 12px;border-bottom:1px solid #eee}' +
    '#iko-aide-pan h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#8a3300}' +
    '#iko-aide-pan select,#iko-aide-pan input[type=search]{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #bbb;border-radius:8px;font:inherit}' +
    '#iko-aide-pan details{margin:4px 0}#iko-aide-pan summary{cursor:pointer;font-weight:700}' +
    '#iko-aide-pan ol,#iko-aide-pan ul{margin:6px 0 6px 18px;padding:0}' +
    '#iko-aide-pan .astuce{background:#FFF3E6;border-left:4px solid #FF7A00;padding:6px 8px;margin:6px 0;border-radius:6px}' +
    '#iko-aide-pan,#iko-aide-pan *{text-align:left!important;letter-spacing:normal;text-transform:none}' +
    '#iko-aide-pan h4{text-transform:uppercase!important;letter-spacing:.04em!important}' +
    '#iko-aide-pan label.cas{display:flex!important;gap:8px;align-items:flex-start;margin:5px 0!important;cursor:pointer;width:auto!important}' +
    '#iko-aide-pan label.cas input{width:auto!important;height:auto!important;flex:none;margin:3px 0 0!important;padding:0!important}' +
    '#iko-aide-pan label.cas span{flex:1;min-width:0}' +
    '#iko-aide-pan a{color:#8a3300;font-weight:700}' +
    '#iko-aide-pan .barre{height:6px;background:#eee;border-radius:4px;overflow:hidden;margin:4px 0 6px}#iko-aide-pan .barre i{display:block;height:100%;background:#FF7A00}' +
    '@media print{#iko-aide-btn,#iko-aide-pan{display:none!important}}';

  function sectionsPage(c, role) {
    var ids = (c.aide_page && c.aide_page[page]) || [];
    return (c.sections || []).filter(function (s) { return ids.indexOf(s.id) !== -1; });
  }
  function htmlSection(s) {
    var h = '<details><summary>' + esc(s.titre) + '</summary>';
    if (s.resume) h += '<p>' + esc(s.resume) + '</p>';
    if (s.etapes && s.etapes.length) h += '<ol>' + s.etapes.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ol>';
    if (s.astuce) h += '<div class="astuce">' + esc(s.astuce) + '</div>';
    h += '<a href="/guide.html#' + encodeURIComponent(s.id) + '">Voir dans le guide complet</a></details>';
    return h;
  }
  function etatCases(role) { try { return JSON.parse(lire('iko_aide_cases_' + role, '{}')) || {}; } catch (e) { return {}; } }

  function rendre(pan, c) {
    var role = roleCourant();
    var cases = etatCases(role);
    var liste = ((c.demarrer || {})[role]) || [];
    var faites = liste.filter(function (x) { return cases[x.id]; }).length;
    var h = '<header><b>Aide — ' + esc((c.pages_noms || {})[page] || page) + '</b><button id="iko-aide-fermer" type="button" aria-label="Fermer l\'aide">×</button></header>';
    h += '<div class="bloc"><label for="iko-aide-role" style="font-size:12px;color:#555">Je suis :</label><select id="iko-aide-role">' +
      Object.keys(NOMS_ROLES).map(function (r) { return '<option value="' + r + '"' + (r === role ? ' selected' : '') + '>' + esc(NOMS_ROLES[r]) + '</option>'; }).join('') + '</select></div>';
    var sp = sectionsPage(c, role);
    h += '<div class="bloc"><h4>Sur cet écran</h4>' + (sp.length ? sp.map(htmlSection).join('') : '<p>Pas d\'aide spécifique pour cet écran. Consultez le guide complet.</p>') + '</div>';
    if (liste.length) {
      h += '<div class="bloc"><h4>Bien démarrer (' + faites + '/' + liste.length + ')</h4><div class="barre"><i style="width:' + Math.round(100 * faites / liste.length) + '%"></i></div>' +
        liste.map(function (x) {
          return '<label class="cas"><input type="checkbox" data-id="' + esc(x.id) + '"' + (cases[x.id] ? ' checked' : '') + '><span>' + esc(x.texte) + (x.lien ? ' <a href="' + esc(x.lien) + '">Ouvrir</a>' : '') + '</span></label>';
        }).join('') + '</div>';
    }
    h += '<div class="bloc"><h4>Chercher dans le guide</h4><input id="iko-aide-q" type="search" placeholder="Ex. : créer un technicien" aria-label="Chercher dans le guide"><div id="iko-aide-res"></div>' +
      '<p style="margin:8px 0 0"><a href="/guide.html">Ouvrir le guide complet</a></p></div>';
    pan.innerHTML = h;

    pan.querySelector('#iko-aide-fermer').addEventListener('click', fermer);
    pan.querySelector('#iko-aide-role').addEventListener('change', function () { ecrire('iko_aide_role', this.value); rendre(pan, c); });
    Array.prototype.forEach.call(pan.querySelectorAll('input[data-id]'), function (cb) {
      cb.addEventListener('change', function () { var e = etatCases(role); e[cb.getAttribute('data-id')] = cb.checked; ecrire('iko_aide_cases_' + role, JSON.stringify(e)); rendre(pan, c); });
    });
    var q = pan.querySelector('#iko-aide-q');
    q.addEventListener('input', function () {
      var mots = sansAccent(q.value).split(/\s+/).filter(function (m) { return m.length > 1; });
      var res = pan.querySelector('#iko-aide-res');
      if (!mots.length) { res.innerHTML = ''; return; }
      var trouves = (c.sections || []).filter(function (s) {
        var texte = sansAccent([s.titre, s.resume, (s.etapes || []).join(' '), s.astuce, (s.mots || []).join(' ')].join(' '));
        return mots.every(function (m) { return texte.indexOf(m) !== -1; });
      }).slice(0, 6);
      var faq = (c.faq || []).filter(function (f) { var t = sansAccent(f.q + ' ' + f.r); return mots.every(function (m) { return t.indexOf(m) !== -1; }); }).slice(0, 4);
      res.innerHTML = (trouves.length ? trouves.map(htmlSection).join('') : '') +
        faq.map(function (f) { return '<details><summary>' + esc(f.q) + '</summary><p>' + esc(f.r) + '</p></details>'; }).join('') +
        (!trouves.length && !faq.length ? '<p>Aucun résultat. Essayez un autre mot, ou demandez à IKO.</p>' : '');
    });
  }

  var pan, btn;
  function fermer() { if (pan) pan.classList.remove('ouvert'); if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.focus(); } }
  function ouvrir() {
    if (!contenu) {
      fetch('/guide-contenu.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
        contenu = c || { sections: [], faq: [], demarrer: {}, aide_page: {} };
        ouvrir();
      }).catch(function () { contenu = { sections: [], faq: [], demarrer: {}, aide_page: {} }; ouvrir(); });
      return;
    }
    rendre(pan, contenu);
    pan.classList.add('ouvert');
    btn.setAttribute('aria-expanded', 'true');
    var f = pan.querySelector('#iko-aide-fermer'); if (f) f.focus();
  }

  function monter() {
    if (document.getElementById('iko-aide-btn')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    btn = document.createElement('button');
    btn.id = 'iko-aide-btn'; btn.type = 'button'; btn.textContent = '?'; btn.title = 'Aide'; btn.setAttribute('aria-label', 'Ouvrir l\'aide'); btn.setAttribute('aria-expanded', 'false');
    pan = document.createElement('div'); pan.id = 'iko-aide-pan'; pan.setAttribute('role', 'dialog'); pan.setAttribute('aria-label', 'Aide IKO');
    btn.addEventListener('click', function () { if (pan.classList.contains('ouvert')) fermer(); else ouvrir(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pan.classList.contains('ouvert')) fermer(); });
    document.body.appendChild(btn); document.body.appendChild(pan);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter); else monter();
})();
