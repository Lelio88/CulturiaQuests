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
import type { Museum } from '~/types/museum'
import type { Poi } from '~/types/poi'
import { useVisitStore } from '~/stores/visit'
import { calculateDistance } from '~/utils/geolocation'

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

// Flag pour désactiver le LMarker Vue avant la destruction de la carte
const isActive = ref(true)

// LayerGroup natif pour les performances
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

const renderMarkers = () => {
  const rawMap = toRaw(props.map)
  if (!rawMap) return
  if (!markersLayer) markersLayer = L.layerGroup().addTo(rawMap)

  // Zoom trop faible : on retire tout (une seule fois)
  if (props.zoom < 11) {
    if (markerById.size) { markersLayer.clearLayers(); markerById.clear() }
    return
  }

  const RADIUS_KM = 10
  const desired = new Set<string>()

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
    if (calculateDistance(props.userLat, props.userLng, m.lat, m.lng) > RADIUS_KM) return
    const iconUrl = `/assets/map/museum/${m.tags?.[0]?.name || 'Art'}.webp`
    ensure(`m-${m.id}`, m.lat, m.lng, iconUrl, () => emit('select-museum', m))
  })

  props.pois.forEach(p => {
    if (!p.lat || !p.lng) return
    if (calculateDistance(props.userLat, props.userLng, p.lat, p.lng) > RADIUS_KM) return
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

// Réactivité Optimisée
// On ne redessine que si les données changent ou si on franchit le seuil de zoom 11
const isZoomVisible = computed(() => props.zoom >= 11)

watch(() => [props.museums, props.pois, isZoomVisible.value, props.userLat, props.userLng], renderMarkers)

// Watch spécifique pour l'état des coffres
watch(() => visitStore.visits.length, renderMarkers)
</script>
