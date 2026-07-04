import { defineStore } from 'pinia'
import { computed } from 'vue'
import type { Museum } from '~/types/museum'
import { extractTags } from '~/utils/strapiHelpers'
import { useTileLoader } from '~/composables/useTileLoader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMuseum(raw: any): Museum {
  return {
    id: raw.id,
    documentId: raw.documentId,
    name: raw.name || raw.attributes?.name || 'Unnamed',
    lat: raw.lat ?? raw.attributes?.lat,
    lng: raw.lng ?? raw.attributes?.lng,
    geohash: raw.geohash || raw.attributes?.geohash,
    radius: raw.radius ?? raw.attributes?.radius,
    location: raw.location || raw.attributes?.location,
    tags: extractTags(raw),
    runs: raw.runs || raw.attributes?.runs,
    attributes: raw.attributes,
  }
}

/**
 * Store des musées (points de départ d'expédition), chargés PAR TUILES (déport bbox) via
 * `useTileLoader`, comme les POI — plus de téléchargement intégral du catalogue (inviable dès qu'on
 * peuple la France entière). `populate: 'tags'` est conservé (icônes de catégorie sur la carte).
 *
 * API : `loadBounds(bounds)` (carte, à chaque `moveend`), `loadAround(lat, lng, km)`, `museums`
 * (entités des tuiles chargées cette session), `clearMuseums()` (logout).
 *
 * Invariant : `museums` ne contient jamais tout le catalogue — seulement les tuiles visitées.
 *
 * @example
 * const museumStore = useMuseumStore()
 * await museumStore.loadBounds({ south, north, west, east })
 */
export const useMuseumStore = defineStore('museum', () => {
  const loader = useTileLoader<Museum>({
    resource: 'museums',
    normalize: normalizeMuseum,
    extraQuery: { populate: 'tags' },
  })

  const hasMuseums = computed(() => loader.items.value.length > 0)

  return {
    museums: loader.items,
    loading: loader.loading,
    error: loader.error,
    hasMuseums,
    loadBounds: loader.loadBounds,
    loadAround: loader.loadAround,
    clearMuseums: loader.clear,
  }
})
