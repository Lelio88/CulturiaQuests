import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Poi } from '~/types/poi'
import { get, set } from 'idb-keyval'

const DB_KEY = 'pois-data'
const DB_VERSION_KEY = 'pois-version'
const CURRENT_DATA_VERSION = '2.0'

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
    attributes: raw.attributes
  }
}

/**
 * Store des points d'intérêt (POI) affichés sur la carte (musées, monuments,
 * lieux porteurs de quêtes), chargés en masse depuis Strapi puis mis en cache.
 *
 * Le store télécharge l'intégralité des POI via une boucle de pagination
 * (`fetchAll`), les normalise (`normalizePoi` tolère le format plat ou
 * `attributes.*` de Strapi v5), et les conserve en IndexedDB (idb-keyval) avec
 * une clé de version pour éviter de re-télécharger à chaque ouverture.
 *
 * Choix non-évidents :
 * - Cache en IndexedDB plutôt qu'en localStorage car la liste complète des POI
 *   peut être volumineuse.
 * - `normalizePoi` aplatit deux formes de payload possibles (champs racine vs
 *   `attributes`) pour absorber les variations de sérialisation Strapi.
 *
 * Invariants à préserver :
 * - `init()` est idempotent (no-op si `isInitialized`) ; il sert le cache si la
 *   version stockée == CURRENT_DATA_VERSION, sinon délègue à `fetchAll`.
 * - Bumper CURRENT_DATA_VERSION à chaque changement de forme du POI normalisé
 *   pour invalider le cache IndexedDB.
 *
 * @example
 * const poi = usePOIStore()
 * await poi.init()
 * if (poi.hasPOIs) renderMarkers(poi.pois)
 */
export const usePOIStore = defineStore('poi', () => {
  const pois = ref<Poi[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isInitialized = ref(false)

  const hasPOIs = computed(() => pois.value.length > 0)

  async function init() {
    if (isInitialized.value) return
    const storedVersion = await get(DB_VERSION_KEY)
    const storedData = await get(DB_KEY)

    if (storedVersion === CURRENT_DATA_VERSION && storedData) {
      pois.value = storedData
      isInitialized.value = true
    } else {
      await fetchAll()
    }
  }

  async function fetchAll() {
    const config = useRuntimeConfig()
    loading.value = true
    const allPois: any[] = []
    const MAX_PAGES = 200
    let page = 1
    let hasMore = true

    try {
      while (hasMore && page <= MAX_PAGES) {
        const response: any = await $fetch(`${config.public.strapi.url}/api/pois`, {
          query: {
            'pagination[page]': page,
            'pagination[pageSize]': 100,
          }
        })
        const data = response.data || []
        allPois.push(...data)
        
        if (response.meta?.pagination && page < response.meta.pagination.pageCount) {
          page++
        } else {
          hasMore = false
        }
      }

      pois.value = allPois.map(normalizePoi)
      await set(DB_KEY, pois.value)
      await set(DB_VERSION_KEY, CURRENT_DATA_VERSION)
      isInitialized.value = true
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  function clearPOIs() {
    pois.value = []
    isInitialized.value = false
    error.value = null
  }

  return { pois, loading, error, isInitialized, init, fetchAll, hasPOIs, clearPOIs }
})
