# Chantiers perdus à refaire (reset conteneur, non commités)

Base de reprise : `77245a2` (feature/modules-actifs)

## 1. Correctif clavier iPad — `devis-editeur.html`
Module bloqué. Repartir d'un diagnostic terrain précis (captures d'écran, comportement clavier exact) avant tout code. Ne pas re-proposer dblclick, pointer capture ou zoom Safari — déjà tentés sans succès.

## 2. Devis assisté IA — `api/chat-dashboard.js`
Tool `generer_lignes_devis` : suggestions de lignes de devis validées server-side contre le catalogue réel, sur le modèle du Bloc 2 déjà livré côté technicien/Max (`suggerer_action`).

## 3. Analytics SAV — `api/chat-dashboard.js` + `dashboard.html`
Tool `analytics_causes_sav` : indicateurs sur les causes de tickets SAV, à afficher dans le dashboard.
