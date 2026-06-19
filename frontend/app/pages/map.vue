<template>
  <div class="min-h-screen bg-gray-100 font-sans">
    <main class="h-[100vh] w-full relative">
      <!-- Geolocation request -->
      <GeolocationRequest
        @allow="handleGeolocationAllow"
        @deny="handleGeolocationDeny"
      />

      <!-- Loading state -->
      <MapLoadingState :loading="geolocLoading">
        Localisation en cours...
      </MapLoadingState>

      <!-- Carte Leaflet -->
      <ClientOnly>
        <LMap
          ref="mapRef"
          v-model:zoom="currentZoom"
          :center="[userLat, userLng]"
          :use-global-leaflet="false"
          :zoom-control="false"
          :max-zoom="20"
          class="h-full w-full"
          @ready="onMapReady"
          @moveend="onMapMove"
        >
          <!-- Tile layer ajoutée programmatiquement dans onMapReady pour maxNativeZoom -->

          <!-- Zones et Labels gérés via le composable useZoneRenderer (zoneLayers) -->

          <!-- Marqueurs extraits (Optimisé JS pur) -->
          <MapMarkers
            v-if="isMapReady"
            ref="mapMarkersRef"
            :map="mapRef?.leafletObject"
            :museums="validMuseums"
            :pois="validPOIs"
            :user-lat="userLat"
            :user-lng="userLng"
            :zoom="currentZoom"
            @select-museum="selectItem"
            @select-poi="selectItem"
          />

          <!-- Brouillard de guerre -->
          <FogLayer v-if="isMapReady" ref="fogLayerRef" :map="mapRef?.leafletObject" />
        </LMap>
      </ClientOnly>

      <!-- Drawer Information -->
      <BottomDrawer v-model="isDrawerOpen">
        <MapDrawerContent
          :selected-item="selectedItem"
          :guild-characters="guildCharacters"
          :distance-to-user="distanceToSelectedItem"
          :user-lat="userLat"
          :user-lng="userLng"
          @start-expedition="handleStartExpedition"
        />
      </BottomDrawer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type * as Leaflet from 'leaflet' // Type only import for SSR safety
import { useMuseumStore } from '~/stores/museum'
import { usePOIStore } from '~/stores/poi'
import { useGuildStore } from '~/stores/guild'
import { useRunStore } from '~/stores/run'
import { useFogStore } from '~/stores/fog'
import { useZoneStore } from '~/stores/zone'
import { useProgressionStore } from '~/stores/progression'
import { useGeolocation } from '~/composables/useGeolocation'
import { useMapInteraction } from '~/composables/useMapInteraction'
import { useZoneCompletion } from '~/composables/useZoneCompletion'
import { useZoneRenderer } from '~/composables/useZoneRenderer'
import { calculateDistance } from '~/utils/geolocation'
import MapMarkers from '~/components/map/MapMarkers.vue'
import FogLayer from '~/components/map/FogLayer.vue'
import type { Museum } from '~/types/museum'
import type { Poi } from '~/types/poi'

type LocationItem = Museum | Poi

definePageMeta({
  layout: 'default',
})

// Stores
const museumStore = useMuseumStore()
const poiStore = usePOIStore()
const guildStore = useGuildStore()
const runStore = useRunStore()
const fogStore = useFogStore()
const zoneStore = useZoneStore()
const progressionStore = useProgressionStore()

// Composables
const geolocation = useGeolocation({
  defaultLat: 49.1167,  // Saint-Lô
  defaultLng: -1.0833,
  reloadThresholdKm: 5
})

const mapInteraction = useMapInteraction()
const zoneCompletion = useZoneCompletion()

// Refs
// mapRef = instance du composant LMap (vue-leaflet) ; son `.leafletObject` est la Leaflet.Map.
const mapRef = ref<{ leafletObject?: Leaflet.Map } | null>(null)
const fogLayerRef = ref<InstanceType<typeof FogLayer> | null>(null)
const mapMarkersRef = ref<InstanceType<typeof MapMarkers> | null>(null)
const currentZoom = ref(16)
const mapBounds = ref<Leaflet.LatLngBounds | null>(null) // Limites visibles de la carte
const isMapReady = ref(false) // Flag de sécurité pour l'initialisation
const selectedItem = ref<LocationItem | null>(null)
const isDrawerOpen = ref(false)

// Leaflet Library (Loaded dynamically)
let L: typeof Leaflet

// Debounce helpers (cycle de vie carte)
let moveDebounceTimer: ReturnType<typeof setTimeout> | null = null
let mapReadyTimer: ReturnType<typeof setTimeout> | null = null

// Computed - Zones visibles selon le zoom ET la zone visible (BBOX)
const visibleZones = computed(() => {
  const zones = zoneStore.getZonesForZoom(currentZoom.value)
  
  // Optimisation BBOX : On n'affiche que ce qui est à l'écran pour les Comcoms (Zoom >= 11)
  if (currentZoom.value >= 11 && mapBounds.value) {
    // On ajoute une marge (pad) virtuelle de 10% pour que les zones ne "popent" pas
    const bounds = mapBounds.value
    return zones.filter(z => {
      // Si pas de centre, on affiche dans le doute
      if (!z.centerLat || !z.centerLng) return true
      
      // Leaflet bounds.contains([lat, lng])
      return bounds.contains([z.centerLat, z.centerLng])
    })
  }
  
  // Si pas de bounds (chargement) ou zoom faible, on affiche tout (ou par distance sécu)
  return zones
})

// Rendu des zones/labels délégué au composable dédié (#46). Accès paresseux à la carte/lib
// Leaflet (non disponibles en SSR / avant onMapReady).
const zoneLayers = useZoneRenderer({
  // cast: @types/leaflet perd la polymorphie `this` quand Map est annoté en propriété.
  getMap: () => mapRef.value?.leafletObject as Leaflet.Map | undefined,
  getL: () => L,
  isMapReady,
  currentZoom,
  visibleZones,
})

watch([visibleZones, isMapReady], () => {
  zoneLayers.updateMapLayers()
}, { deep: false })

// Computed - Guild characters
const guildCharacters = computed(() => {
  const guild = guildStore.guild
  if (!guild) return []

  // Support structure Strapi v4/v5
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charactersData = guild.attributes?.characters || (guild as any).characters
  if (!charactersData) return []

  const chars = charactersData.data || charactersData
  return Array.isArray(chars) ? chars : []
})

// Computed - Valid markers (filtrer les coordonnées invalides ET distance)
// On utilise directement le store qui contient TOUS les items chargés
// Affiche uniquement si le zoom permet de voir les Comcoms (>= 11)
const RADIUS_KM = 20

// Pré-filtre boîte englobante (arithmétique simple) AVANT le Haversine coûteux : on évite
// de calculer la distance trigonométrique sur les ~5478 entités à chaque fix GPS. La boîte
// (demi-largeurs dLat/dLng) contient strictement le cercle de rayon RADIUS_KM → résultat
// identique au filtre Haversine seul, mais sans trigo sur les entités manifestement hors zone.
function makeRadiusFilter(lat: number, lng: number) {
  // 110.574 = km par degré de latitude MINIMAL (à l'équateur). L'utiliser (au lieu de
  // ~111.32) rend la boîte légèrement plus GRANDE que le cercle → garantit aucun faux
  // négatif quelle que soit la latitude (le résultat reste identique au Haversine seul).
  const KM_PER_DEG = 110.574
  const dLat = RADIUS_KM / KM_PER_DEG
  const cos = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 1e-6)
  const dLng = RADIUS_KM / (KM_PER_DEG * cos)
  return (eLat?: number, eLng?: number): boolean => {
    if (eLat === undefined || eLng === undefined) return false
    if (Math.abs(eLat - lat) > dLat || Math.abs(eLng - lng) > dLng) return false // hors boîte → skip Haversine
    return calculateDistance(lat, lng, eLat, eLng) <= RADIUS_KM
  }
}

const validMuseums = computed<Museum[]>(() => {
  if (currentZoom.value < 11) return []
  const inRadius = makeRadiusFilter(userLat.value, userLng.value)
  return museumStore.museums.filter((m) => inRadius(m.lat, m.lng))
})

const validPOIs = computed<Poi[]>(() => {
  if (currentZoom.value < 11) return []
  const inRadius = makeRadiusFilter(userLat.value, userLng.value)
  return poiStore.pois.filter((p) => inRadius(p.lat, p.lng))
})

// Computed - Distance to selected item
const distanceToSelectedItem = computed<number>(() => {
  if (!selectedItem.value) return 0

  const itemLat = selectedItem.value.lat
  const itemLng = selectedItem.value.lng

  if (itemLat === undefined || itemLng === undefined) return 0

  return calculateDistance(userLat.value, userLng.value, itemLat, itemLng)
})

// Destructure geolocation state
const { userLat, userLng, geolocLoading } = geolocation

// Handlers
function handleGeolocationAllow(): void {
  geolocation.startTracking()
}

function handleGeolocationDeny(): void {
  // Silencieux — les coords par défaut sont utilisées
}

// Mise à jour des limites visibles (BBOX) — debounced pour éviter les cascades réactives
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onMapMove(e?: any) {
  if (moveDebounceTimer) clearTimeout(moveDebounceTimer)
  moveDebounceTimer = setTimeout(() => {
    const map = mapRef.value?.leafletObject || e?.target
    if (map && map.getBounds) {
      mapBounds.value = map.getBounds().pad(0.2)
    }
  }, 150)
}

// Initialisation des bounds au chargement
function onMapReady() {
  // Init immédiat des bounds (pas de debounce au premier chargement)
  const map = mapRef.value?.leafletObject
  if (map?.getBounds) {
    mapBounds.value = map.getBounds().pad(0.2)
  }

  // Patch Leaflet map.remove() pour absorber les erreurs internes pendant le teardown.
  // vue-leaflet appelle map.remove() dans LMap.beforeUnmount, mais Leaflet peut throw
  // quand des layers/handlers référencent des éléments DOM déjà détruits
  // (ex: Marker._removeIcon → DomEvent.off(this._icon) avec _icon undefined).
  if (map) {
    // Monkey-patch d'un internal Leaflet (cleanup tolérant) : accès volontairement non typé.
    const mapAny = map as any
    const originalRemove = mapAny.remove
    mapAny.remove = function () {
      try {
        return originalRemove.call(this)
      } catch (_) {
        // Erreur de cleanup Leaflet pendant navigation — inoffensive
      }
    }
  }

  mapReadyTimer = setTimeout(() => {
    mapReadyTimer = null
    const m = mapRef.value?.leafletObject as Leaflet.Map | undefined
    if (!m) return // La carte a déjà été détruite (navigation rapide)
    m.zoomControl?.remove()
    m.invalidateSize()

    // Ajout de la tile layer programmatiquement pour supporter maxNativeZoom
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 20,
      maxNativeZoom: 18
    }).addTo(m)

    isMapReady.value = true
    zoneLayers.updateMapLayers()
  }, 100)
}

function selectItem(item: LocationItem) {
  selectedItem.value = item
  isDrawerOpen.value = true
  mapInteraction.flyToItem(mapRef.value, item)
}

async function handleStartExpedition() {
  if (!selectedItem.value) return

  const museumId = selectedItem.value.documentId
  if (!museumId) {
    console.error("Museum has no documentId")
    return
  }

  try {
    const result = await runStore.startExpedition(museumId, userLat.value, userLng.value)

    if (result.questRolled) {
      navigateTo('/npc-interaction')
    } else {
      navigateTo('/expedition')
    }
  } catch (e: any) {
    console.error('Failed to start expedition:', e)
  }
}

// Fetch ALL locations (Global load)
async function fetchAllLocations(): Promise<void> {
  // init() gère automatiquement le cache IndexedDB et le fetch paginé si besoin
  await Promise.all([
    museumStore.init(),
    poiStore.init()
  ])
}

// Register geolocation callbacks
geolocation.registerCallbacks({
  onFirstPosition: (lat, lng) => {
    if (mapRef.value?.leafletObject) {
      mapInteraction.flyToCoords(mapRef.value, lat, lng, 13, 1.5)
    }
    fogStore.addPosition(lat, lng)
    zoneCompletion.checkFogCoverage(lat, lng)
  },
  onPositionUpdate: (lat, lng) => {
    fogStore.addPosition(lat, lng)
    zoneCompletion.checkFogCoverage(lat, lng)
  },
})

// Lifecycle
onMounted(async () => {
  // IMPORT DYNAMIQUE POUR ÉVITER SSR ERROR
  const leafletModule = await import('leaflet')
  L = leafletModule.default || leafletModule

  // Garde : la guilde est chargée au login (et persistée) → pas de re-fetch profond à
  // chaque arrivée sur la carte (navigation). On ne (re)charge que si elle est absente.
  if (!guildStore.guild) await guildStore.fetchAll()
  await fetchAllLocations() // Chargement global au démarrage
  
  // Optimisation Fog: Nettoyage des points dans les régions complétées
  // Note: zoneStore est initialisé dans app.vue via zoneStore.init(), pas par fetchAllLocations
  if (zoneStore.regions.length > 0) {
    const completedRegions = zoneStore.regions.filter(r => 
      progressionStore.isRegionCompleted(r.documentId || r.id.toString())
    )
    if (completedRegions.length > 0) {
      fogStore.removePointsInZones(completedRegions)
    }
  }
})

// onBeforeUnmount : nettoyer AVANT que LMap.beforeUnmount détruise la carte Leaflet
// Si on attend onUnmounted, le map est déjà détruit → "_leaflet_events undefined"
onBeforeUnmount(() => {
  // 1. Nettoyer les composants enfants qui tiennent des ressources Leaflet
  // DOIT se faire avant isMapReady = false (les refs existent encore)
  try { fogLayerRef.value?.cleanup() } catch (_) { /* ignore */ }
  try { mapMarkersRef.value?.cleanup() } catch (_) { /* ignore */ }

  // 2. Bloquer tout nouveau rendu immédiatement
  isMapReady.value = false

  // Annuler les timers de cycle de vie carte en attente
  if (moveDebounceTimer) {
    clearTimeout(moveDebounceTimer)
    moveDebounceTimer = null
  }
  if (mapReadyTimer) {
    clearTimeout(mapReadyTimer)
    mapReadyTimer = null
  }

  // Annule le rAF en attente + supprime layer/renderer/labels des zones pendant que la carte
  // existe encore (le composable détient cet état, #46).
  zoneLayers.cleanup()
})

</script>

<style>
.zone-label-icon {
  background: transparent;
  border: none;
}

.text-shadow-outline {
  text-shadow: 
    -1px -1px 0 #000,  
     1px -1px 0 #000,
    -1px  1px 0 #000,
     1px  1px 0 #000;
}
</style>