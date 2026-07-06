<template>
  <!-- Aucun rendu Vue : POI/musées ET point utilisateur sont des couches Leaflet NATIVES gérées en
       JS (renderMarkers / renderUserMarker). L'ancien <LMarker> Vue du point utilisateur a été retiré :
       avec use-global-leaflet=false il ne s'initialisait pas de façon fiable (point bleu invisible) et
       ses mises à jour à chaque fix GPS déclenchaient le bug Leaflet « _leaflet_events undefined ». -->
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, toRaw, computed } from 'vue'
import L from 'leaflet'
// Plugin de clustering : augmente `L` avec `L.markerClusterGroup`/`L.MarkerClusterGroup`. Import
// en side-effect APRÈS leaflet (dépendance déjà chargée). Ce composant n'est rendu que côté client
// (map.vue le monte sous <ClientOnly> via v-if="isMapReady") ; le module markercluster ne touche pas
// au DOM à l'import (il ne fait qu'étendre L), donc l'import statique reste SSR-safe.
import 'leaflet.markercluster'
import type { Museum } from '~/types/museum'
import type { Poi } from '~/types/poi'
import { useVisitStore } from '~/stores/visit'
import { museumIconFile } from '~/utils/museumIcon'

const visitStore = useVisitStore()

const props = defineProps<{
  museums: Museum[]
  pois: Poi[]
  userLat: number
  userLng: number
  zoom: number
  map: any // Instance Leaflet
}>()

const emit = defineEmits<{
  'select-museum': [museum: Museum]
  'select-poi': [poi: Poi]
}>()

// Marqueur natif de la position utilisateur (point bleu). Ajouté DIRECTEMENT à la carte (pas dans
// markersLayer) pour rester visible même sous le seuil de zoom qui masque les POI, et pour ne pas être
// balayé par le clearLayers du gate zoom.
let userMarker: L.Marker | null = null
const userIcon = L.icon({ iconUrl: '/assets/map/userpoint.svg', iconSize: [20, 20], iconAnchor: [10, 10] })

// Couche des marqueurs POI/musées : clustering (leaflet.markercluster) si disponible, sinon repli
// sur un simple layerGroup (voir renderMarkers). Type LayerGroup = base commune aux deux :
// addLayer/removeLayer/clearLayers sont identiques, donc le diff incrémental markerById reste inchangé.
let markersLayer: L.LayerGroup | null = null
// Marqueurs vivants indexés par clé stable (id + état) → mise à jour incrémentale (diff)
// au lieu de clearLayers()+recréation complète à chaque fix GPS.
const markerById = new Map<string, L.Marker>()

// --- ICONS CACHE ---
const iconCache = new Map<string, L.Icon>()

function getIcon(url: string, size: [number, number], anchor: [number, number]): L.Icon {
  if (!iconCache.has(url)) {
    iconCache.set(url, L.icon({
      iconUrl: url,
      iconSize: size,
      iconAnchor: anchor,
      popupAnchor: [0, -size[1]]
    }))
  }
  return iconCache.get(url)!
}

function getChestIconUrl(poi: Poi): string {
  const poiId = poi.id || poi.documentId
  return visitStore.isChestAvailable(poiId)
    ? '/assets/map/chest.png'
    : '/assets/map/chest-opened.png'
}

// Crée (une fois) puis repositionne le point bleu de l'utilisateur. Marqueur natif non interactif,
// au-dessus des autres (zIndexOffset). Robuste : un échec ici n'affecte pas le rendu des POI.
function renderUserMarker(): void {
  const rawMap = toRaw(props.map)
  if (!rawMap) return
  if (props.userLat == null || props.userLng == null) return
  const pos: [number, number] = [props.userLat, props.userLng]
  try {
    if (!userMarker) {
      userMarker = L.marker(pos, { icon: userIcon, interactive: false, zIndexOffset: 1000 }).addTo(rawMap)
    } else {
      userMarker.setLatLng(pos)
    }
  } catch (e) {
    console.warn('[MapMarkers] rendu point utilisateur échoué', e)
  }
}

// --- RENDERING ---

// Crée la couche de marqueurs : clustering si possible, sinon layerGroup. Avec use-global-leaflet=false,
// la carte (vue-leaflet → leaflet-src.esm) et le plugin markercluster (leaflet « main ») peuvent être
// sur deux instances Leaflet distinctes → un MarkerClusterGroup peut throw à l'ajout. On tente une fois ;
// au moindre échec on bascule définitivement sur layerGroup (POI garantis, sans regroupement visuel).
const buildMarkersLayer = (rawMap: L.Map): L.LayerGroup => {
  // Clustering des POI/musées via leaflet.markercluster. Fonctionne car `use-global-leaflet="true"`
  // (map.vue) : vue-leaflet, MapMarkers et le plugin partagent alors la MÊME instance Leaflet. Sans
  // ça (ancien use-global-leaflet=false), la carte (build esm) et le MarkerClusterGroup (build main)
  // étaient deux instances distinctes → l'ajout throwait au runtime et faisait disparaître les POI.
  // Fallback layerGroup si le plugin est absent/échoue : les POI restent affichés (sans regroupement).
  if (typeof (L as unknown as { markerClusterGroup?: unknown }).markerClusterGroup === 'function') {
    try {
      const cluster = L.markerClusterGroup({
        maxClusterRadius: 60,        // rayon d'agrégation (px)
        showCoverageOnHover: false,  // pas de polygone d'emprise au survol (mobile)
        spiderfyOnMaxZoom: true,     // éclate les marqueurs superposés au zoom max
        disableClusteringAtZoom: 16, // marqueurs individuels au plus près (rue)
      })
      cluster.addTo(rawMap)
      return cluster
    } catch (e) {
      console.warn('[MapMarkers] clustering indisponible, repli layerGroup', e)
    }
  }
  const lg = L.layerGroup()
  lg.addTo(rawMap)
  return lg
}

// Point d'entrée du rendu : enveloppe renderMarkersInner d'un filet défensif. Si le rendu échoue pour
// une raison inattendue, on détruit la couche et on re-render → on évite qu'une exception avalée dans
// un watcher Vue ne laisse une carte muette (l'ancien bug du clustering : throw non attrapé = 0 POI).
const renderMarkers = () => {
  try {
    renderMarkersInner()
  } catch (e) {
    console.warn('[MapMarkers] rendu échoué, reconstruction de la couche', e)
    const rawMap = toRaw(props.map)
    if (markersLayer && rawMap) { try { rawMap.removeLayer(markersLayer) } catch (_) { /* ignore */ } }
    markersLayer = null
    markerById.clear()
    try { renderMarkersInner() } catch (e2) { console.error('[MapMarkers] rendu impossible', e2) }
  }
}

const renderMarkersInner = () => {
  const rawMap = toRaw(props.map)
  if (!rawMap) return
  if (!markersLayer) markersLayer = buildMarkersLayer(rawMap)

  // Zoom trop faible : on retire tout (une seule fois)
  if (props.zoom < 11) {
    if (markerById.size) {
      try { markersLayer.clearLayers() } catch (_) { /* icône déjà détachée (bug leaflet _leaflet_events) */ }
      markerById.clear()
    }
    return
  }

  const desired = new Set<string>()

  // Le périmètre d'affichage (viewport) est décidé par le parent (`map.vue` → validMuseums /
  // validPOIs filtrés sur `mapBounds`). Ici on ne rejette QUE les coordonnées invalides : plus
  // de filtre rayon ancré sur la position GPS (il masquait tout dès que le joueur était loin de
  // la zone de contenu, cf. fix #bug-carte). L'interaction reste géo-clôturée côté serveur.

  // Crée le marqueur seulement s'il n'existe pas déjà (diff incrémental).
  const ensure = (key: string, lat: number, lng: number, iconUrl: string, onClick: () => void) => {
    desired.add(key)
    if (markerById.has(key)) return
    const marker = L.marker([lat, lng], { icon: getIcon(iconUrl, [32, 24], [16, 12]) })
    marker.on('click', onClick)
    markersLayer!.addLayer(marker)
    markerById.set(key, marker)
  }

  props.museums.forEach(m => {
    if (!m.lat || !m.lng) return
    // Icône = 1re catégorie du musée mappée sur un fichier existant via museumIconFile (catégorie FR
    // → fichier EN, ex. « Histoire » → History ; repli 'Art'). Jamais de 404, et bonne icône affichée.
    const iconUrl = `/assets/map/museum/${museumIconFile(m.tags?.[0])}.webp`
    ensure(`m-${m.id}`, m.lat, m.lng, iconUrl, () => emit('select-museum', m))
  })

  props.pois.forEach(p => {
    if (!p.lat || !p.lng) return
    // L'état du coffre fait partie de la clé → ouverture/fermeture = nouveau marqueur (bonne icône)
    const available = visitStore.isChestAvailable(p.id || p.documentId)
    ensure(`p-${p.id}-${available ? 1 : 0}`, p.lat, p.lng, getChestIconUrl(p), () => emit('select-poi', p))
  })

  // Retirer uniquement les marqueurs qui ne sont plus voulus (sortis du rayon / coffre changé)
  for (const [key, marker] of markerById) {
    if (!desired.has(key)) {
      try { markersLayer!.removeLayer(marker) } catch (_) { /* icône déjà détachée (bug leaflet _leaflet_events) */ }
      markerById.delete(key)
    }
  }
}

// --- LIFECYCLE ---

onMounted(() => {
  if (props.map) { renderMarkers(); renderUserMarker() }
})

function cleanup() {
  const rawMap = props.map ? toRaw(props.map) : null
  if (markersLayer && rawMap) {
    try { rawMap.removeLayer(markersLayer) } catch (_) { /* ignore */ }
    markersLayer = null
  }
  if (userMarker && rawMap) {
    try { rawMap.removeLayer(userMarker) } catch (_) { /* ignore */ }
    userMarker = null
  }
  markerById.clear()
}

defineExpose({ cleanup })

onBeforeUnmount(() => {
  cleanup()
})

// Réactivité
// Les listes (props.museums/props.pois) sont déjà filtrées par viewport dans le parent (map.vue) :
// on redessine quand elles changent ou quand on franchit le seuil de zoom 11.
//
// userLat/userLng NE SONT PLUS dans ce watch. Auparavant ils y étaient comme « sonde temporelle »
// pour ré-évaluer isChestAvailable (cooldown 24 h) à chaque fix GPS — mais avec une géoloc active,
// chaque tick relançait renderMarkers → removeLayer/clearLayers en boucle → bug Leaflet
// « _leaflet_events undefined » attrapé par le filet → reconstruction de la couche → clignotement
// des POI. La disponibilité des coffres est déjà ré-évaluée au watch visits (ouverture) et à chaque
// changement de POI (déplacement de carte), ce qui suffit largement.
const isZoomVisible = computed(() => props.zoom >= 11)

watch(() => [props.museums, props.pois, isZoomVisible.value], renderMarkers)

// Watch spécifique pour l'état des coffres
watch(() => visitStore.visits.length, renderMarkers)

// Le point bleu suit la position en continu — opération légère (un simple setLatLng), séparée du
// rendu des POI pour ne jamais le perturber.
watch(() => [props.userLat, props.userLng], renderUserMarker)
</script>
