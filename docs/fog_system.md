# Système de Brouillard de Guerre (Fog of War)

Ce document décrit le fonctionnement technique du système de brouillard qui masque la carte et révèle les zones explorées par le joueur.

## Architecture

Le système repose sur deux composants principaux :
1.  **Store (`stores/fog.ts`)** : Gestion des données (points visités).
2.  **Composant (`FogLayer.vue`)** : Rendu visuel (Canvas).

---

## 1. Le Store (`stores/fog.ts`)

Il utilise `pinia-plugin-persistedstate` pour sauvegarder les données dans le `localStorage` du navigateur.

### Données stockées
- **`discoveredPoints`** : Un tableau d'objets `{ lat: number, lng: number }`.
- **`cloudIntensity`** : (Obsolète/Fixe) Ancien paramètre de réglage de flou.

### Fonctionnement
- À chaque mise à jour GPS, la page appelle `addPosition(lat, lng)`.
- Le store calcule la distance entre la nouvelle position et la *dernière* position enregistrée.
- Si la distance > **20 mètres**, le point est ajouté.
- **Pourquoi ?** Pour éviter de stocker 5000 points si l'utilisateur reste statique ou marche 1 mètre. Cela optimise la mémoire et la boucle de rendu.

### Implications RGPD
- Les données sont **locales** (Client-side only).
- Aucune transmission serveur.
- L'utilisateur est propriétaire de son historique de déplacement.

---

## 2. Le Rendu (`FogLayer.vue`)

Ce composant utilise l'API **Canvas 2D** HTML5 sur un calque Leaflet (`Pane`) personnalisé.

### Technique de Rendu
1.  **Z-Index** : Le calque est placé à `zIndex: 300` (au-dessus des tuiles de carte, en-dessous des marqueurs interactifs).
2.  **Texture Procédurale** : Au démarrage, on génère un motif de nuages (Seamless) dans un canvas mémoire invisible.
    - Technique : Dessin aléatoire de 400 "bouffées" (Radial Gradients) grises.
    - Avantage : Pas de chargement d'image, rendu vectoriel net, répétition parfaite.
3.  **Boucle de Dessin (`drawFog`)** :
    - On efface le canvas.
    - **Couche 1 (Nuages)** : On remplit tout l'écran avec la texture procédurale.
        - *Optimisation* : Utilisation de `DOMMatrix` pour l'effet "Atmosphère" (les nuages restent fixes par rapport à l'écran, la carte glisse dessous).
    - **Couche 2 (Découverte)** : On utilise `globalCompositeOperation = 'destination-out'`.
        - Cela agit comme une "gomme".
        - On itère sur `discoveredPoints`.
        - On dessine un cercle transparent pour chaque point.
        - *Optimisation* : On ne dessine que les points contenus dans les limites visibles de la carte (`map.getBounds()`).

### Déclenchement du redessin
- Le redessin est branché sur les events Leaflet `moveend`, `zoomend`, `resize`, **plus** un watcher réactif (nombre de points découverts, init des zones, progressions).
- **Canvas à marge** (`CONFIG.PAD = 0.5`) : le canvas déborde d'une demi-taille d'écran de chaque côté. Pendant un glissement, Leaflet translate le calque en CSS et la marge couvre les bords : le brouillard suit le doigt **sans être redessiné**. Sur `move`, on ne redessine que si l'écran sort de la zone dessinée (`onMapMove`) ; `moveend` recentre la marge. Même principe que le `padding` des renderers Leaflet.
- **`zoom` (continu) est volontairement exclu** : le canvas porte la classe `leaflet-zoom-animated`, Leaflet applique lui-même la transformation d'échelle pendant l'animation de zoom ; un redraw en plein zoom entrerait en conflit avec cette transformation. On recale donc au `zoomend`.
- **Coalescing rAF (`scheduleFogRedraw`)** : tous les déclencheurs (events carte + watcher) passent par un `requestAnimationFrame` mutualisé → **au plus un `drawFog` par frame**, quel que soit le nombre d'events reçus au même tick. Combiné à la marge, un glissement ne coûte plus qu'un dessin en fin de geste, au lieu d'un par frame.

### Performance
- Le redessin reste **100 % côté client** : le tracé GPS est privé (RGPD, cf. plus haut) et le dessin dépend du viewport live — rien à déporter vers le serveur. Les leviers réels sont la marge du canvas et le coalescing rAF (ci-dessus), et le *viewport culling* (on n'itère que sur les points/zones visibles via `map.getBounds()`).
- Le goulot d'étranglement potentiel est le nombre de points dans `discoveredPoints`. Au-delà de 10 000 points, il faudra envisager une stratégie de "Rasterization" (cuire les points dans une texture de masque statique).
