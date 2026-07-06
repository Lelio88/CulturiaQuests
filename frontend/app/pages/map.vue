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

      <!-- Indicateur discret de chargement des lieux (déport bbox : fetch de la zone visible) -->
      <div
        v-if="poiStore.loading || museumStore.loading"
        class="absolute left-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[1000] -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white pointer-events-none"
      >
        Chargement des lieux…
      </div>

      <!-- Carte Leaflet -->
      <ClientOnly>
        <LMap
          ref="mapRef"
          v-model:zoom="currentZoom"
          :center="mapCenter"
          :use-global-leaflet="true"
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

// Dernière position connue (localStorage) → au rechargement, la carte s'ouvre LÀ où le joueur était,
// pas sur Saint-Lô : évite le flash « Saint-Lô » au démarrage le temps du 1er fix GPS. Repli Saint-Lô
// au tout premier lancement (aucune position mémorisée). Guard client : pas de localStorage en SSR.
const LAST_POSITION_KEY = 'cq_last_position'
function readLastPosition(): { lat: number; lng: number } {
  if (import.meta.client) {
    try {
      const raw = localStorage.getItem(LAST_POSITION_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        if (Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) return { lat: p.lat, lng: p.lng }
      }
    } catch { /* JSON invalide / storage indisponible → repli défaut */ }
  }
  return { lat: 49.1167, lng: -1.0833 } // Saint-Lô
}
function saveLastPosition(lat: number, lng: number): void {
  if (import.meta.client) {
    try { localStorage.setItem(LAST_POSITION_KEY, JSON.stringify({ lat, lng })) } catch { /* quota / private */ }
  }
}
const initialPos = readLastPosition()

// Composables
const geolocation = useGeolocation({
  defaultLat: initialPos.lat,
  defaultLng: initialPos.lng,
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
// Centre de la carte DÉCOUPLÉ de la position live du joueur. Initialisé sur la DERNIÈRE position connue
// (initialPos, cf. readLastPosition) plutôt que Saint-Lô en dur, puis recentré UNE SEULE FOIS sur le
// joueur au 1er fix GPS (voir onFirstPosition). Auparavant `:center="[userLat, userLng]"` suivait la
// position en continu → chaque tick GPS ramenait la carte sur le joueur, empêchant d'explorer les
// environs et faisant « disparaître » les POI regardés. Le point bleu suit la position (dans MapMarkers).
const mapCenter = ref<[number, number]>([initialPos.lat, initialPos.lng])
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

// Computed - Valid markers : on affiche ce qui est DANS LA ZONE VISIBLE de la carte
// (viewport = `mapBounds`, déjà padé de 0.2), PAS dans un rayon autour du joueur.
//
// Choix (fix #bug-carte) : l'ancien filtre était ancré sur la position GPS du joueur
// (`userLat/userLng`) → un joueur situé hors de la zone de contenu (ex. Caen alors que les
// POI sont à Saint-Lô, ~55 km) ne voyait AUCUN marqueur, même en déplaçant la carte, car
// l'ancre restait sa position GPS. En filtrant par le viewport (même logique que
// `visibleZones`), déplacer la carte révèle les POI de la zone regardée : on peut
// consulter/planifier n'importe où. L'INTERACTION reste géo-clôturée à ≤ 50 m côté serveur
// (`visit.openChest`, `run.startExpedition`) → afficher un POI distant n'ouvre aucune faille.
//
// Seuil de zoom 11 conservé : en-dessous, le viewport couvre trop d'entités → aucun marqueur.
function makeBoundsFilter(bounds: Leaflet.LatLngBounds) {
  const south = bounds.getSouth()
  const north = bounds.getNorth()
  const west = bounds.getWest()
  const east = bounds.getEast()
  return (lat?: number, lng?: number): boolean => {
    if (lat === undefined || lng === undefined) return false
    return lat >= south && lat <= north && lng >= west && lng <= east
  }
}

const validMuseums = computed<Museum[]>(() => {
  if (currentZoom.value < 11 || !mapBounds.value) return []
  const inView = makeBoundsFilter(mapBounds.value)
  return museumStore.museums.filter((m) => inView(m.lat, m.lng))
})

const validPOIs = computed<Poi[]>(() => {
  if (currentZoom.value < 11 || !mapBounds.value) return []
  const inView = makeBoundsFilter(mapBounds.value)
  return poiStore.pois.filter((p) => inView(p.lat, p.lng))
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
      loadVisibleEntities()
    }
  }, 150)
}

// Initialisation des bounds au chargement
function onMapReady() {
  // Init immédiat des bounds (pas de debounce au premier chargement)
  const map = mapRef.value?.leafletObject
  if (map?.getBounds) {
    mapBounds.value = map.getBounds().pad(0.2)
    loadVisibleEntities() // chargement initial de la zone visible
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

// Chargement PAR TUILES (déport bbox) : on ne récupère que les POI/musées de la zone VISIBLE
// à chaque moveend, au lieu de télécharger tout le catalogue (inviable à l'échelle nationale :
// dizaines de milliers d'entités → download + mémoire mobile explosifs). Le chargeur dédup et
// ne re-fetch que les tuiles ~0,1° pas encore vues. Gate zoom<11 : en-dessous on n'affiche rien.
function loadVisibleEntities(): void {
  if (currentZoom.value < 11 || !mapBounds.value) return
  const b = mapBounds.value
  const bounds = { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() }
  poiStore.loadBounds(bounds)
  museumStore.loadBounds(bounds)
}

// Register geolocation callbacks
geolocation.registerCallbacks({
  onFirstPosition: (lat, lng) => {
    // Recentrage UNIQUE sur le joueur au 1er fix. On met à jour mapCenter (fiable même si la carte
    // n'est pas encore prête, contrairement à un flyTo impératif qui serait alors sauté) + le zoom.
    // Aucun recentrage sur les positions suivantes → le joueur peut explorer la carte librement.
    mapCenter.value = [lat, lng]
    currentZoom.value = 13
    saveLastPosition(lat, lng) // mémorise pour rouvrir la carte ici au prochain lancement
    fogStore.addPosition(lat, lng)
    zoneCompletion.checkFogCoverage(lat, lng)
  },
  onPositionUpdate: (lat, lng) => {
    saveLastPosition(lat, lng)
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
  // POI/musées : plus de chargement global ici — ils sont chargés PAR TUILES quand la carte est
  // prête et à chaque déplacement (cf. loadVisibleEntities / onMapReady / onMapMove).

  // Optimisation Fog: Nettoyage des points dans les régions complétées
  // Note: zoneStore est initialisé dans app.vue via zoneStore.init(), pas par la carte
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