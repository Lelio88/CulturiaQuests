import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Progression {
  id: number
  documentId: string
  is_completed: boolean
  region?: { documentId: string; id: number }
  department?: { documentId: string; id: number }
  comcom?: { documentId: string; id: number }
}

/**
 * Store Pinia de la progression géographique (fog-of-war) : suit les zones
 * complétées par le joueur à trois échelles — région, département, comcom.
 *
 * Choix non-évidents :
 * - Pour chaque échelle, un `computed` projette les progressions en un `Set` de
 *   `documentId` complétés ; les tests d'appartenance (`isRegionCompleted`, etc.)
 *   sont alors en O(1), ce qui compte car ils sont appelés en masse lors du rendu
 *   de la carte (fog).
 * - On indexe par `documentId` Strapi v5 (stable entre environnements) plutôt que
 *   par `id` numérique.
 *
 * Invariants :
 * - Seules les progressions avec `is_completed === true` ET un `documentId` de
 *   zone défini alimentent les Sets ; une zone sans `documentId` est ignorée.
 * - Persistance `localStorage` limitée à `progressions` (jamais cookie, cf.
 *   garde-fou projet) ; les Sets dérivés ne sont pas persistés (recalculés).
 *
 * @example
 * const store = useProgressionStore()
 * store.setProgressions(data)
 * if (store.isComcomCompleted('abc123')) revealZone()
 */
export const useProgressionStore = defineStore('progression', () => {
  const progressions = ref<Progression[]>([])

  // Maps pour accès rapide (Set de documentId)
  const completedRegionIds = computed(() => {
    const ids = new Set<string>()
    progressions.value.forEach(p => {
      if (p.is_completed && p.region?.documentId) ids.add(p.region.documentId)
    })
    return ids
  })

  const completedDepartmentIds = computed(() => {
    const ids = new Set<string>()
    progressions.value.forEach(p => {
      if (p.is_completed && p.department?.documentId) ids.add(p.department.documentId)
    })
    return ids
  })

  const completedComcomIds = computed(() => {
    const ids = new Set<string>()
    progressions.value.forEach(p => {
      if (p.is_completed && p.comcom?.documentId) ids.add(p.comcom.documentId)
    })
    return ids
  })

  // Actions
  function setProgressions(data: Progression[]) {
    progressions.value = data
  }

  function clearProgressions() {
    progressions.value = []
  }

  function isRegionCompleted(id: string) {
    if (!id) return false
    return completedRegionIds.value.has(id)
  }

  function isDepartmentCompleted(id: string) {
    if (!id) return false
    return completedDepartmentIds.value.has(id)
  }

  function isComcomCompleted(id: string) {
    if (!id) return false
    return completedComcomIds.value.has(id)
  }

  return {
    progressions,
    completedRegionIds,
    completedDepartmentIds,
    completedComcomIds,
    setProgressions,
    clearProgressions,
    isRegionCompleted,
    isDepartmentCompleted,
    isComcomCompleted
  }
}, {
  persist: {
    pick: ['progressions']
  }
})
