<template>
  <!-- Marqueur position utilisateur (Géré par Vue car unique et très dynamique) -->
  <!-- isActive empêche LMarker d'essayer un removeLayer sur une carte déjà détruite -->
  <LMarker v-if="isActive" :lat-lng="[userLat, userLng]">
    <LIcon
      icon-url="/assets/map/userpoint.svg"
      :icon-size="[20, 20]"
      :icon-anchor="[10, 10]"
    />
  </LMarker>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, toRaw, computed } from 'vue'
import L from 'leaflet'
// Plugin de clustering : augmente `L` avec `L.markerClusterGroup`/`L.MarkerClusterGroup`. Import
// en side-effect APRÈS leaflet (dépendance déjà chargée). Ce composant n'est rendu que côté client
// (map.vue le monte sous <ClientOnly> via v-if="isMapReady") ; le module markercluster ne touche pas
// au DOM à l'import (il ne fait qu'étendre L), donc l'import statique reste SSR-safe.
import 'leaflet.markercluster'
import type { Museum } from '~/types/museum'
import type { Poi } from '~/types/poi'
import { useVisitStore } from '~/stores/visit'

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

// Noms d'icônes de catégorie musée disponibles (fichiers /assets/map/museum/<nom>.webp).
const MUSEUM_ICON_NAMES = ['Art', 'History', 'Make', 'Nature', 'Science', 'Society']

// Flag pour désactiver le LMarker Vue avant la destruction de la carte
const isActive = ref(true)

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

// --- RENDERING ---

// Crée la couche de marqueurs : clustering si possible, sinon layerGroup. Avec use-global-leaflet=false,
// la carte (vue-leaflet → leaflet-src.esm) et le plugin markercluster (leaflet « main ») peuvent être
// sur deux instances Leaflet distinctes → un MarkerClusterGroup peut throw à l'ajout. On tente une fois ;
// au moindre échec on bascule définitivement sur layerGroup (POI garantis, sans regroupement visuel).
const buildMarkersLayer = (rawMap: L.Map): L.LayerGroup => {
  // ⚠️ Clustering DÉSACTIVÉ au runtime (repli layerGroup fiable = comportement d'avant le clustering).
  // Raison : avec use-global-leaflet=false, un MarkerClusterGroup (instance leaflet main) ajouté sur
  // une carte (instance leaflet-src.esm de vue-leaflet) échoue ; pire, l'option `chunkedLoading`
  // traite une partie des ajouts en ASYNCHRONE (setTimeout) → l'erreur n'est PAS rattrapable par un
  // try/catch synchrone et fait disparaître tous les POI. On force donc layerGroup. Réactiver
  // markerClusterGroup UNIQUEMENT après avoir unifié les instances Leaflet (dedupe/alias Vite dans
  // nuxt.config) ET vérifié AU NAVIGATEUR (le build/typecheck ne détecte pas ce bug runtime).
  // Cf. docs/zone_display_system.md.
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
    if (markerById.size) { markersLayer.clearLayers(); markerById.clear() }
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
    // tags est un string[] (noms). L'ancien `m.tags?.[0]?.name` valait toujours undefined →
    // tous les musées affichaient Art.webp. On mappe le 1er tag sur une icône existante
    // (repli Art), jamais de 404 si le nom ne correspond à aucun fichier.
    const t = m.tags?.[0]
    const icon = t && MUSEUM_ICON_NAMES.includes(t) ? t : 'Art'
    const iconUrl = `/assets/map/museum/${icon}.webp`
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
      markersLayer!.removeLayer(marker)
      markerById.delete(key)
    }
  }
}

// --- LIFECYCLE ---

onMounted(() => {
  if (props.map) renderMarkers()
})

function cleanup() {
  if (markersLayer && props.map) {
    const rawMap = toRaw(props.map)
    try { rawMap.removeLayer(markersLayer) } catch (_) { /* ignore */ }
    markersLayer = null
  }
  markerById.clear()
}

defineExpose({ cleanup })

onBeforeUnmount(() => {
  // Désactiver le LMarker Vue AVANT que la carte soit détruite
  // Cela permet à Vue de faire un unmount propre du LMarker pendant que le map est encore intact
  isActive.value = false
  cleanup()
})

// Réactivité
// Les listes (props.museums/props.pois) sont déjà filtrées par viewport dans le parent (map.vue) :
// on redessine quand elles changent ou quand on franchit le seuil de zoom 11.
// userLat/userLng est conservé dans le watch NON pour filtrer (l'affichage suit le viewport) mais
// comme SONDE temporelle bon marché : à chaque fix GPS, renderMarkers ré-évalue isChestAvailable
// (dépendant du temps — cooldown 24 h) → l'icône d'un coffre redevenu ouvrable se met à jour même
// carte immobile. Le diff incrémental (markerById) rend ce re-render quasi gratuit.
const isZoomVisible = computed(() => props.zoom >= 11)

watch(() => [props.museums, props.pois, isZoomVisible.value, props.userLat, props.userLng], renderMarkers)

// Watch spécifique pour l'état des coffres
watch(() => visitStore.visits.length, renderMarkers)
</script>
