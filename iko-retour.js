// iko-retour.js — bouton « ← Retour » IDENTIQUE sur toutes les pages annexes (même place, même style que dans les fenêtres du tableau de bord).
// Les pages qui ont leur propre feuille (entretien, équipe…) y placent <button data-iko-retour> ; les autres reçoivent le bouton automatiquement, tout en haut à gauche.
(function () {
  function cible() {
    var slug = ''; try { slug = localStorage.getItem('iko_client_slug') || ''; } catch (e) {}
    var vientCentrale = false; try { vientCentrale = sessionStorage.getItem('iko_retour_centrale') === '1'; } catch (e) {}
    var params = [];
    if (slug) params.push('client=' + encodeURIComponent(slug));
    if (vientCentrale) params.push('centrale=1');
    return '/dashboard.html' + (params.length ? '?' + params.join('&') : '');
  }
  function vientDeLaCentrale() { try { return sessionStorage.getItem('iko_retour_centrale') === '1'; } catch (e) { return false; } }
  // Action de retour unique : venu de la Centrale -> on y retourne ; sinon page précédente du site, ou tableau de bord.
  window.IKO_retour = function () {
    var memeSite = false; try { memeSite = document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
    if (!vientDeLaCentrale() && memeSite && history.length > 1) history.back(); else location.href = cible();
  };
  var STYLE = 'padding:6px 12px;font:800 12px -apple-system,Segoe UI,Arial,sans-serif;border-radius:12px;cursor:pointer;color:#8a3300;background:rgba(255,255,255,0.45);border:1px solid rgba(255,107,0,0.40);box-shadow:0 3px 12px rgba(120,40,0,0.14),inset 0 1px 0 rgba(255,255,255,0.8);-webkit-backdrop-filter:blur(16px) saturate(170%);backdrop-filter:blur(16px) saturate(170%)';
  function lier() {
    document.querySelectorAll('[data-iko-retour]').forEach(function (b) { if (!b.dataset.lie) { b.dataset.lie = '1'; b.addEventListener('click', window.IKO_retour); } });
  }
  function ajouter() {
    lier();
    if (document.getElementById('iko-retour-auto') || document.querySelector('[data-iko-retour]')) return;
    var els = document.querySelectorAll('button, a');
    for (var i = 0; i < els.length; i++) { var t = (els[i].textContent || '').trim(); if (t.indexOf('←') === 0 || /^retour/i.test(t)) return; }
    var b = document.createElement('button');
    b.id = 'iko-retour-auto'; b.type = 'button'; b.textContent = '← Retour'; b.setAttribute('style', STYLE + ';display:block;width:fit-content;align-self:flex-start;margin:10px 0 12px 12px');
    b.addEventListener('click', window.IKO_retour);
    document.body.insertBefore(b, document.body.firstChild);
  }
  function lancer() { lier(); setTimeout(ajouter, 1200); setTimeout(ajouter, 3500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lancer); else lancer();
})();
