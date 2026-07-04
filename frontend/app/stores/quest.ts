import { defineStore } from 'pinia'
import type { Quest } from '~/types/quest'
import type { StrapiListResponse } from '~/types/strapi'

/** Réponse de l'endpoint custom `POST /quests/generate-daily`. */
interface GenerateDailyResponse {
  data?: Quest[]
  alreadyGenerated?: boolean
}

export const useQuestStore = defineStore('quest', () => {
  // State
  const quests = ref<Quest[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const hasQuests = computed(() => quests.value.length > 0)
  const questCount = computed(() => quests.value.length)

  const activeQuests = computed(() => {
    return quests.value.filter(q => {
      const isPoiACompleted = q.is_poi_a_completed ?? q.attributes?.is_poi_a_completed
      const isPoiBCompleted = q.is_poi_b_completed ?? q.attributes?.is_poi_b_completed
      return !isPoiACompleted || !isPoiBCompleted
    })
  })

  const availableQuests = computed(() => {
    const today = new Date().toDateString()

    return quests.value.filter(q => {
      const attrs = q.attributes || q
      if (!attrs.date_start) return false
      
      const questDate = new Date(attrs.date_start).toDateString()
      return questDate === today
    })
  })

  const completedQuests = computed(() => {
    return quests.value.filter(q => {
      const isPoiACompleted = q.is_poi_a_completed ?? q.attributes?.is_poi_a_completed
      const isPoiBCompleted = q.is_poi_b_completed ?? q.attributes?.is_poi_b_completed
      return isPoiACompleted && isPoiBCompleted
    })
  })

  const activeQuestCount = computed(() => activeQuests.value.length)
  const completedQuestCount = computed(() => completedQuests.value.length)

  // Actions
  function setQuests(data: Quest[]) {
    quests.value = data
  }

  function clearQuests() {
    quests.value = []
    error.value = null
  }

  function addQuest(quest: Quest) {
    quests.value.push(quest)
  }

  // updateQuest / removeQuest / updateQuestProgress retirés (#audit) : jamais appelés
  // (progression de quête 100% serveur-autoritative via guildStore.fetchAll) + portaient des
  // erreurs de type (mutation locale d'un index possiblement undefined). YAGNI.

  async function generateDailyQuests(poiDocumentIds: string[]) {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<GenerateDailyResponse>('/quests/generate-daily', {
        method: 'POST',
        body: { poiDocumentIds },
      })

      const data = response.data || response
      setQuests(Array.isArray(data) ? data : [])
      return response.alreadyGenerated
    } catch (e: any) {
      console.error('Failed to generate daily quests:', e)
      error.value = e?.message || 'Failed to generate daily quests'
    } finally {
      loading.value = false
    }
  }

  async function fetchQuests() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<StrapiListResponse<Quest>>('/quests', {
        method: 'GET',
        params: {
          populate: {
            npc: {
              populate: {
                dialogs: true,
              },
            },
            poi_a: true,
            poi_b: true,
          },
        },
      })

      const data = response.data || response
      setQuests(Array.isArray(data) ? data : [])
    } catch (e: any) {
      console.error('Failed to fetch quests:', e)
      error.value = e?.message || 'Failed to fetch quests'
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    quests,
    loading,
    error,
    // Getters
    hasQuests,
    questCount,
    activeQuests,
    availableQuests,
    completedQuests,
    activeQuestCount,
    completedQuestCount,
    // Actions
    setQuests,
    clearQuests,
    addQuest,
    fetchQuests,
    generateDailyQuests,
  }
})
// Persistance supprimée - les quests sont rechargés via guildStore.fetchAll()
// Les quêtes contiennent des relations imbriquées (npc, poi_a, poi_b)
// et leur état change fréquemment - le serveur est la source de vérité
