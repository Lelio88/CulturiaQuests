import { defineStore } from 'pinia'
import type { Visit } from '~/types/visit'
import type { ChestLoot } from '~/types/loot'
import type { StrapiListResponse } from '~/types/strapi'

/** Réponse de l'endpoint custom `POST /visits/open-chest` (hors enveloppe Strapi standard). */
interface OpenChestResponse {
  visit: Visit
  loot: ChestLoot
  data?: { visit: Visit; loot: ChestLoot }
}

/**
 * Store des visites de POI : suivi des visites, ouverture de coffres et gestion
 * du cooldown d'ouverture par POI.
 *
 * Choix non-évidents :
 * - Le cooldown d'un coffre est de 24h, calculé côté front à partir de
 *   `last_opened_at` (`isChestAvailable` / `getTimeUntilAvailable`) : un POI
 *   jamais ouvert est toujours disponible.
 * - `getVisitForPOI` et les getters tolèrent les deux formes Strapi (champ direct
 *   `poi.id` ou relation `poi.data.id`, champ direct ou `attributes.*`).
 * - `formatTimeRemaining` renvoie "Disponible" quand le temps restant est ≤ 0.
 *
 * Invariants :
 * - Aucune persistance Pinia : l'historique des visites s'accumule et provoquait
 *   l'erreur 431 ; le serveur est la source de vérité (rechargement via
 *   guildStore.fetchAll() à la connexion). Ne pas réactiver la persistance.
 *
 * Usage canonique :
 *   const visit = useVisitStore()
 *   if (visit.isChestAvailable(poiId)) {
 *     const loot = await visit.openChest(poiDocumentId, lat, lng)
 *   }
 */
export const useVisitStore = defineStore('visit', () => {
  // State
  const visits = ref<Visit[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const hasVisits = computed(() => visits.value.length > 0)
  const visitCount = computed(() => visits.value.length)

  const totalGoldEarned = computed(() => {
    return visits.value.reduce((sum, v) => {
      const gold = v.total_gold_earned ?? v.attributes?.total_gold_earned ?? 0
      return sum + gold
    }, 0)
  })

  const totalExpEarned = computed(() => {
    return visits.value.reduce((sum, v) => {
      const exp = v.total_exp_earned ?? v.attributes?.total_exp_earned ?? 0
      return sum + exp
    }, 0)
  })

  const getVisitForPOI = computed(() => (poiId: number | string) => {
    return visits.value.find(v => {
      const visitPoiId = v.poi?.data?.id || v.poi?.id
      return visitPoiId === poiId
    })
  })

  /**
   * Check if a chest is available (not on cooldown)
   */
  const isChestAvailable = computed(() => (poiId: number | string) => {
    const visit = getVisitForPOI.value(poiId)
    if (!visit) return true // Never opened = available

    const lastOpened = visit.last_opened_at || visit.attributes?.last_opened_at
    if (!lastOpened) return true

    const lastOpenedTime = new Date(lastOpened).getTime()
    const now = Date.now()
    const cooldownMs = 24 * 60 * 60 * 1000 // 24h

    return (now - lastOpenedTime) >= cooldownMs
  })

  /**
   * Get time remaining until chest is available (in milliseconds)
   */
  const getTimeUntilAvailable = computed(() => (poiId: number | string) => {
    const visit = getVisitForPOI.value(poiId)
    if (!visit) return 0

    const lastOpened = visit.last_opened_at || visit.attributes?.last_opened_at
    if (!lastOpened) return 0

    const lastOpenedTime = new Date(lastOpened).getTime()
    const now = Date.now()
    const cooldownMs = 24 * 60 * 60 * 1000
    const elapsed = now - lastOpenedTime

    if (elapsed >= cooldownMs) return 0
    return cooldownMs - elapsed
  })

  /**
   * Format time remaining as "Xh Ym"
   */
  function formatTimeRemaining(ms: number): string {
    if (ms <= 0) return 'Disponible'

    const hours = Math.floor(ms / (60 * 60 * 1000))
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))

    return `${hours}h ${minutes}m`
  }

  // Actions
  function setVisits(data: Visit[]) {
    visits.value = data
  }

  function clearVisits() {
    visits.value = []
    error.value = null
  }

  function addVisit(visit: Visit) {
    visits.value.push(visit)
  }

  function updateVisit(visitId: number, updates: Partial<Visit>) {
    const index = visits.value.findIndex(v => v.id === visitId)
    if (index !== -1) {
      visits.value[index] = { ...visits.value[index], ...updates } as Visit
    }
  }

  async function fetchVisits() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<StrapiListResponse<Visit>>('/visits', {
        method: 'GET',
        params: {
          populate: ['poi', 'items'],
        },
      })

      const data = response.data || response
      setVisits(Array.isArray(data) ? data : [])
    } catch (e: any) {
      console.error('Failed to fetch visits:', e)
      error.value = e?.message || 'Failed to fetch visits'
    } finally {
      loading.value = false
    }
  }

  /**
   * Open a chest at a POI
   */
  async function openChest(poiId: string, userLat: number, userLng: number) {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<OpenChestResponse>('/visits/open-chest', {
        method: 'POST',
        body: { poiId, userLat, userLng }
      })

      const data = response.data || response

      // Update or add the visit
      const visitIndex = visits.value.findIndex(v => {
        const vId = v.documentId || v.id
        const dataId = data.visit.documentId || data.visit.id
        return vId === dataId
      })

      if (visitIndex !== -1) {
        visits.value[visitIndex] = data.visit
      } else {
        visits.value.push(data.visit)
      }

      return data.loot
    } catch (e: any) {
      console.error('Failed to open chest:', e)
      error.value = e?.message || 'Failed to open chest'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    visits,
    loading,
    error,
    // Getters
    hasVisits,
    visitCount,
    totalGoldEarned,
    totalExpEarned,
    getVisitForPOI,
    isChestAvailable,
    getTimeUntilAvailable,
    formatTimeRemaining,
    // Actions
    setVisits,
    clearVisits,
    addVisit,
    updateVisit,
    fetchVisits,
    openChest,
  }
})
// Persistance supprimée - les visits sont rechargés via guildStore.fetchAll()
// L'historique des visites s'accumule, ce qui causait l'erreur 431
// Le serveur est la source de vérité pour l'historique des visites

// Note: Persistence disabled to prevent 431 errors with large visit data
// Visits are loaded automatically via guildStore.fetchAll() on login
