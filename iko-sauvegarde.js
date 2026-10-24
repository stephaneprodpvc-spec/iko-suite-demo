// iko-sauvegarde.js — sauvegarde automatique des données IKO dans un DOSSIER DE CE PC.
// Fonctionne dans Chrome / Edge (API « File System Access »). L'utilisateur choisit le dossier une fois ;
// le navigateur garde l'autorisation (à reconfirmer d'un clic après une fermeture). Aucune donnée ne quitte le PC.
// Limite assumée : la sauvegarde ne tourne que tant que le tableau de bord est ouvert.
(function () {
  'use strict';
  var BASE = 'iko-sauvegarde', STORE = 'kv', GARDER = 30; // nombre de fichiers conservés
  var CLE_DERNIERE = 'iko_sauv_derniere', CLE_FREQ = 'iko_sauv_frequence_h';

  function ouvrir() {
    return new Promise(function (ok, ko) {
      var r = indexedDB.open(BASE, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { ko(r.error); };
    });
  }
  function lire(cle) {
    return ouvrir().then(function (db) { return new Promise(function (ok, ko) {
      var q = db.transaction(STORE).objectStore(STORE).get(cle); q.onsuccess = function () { ok(q.result); }; q.onerror = function () { ko(q.error); };
    }); });
  }
  function ecrireCle(cle, val) {
    return ouvrir().then(function (db) { return new Promise(function (ok, ko) {
      var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, cle); tx.oncomplete = function () { ok(); }; tx.onerror = function () { ko(tx.error); };
    }); });
  }
  function effacerCle(cle) {
    return ouvrir().then(function (db) { return new Promise(function (ok) {
      var tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(cle); tx.oncomplete = function () { ok(); };
    }); });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function permission(h, demander) {
    if (!h) return Promise.resolve('absent');
    if (typeof h.queryPermission !== 'function') return Promise.resolve('granted'); // dossier privé du navigateur
    var opts = { mode: 'readwrite' };
    return h.queryPermission(opts).then(function (p) {
      if (p === 'granted' || !demander) return p;
      return h.requestPermission(opts);
    });
  }
  function horodatage() {
    var d = new Date(), z = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + '_' + z(d.getHours()) + 'h' + z(d.getMinutes());
  }

  window.IKO_SAUV = {
    supporte: typeof window.showDirectoryPicker === 'function',
    frequenceHeures: function () { var n = parseInt(lsGet(CLE_FREQ), 10); return n > 0 ? n : 24; },
    definirFrequence: function (h) { lsSet(CLE_FREQ, String(h)); },
    // À appeler depuis un clic : ouvre la fenêtre Windows de choix du dossier.
    choisirDossier: function () {
      return window.showDirectoryPicker({ mode: 'readwrite', id: 'iko-sauvegardes' }).then(function (h) {
        return ecrireCle('dossier', h).then(function () { return h.name; });
      });
    },
    // Sauvegarde manuelle : fenêtre « Enregistrer sous » qui s'ouvre dans le dossier de sauvegarde choisi.
    // Retourne le nom du fichier, ou null si l'utilisateur annule. Repli : téléchargement classique.
    enregistrerSous: function (archive) {
      var contenu = JSON.stringify(archive, null, 1);
      var nom = 'IKO_sauvegarde_manuelle_' + horodatage() + '.json';
      function telecharger() {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
        a.download = nom; document.body.appendChild(a); a.click(); a.remove();
        return nom;
      }
      if (typeof window.showSaveFilePicker !== 'function') return Promise.resolve(telecharger());
      return lire('dossier').catch(function () { return null; }).then(function (h) {
        var opts = { suggestedName: nom, types: [{ description: 'Sauvegarde IKO', accept: { 'application/json': ['.json'] } }] };
        if (h) opts.startIn = h;
        return window.showSaveFilePicker(opts).then(function (f) {
          return f.createWritable().then(function (w) { return w.write(contenu).then(function () { return w.close(); }); }).then(function () { return f.name; });
        }).catch(function (e) { if (e && e.name === 'AbortError') return null; throw e; });
      });
    },
    // Pour les tests : fournit directement un dossier (ex. dossier privé du navigateur).
    _fournirDossier: function (h) { return ecrireCle('dossier', h); },
    oublier: function () { return effacerCle('dossier'); },
    etat: function () {
      return lire('dossier').then(function (h) {
        return permission(h, false).then(function (p) {
          return { supporte: window.IKO_SAUV.supporte, dossier: h ? h.name : null, permission: p, derniere: lsGet(CLE_DERNIERE), frequenceH: window.IKO_SAUV.frequenceHeures() };
        });
      }).catch(function () { return { supporte: window.IKO_SAUV.supporte, dossier: null, permission: 'absent', derniere: null, frequenceH: 24 }; });
    },
    // À appeler depuis un clic si la permission est « prompt » (après redémarrage du navigateur).
    reautoriser: function () { return lire('dossier').then(function (h) { return permission(h, true); }); },
    echeance: function () {
      var d = lsGet(CLE_DERNIERE); if (!d) return true;
      return (Date.now() - new Date(d).getTime()) > window.IKO_SAUV.frequenceHeures() * 3600 * 1000;
    },
    // archive : objet JSON déjà collecté. Retourne le nom du fichier écrit.
    ecrire: function (archive) {
      return lire('dossier').then(function (h) {
        if (!h) throw new Error('Aucun dossier choisi.');
        return permission(h, false).then(function (p) {
          if (p !== 'granted') throw new Error('Autorisation du dossier à reconfirmer.');
          var nom = 'IKO_sauvegarde_' + horodatage() + '.json';
          return h.getFileHandle(nom, { create: true }).then(function (f) { return f.createWritable(); }).then(function (w) {
            return w.write(JSON.stringify(archive, null, 1)).then(function () { return w.close(); });
          }).then(function () { return purger(h); }).then(function () { lsSet(CLE_DERNIERE, new Date().toISOString()); return nom; });
        });
      });
    },
  };

  // Ne garde que les GARDER sauvegardes les plus récentes de ce dossier (jamais d'autres fichiers).
  function purger(h) {
    var noms = [];
    var it = h.values();
    function suivant() {
      return it.next().then(function (r) {
        if (r.done) return;
        var e = r.value;
        if (e.kind === 'file' && /^IKO_sauvegarde_\d{4}-\d{2}-\d{2}_\d{2}h\d{2}\.json$/.test(e.name)) noms.push(e.name);
        return suivant();
      });
    }
    return suivant().then(function () {
      noms.sort().reverse();
      return noms.slice(GARDER).reduce(function (p, n) { return p.then(function () { return h.removeEntry(n); }); }, Promise.resolve());
    });
  }
})();
