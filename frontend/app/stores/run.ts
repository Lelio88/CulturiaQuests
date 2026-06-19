import { defineStore } from 'pinia'
import type { Run } from '~/types/run'

/**
 * Store des expéditions (runs) : démarrage/fin d'expédition vers un musée,
 * suivi du run actif et agrégats (or/xp gagnés, musées visités).
 *
 * Choix non-évidents :
 * - `startExpedition` peut déclencher un tirage de quête (questRolled) ; le
 *   dialogue et l'identité du PNJ sont alors stockés (`lastQuestRolled`,
 *   `lastNpcDialog`, `lastNpcInfo`) pour être consommés par la page
 *   d'interaction PNJ.
 * - `fetchActiveRun` valide explicitement `date_start` (run réel + date parsable)
 *   avant d'accepter le run : la forme de réponse du back varie (objet brut ou
 *   enveloppe `{ data }` / `{ run }`), et un `new Date(undefined)` → NaN cassait
 *   le timer côté expedition.vue (#80). Cet appel n'écrit jamais `error` (check
 *   silencieux).
 * - Les getters tolèrent les deux formes Strapi : champ direct ou `attributes.*`.
 *
 * Invariants :
 * - Aucune persistance Pinia : l'historique des runs s'accumule et provoquait
 *   l'erreur 431 ; le serveur est la source de vérité (rechargement via
 *   guildStore.fetchAll()).
 * - `activeRun` = run sans `date_end` (un seul à la fois côté métier).
 *
 * Usage canonique :
 *   const run = useRunStore()
 *   const { questRolled, dialog } = await run.startExpedition(museumId, lat, lng)
 *   // ... plus tard
 *   await run.endExpedition(runDocumentId)
 */
export const useRunStore = defineStore('run', () => {
  // State
  const runs = ref<Run[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // État pour l'interaction NPC (après start-expedition avec questRolled=true)
  const lastQuestRolled = ref(false)
  const lastNpcDialog = ref<string[]>([])
  const lastNpcInfo = ref<{ firstname: string; lastname: string; nickname: string } | null>(null)

  // Getters
  const hasRuns = computed(() => runs.value.length > 0)
  const runCount = computed(() => runs.value.length)

  const activeRun = computed(() => {
    return runs.value.find(r => {
      const dateEnd = r.date_end ?? r.attributes?.date_end
      return !dateEnd
    }) || null
  })

  const completedRuns = computed(() => {
    return runs.value.filter(r => {
      const dateEnd = r.date_end ?? r.attributes?.date_end
      return !!dateEnd
    })
  })

  const totalGoldEarned = computed(() => {
    return runs.value.reduce((sum, r) => {
      const gold = r.gold_earned ?? r.attributes?.gold_earned ?? 0
      return sum + gold
    }, 0)
  })

  const totalExpEarned = computed(() => {
    return runs.value.reduce((sum, r) => {
      const exp = r.xp_earned ?? r.attributes?.xp_earned ?? 0
      return sum + exp
    }, 0)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasVisitedMuseum = computed(() => (museumId: number) => {
    return runs.value.some((r: any) => {
      const rMuseumId = r.museum?.data?.id || r.museum?.id
      return rMuseumId === museumId
    })
  })

  // Actions
  function setRuns(data: Run[]) {
    runs.value = data
  }

  function clearRuns() {
    runs.value = []
    error.value = null
  }

  function addRun(run: Run) {
    runs.value.push(run)
  }

  function updateRun(runId: number, updates: Partial<Run>) {
    const index = runs.value.findIndex(r => r.id === runId)
    if (index !== -1) {
      runs.value[index] = { ...runs.value[index], ...updates }
    }
  }

  async function fetchRuns() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<any>('/runs', {
        method: 'GET',
        params: {
          populate: ['museum', 'npc', 'items'],
        },
      })

      const data = response.data || response
      setRuns(Array.isArray(data) ? data : [])
    } catch (e: any) {
      console.error('Failed to fetch runs:', e)
      error.value = e?.message || 'Failed to fetch runs'
    } finally {
      loading.value = false
    }
  }

  async function startExpedition(museumDocumentId: string, userLat: number, userLng: number) {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<any>('/runs/start-expedition', {
        method: 'POST',
        body: { museumDocumentId, userLat, userLng },
      })

      const { run, questRolled, dialog, npc } = response
      if (run) {
        addRun(run)
      }
      // Stocker pour la page npc-interaction
      lastQuestRolled.value = questRolled || false
      lastNpcDialog.value = dialog || []
      lastNpcInfo.value = npc || null
      return { run, questRolled, dialog, npc }
    } catch (e: any) {
      console.error('Failed to start expedition:', e)
      error.value = extractApiError(e, 'Failed to start expedition')
      throw e
    } finally {
      loading.value = false
    }
  }

  async function endExpedition(runDocumentId: string) {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<any>('/runs/end-expedition', {
        method: 'POST',
        body: { runDocumentId },
      })

      const { run, rewards, questSuccess } = response
      
      if (run) {
        const index = runs.value.findIndex(r => r.documentId === run.documentId || r.id === run.id)
        if (index !== -1) {
          runs.value[index] = run
        } else {
          runs.value.push(run)
        }
      }
      return { run, rewards, questSuccess }
    } catch (e: any) {
      console.error('Failed to end expedition:', e)
      error.value = extractApiError(e, 'Failed to end expedition')
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Récupère les N derniers runs TERMINÉS (date_end non null), avec musée + items peuplés,
   * pour l'écran de partage (createpost). Helper de requête en LECTURE SEULE : il ne mute PAS
   * `runs` (sinon il polluerait les getters `activeRun`/`completedRuns` avec des runs déjà
   * terminés et leurs items). Retourne les runs bruts ; l'appelant assemble son view-model. #36
   */
  async function fetchRecentRuns(limit: number = 5): Promise<Run[]> {
    const client = useApi()
    const response = await client<{ data?: Run[] }>('/runs', {
      method: 'GET',
      params: {
        populate: ['museum', 'museum.tags', 'items', 'items.rarity', 'items.icon'],
        sort: 'createdAt:desc',
        pagination: { limit },
        filters: { date_end: { $null: false } },
      },
    })
    return response.data || []
  }

  /**
   * Récupère un run par son documentId, avec musée + items (icon/rarity/tags) peuplés, pour
   * l'écran de résumé d'expédition. Helper de requête en LECTURE SEULE (ne mute pas `runs`).
   * Tolère la double forme de réponse (`{ data }` ou objet brut). #36
   */
  async function fetchRunById(documentId: string): Promise<Run | null> {
    const client = useApi()
    const response = await client<any>(`/runs/${documentId}`, {
      method: 'GET',
      params: {
        populate: {
          museum: true,
          items: { populate: ['icon', 'rarity', 'tags'] },
        },
      },
    })
    return response?.data || response || null
  }

  async function fetchActiveRun() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<any>('/runs/active', { method: 'GET' })
      // La forme peut varier (objet run brut renvoyé par le back, ou enveloppe { data } / { run }).
      // On extrait explicitement avec `??` (et non `||` qui retombait sur l'enveloppe entière), puis
      // on VALIDE que c'est un vrai run avec une date_start parsable — sinon `new Date(undefined)`
      // donnait NaN et cassait le timer côté expedition.vue. #80
      const run = response?.data ?? response?.run ?? response

      const isValidRun =
        run && typeof run === 'object' &&
        run.date_start && !Number.isNaN(new Date(run.date_start).getTime())

      if (isValidRun) {
         const index = runs.value.findIndex(r => r.documentId === run.documentId || r.id === run.id)
         if (index !== -1) {
            runs.value[index] = run
         } else {
            runs.value.push(run)
         }
         return run
      }
      return null
    } catch (e: any) {
      console.error('Failed to fetch active run:', e)
      // Don't set global error for this silent check
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    runs,
    loading,
    error,
    lastQuestRolled,
    lastNpcDialog,
    lastNpcInfo,
    // Getters
    hasRuns,
    runCount,
    activeRun,
    completedRuns,
    totalGoldEarned,
    totalExpEarned,
    hasVisitedMuseum,
    // Actions
    setRuns,
    clearRuns,
    addRun,
    updateRun,
    fetchRuns,
    startExpedition,
    endExpedition,
    fetchActiveRun,
    fetchRecentRuns,
    fetchRunById,
  }

})
// Persistance supprimée - les runs sont rechargés via guildStore.fetchAll()
// L'historique des runs s'accumule indéfiniment, ce qui causait l'erreur 431
// Le serveur est la source de vérité pour l'historique des sessions
