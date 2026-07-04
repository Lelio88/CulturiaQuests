import { defineStore } from 'pinia'
import { computed } from 'vue'
import type { Poi } from '~/types/poi'
import { useTileLoader } from '~/composables/useTileLoader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePoi(raw: any): Poi {
  return {
    id: raw.id,
    documentId: raw.documentId,
    name: raw.name || raw.attributes?.name || 'Unnamed',
    lat: raw.lat ?? raw.attributes?.lat,
    lng: raw.lng ?? raw.attributes?.lng,
    geohash: raw.geohash || raw.attributes?.geohash,
    location: raw.location || raw.attributes?.location,
    visits: raw.visits || raw.attributes?.visits,
    quests_a: raw.quests_a || raw.attributes?.quests_a,
    quests_b: raw.quests_b || raw.attributes?.quests_b,
    attributes: raw.attributes,
  }
}

/**
 * Store des points d'intérêt (POI) affichés sur la carte, chargés PAR TUILES (déport bbox) via
 * `useTileLoader` — et NON plus en téléchargement intégral. Motivation : avec le peuplement de la
 * France entière (dizaines de milliers de POI), tout télécharger côté client (download + mémoire)
 * casserait le mobile. On ne charge donc que la zone visible / demandée.
 *
 * API :
 * - `loadBounds(bounds)` : appelé par la carte à chaque `moveend` (charge la frange visible).
 * - `loadAround(lat, lng, km)` : charge un rayon autour d'un point (ex. quêtes du jour).
 * - `pois` : entités accumulées (dédupliquées) des tuiles déjà chargées cette session.
 * - `clearPOIs()` : reset complet (appelé au logout).
 *
 * Invariant : `pois` ne contient JAMAIS l'intégralité du catalogue — seulement les tuiles visitées.
 * Tout consommateur qui a besoin de POI proches doit d'abord appeler `loadBounds`/`loadAround`.
 *
 * @example
 * const poi = usePOIStore()
 * await poi.loadAround(49.11, -1.08, 25)
 * const nearby = poi.pois
 */
export const usePOIStore = defineStore('poi', () => {
  const loader = useTileLoader<Poi>({ resource: 'pois', normalize: normalizePoi })

  const hasPOIs = computed(() => loader.items.value.length > 0)

  return {
    pois: loader.items,
    loading: loader.loading,
    error: loader.error,
    hasPOIs,
    loadBounds: loader.loadBounds,
    loadAround: loader.loadAround,
    clearPOIs: loader.clear,
  }
})
