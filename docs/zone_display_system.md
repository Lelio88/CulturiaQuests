# Système d'Affichage des Zones (Frontend)

Ce document décrit l'architecture technique permettant d'afficher les contours administratifs (ComCom, Départements, Régions) sur la carte du jeu de manière performante et "Offline-First".

## 🏗️ Architecture

Le système repose sur une stratégie **Offline-First** utilisant IndexedDB pour stocker la totalité des données géographiques (~1400 zones réparties en 3 collections) côté client, évitant ainsi les chargements réseau répétitifs.

### Composants Clés

1.  **Store Pinia (`stores/zone.ts`)** : Cerveau du système, gère désormais 3 états distincts.
2.  **IndexedDB (via `idb-keyval`)** : Stockage persistant.
3.  **Page carte (`pages/map.vue`)** : Rendu visuel des contours (Canvas renderer Leaflet) et des labels (DivIcon markers), géré directement dans le script de la page.

---

## 1. Gestion des Données (Store)

### Initialisation (`init()`)
Au lancement de l'application (`app.vue`), le store s'initialise et charge parallèlement les 3 types de territoires :
1.  Vérifie la présence des données dans **IndexedDB** (`regions-data`, `departments-data`, `comcoms-data`).
2.  **Si présent** : Charge les données en mémoire instantanément (RAM).
3.  **Si absent** : Déclenche le téléchargement complet depuis l'API Strapi via 3 requêtes distinctes (ou boucles de pagination).

### Téléchargement Multi-Collection
Le store interroge désormais trois endpoints distincts :
- `/api/regions`
- `/api/departments`
- `/api/comcoms`

Chaque collection est stockée séparément pour optimiser l'accès et la gestion des relations.

---

## 2. Affichage et Performance

### Filtrage par Zoom
Les zones affichées dépendent du niveau de zoom. Le store sélectionne la collection active appropriée :

| Niveau de Zoom | Collection Active | Description |
| :--- | :--- | :--- |
| **Zoom >= 11** | `comcoms` | Communautés de Communes (Détail) |
| **Zoom 8 - 10** | `departments` | Départements (Vue régionale) |
| **Zoom < 8** | `regions` | Régions (Vue nationale) |

### Rendu Visuel
- **Contours** : Rendus via `L.geoJSON` avec un Canvas renderer Leaflet (évite les bugs SVG liés aux proxies Vue 3). Style blanc, contour gras, sans fond.
- **Labels** : Markers `L.divIcon` positionnés au centroïde de chaque zone. Affichés pour les comcoms et départements. Pour les régions, affichés uniquement si la région n'est pas complétée.

### Marqueurs POI / Musées (rendu + clustering)
Distinct du rendu des zones ci-dessus, les **POI et musées** sont rendus dans `components/map/MapMarkers.vue`. Au seuil **zoom ≥ 11** (niveau ComCom) ; sous zoom 11 aucun marqueur n'est affiché ni chargé (chargement par tuiles coupé, cf. `map.vue` `loadVisibleEntities`) — la France entière reste lisible.

Le regroupement se fait via `leaflet.markercluster` (`L.markerClusterGroup`, `buildMarkersLayer`) : les POI/musées proches forment une **bulle comptée** qui se scinde au zoom et redevient des marqueurs individuels au plus près (`disableClusteringAtZoom: 16`). Un **fallback `L.layerGroup`** reste en place si le plugin échoue → les POI s'affichent toujours, sans regroupement. `renderMarkers` est aussi enveloppé d'un filet et les `removeLayer`/`clearLayers` sont défensifs.

**Prérequis — instance Leaflet unique** : le clustering ne fonctionne que parce que `<LMap :use-global-leaflet="true">` (map.vue) fait partager la **même instance Leaflet** à vue-leaflet, `MapMarkers` et le plugin. Avec `use-global-leaflet="false"`, vue-leaflet bâtissait la carte sur `leaflet/dist/leaflet-src.esm` et le plugin sur `leaflet` (main) → **deux instances distinctes** → l'ajout d'un `MarkerClusterGroup` throwait au runtime et faisait disparaître **tous** les POI. **Ne jamais repasser `use-global-leaflet` à `false`.**

Le **point bleu** de l'utilisateur est un marqueur Leaflet **natif** (`L.marker`, ajouté directement à la carte, hors `markersLayer`), et non un composant Vue `<LMarker>` : ce dernier ne s'initialisait pas de façon fiable et ses mises à jour à chaque tick GPS déclenchaient le bug `_leaflet_events`.

---

## 3. Configuration Requise (Backend)

Le système attend désormais 3 Content-Types distincts avec des relations hiérarchiques :

### 1. Region (`api::region.region`)
- `name` (String)
- `code` (String, Unique)
- `geometry` (JSON GeoJSON)
- `is_completed` (Boolean, def: false)
- `departments` (Relation: One-to-Many)

### 2. Department (`api::department.department`)
- `name` (String)
- `code` (String, Unique)
- `geometry` (JSON GeoJSON)
- `is_completed` (Boolean, def: false)
- `region` (Relation: Many-to-One)
- `comcoms` (Relation: One-to-Many)

### 3. Comcom (`api::comcom.comcom`)
- `name` (String)
- `code` (String, Unique)
- `geometry` (JSON GeoJSON)
- `is_completed` (Boolean, def: false)
- `department` (Relation: Many-to-One)

**Permissions** : `find`/`findOne` sur ces 3 collections sont accordés aux rôles **Public** ET **Authenticated** au bootstrap (`backend/src/index.ts`). Le chargement passe par le proxy BFF (`frontend/server/api/strapi/[...path].ts`), qui relaie ces GET **sans Bearer** (`PUBLIC_GET_PATHS`) → Strapi évalue le rôle **Public**. Ne pas retirer ce grant : sans lui, `regions/comcoms/departments` renvoient 401/403 → carte sans contours et badges de zone vides (cf. régression du commit `7899ab8`, corrigée en rendant les zones publiques bout-en-bout).
