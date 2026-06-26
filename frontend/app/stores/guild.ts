import { defineStore } from 'pinia'
import type { Guild } from '~/types/guild'
import type { StrapiListResponse, StrapiSingleResponse } from '~/types/strapi'
import { getMaxCharacters } from '~/utils/guildLevel'

/**
 * Guilde « aplatie + relations profondes » telle qu'extraite des réponses /guilds (fetchAll
 * peuple characters/items/quests/visits/runs/friendships/progressions, hors du type Guild
 * canonique). L'index signature documente cet agrégat volontairement permissif. #43
 */
type GuildAggregate = Guild & Record<string, any>
import { useCharacterStore } from './character'
import { useInventoryStore } from './inventory'
import { useQuestStore } from './quest'
import { useVisitStore } from './visit'
import { useRunStore } from './run'
import { useFriendshipStore } from './friendship'
import { useNpcStore } from './npc'
import { useMuseumStore } from './museum'
import { usePOIStore } from './poi'
import { useQuizStore } from './quiz'
import { useStatisticsStore } from './statistics'
import { useProgressionStore } from './progression'
import type { Progression } from './progression'
import { useFogStore } from './fog'
import { usePlayerFriendshipStore } from './playerFriendship'

/**
 * Store central de la guilde du joueur — agrégat racine de la session de jeu.
 *
 * Chaque utilisateur possède une et une seule guilde : les endpoints `/guilds`
 * renvoient un tableau de 0 ou 1 élément déjà filtré par `guild.user` côté Strapi
 * (isolation par utilisateur, CLAUDE.md §I), d'où le `Array.isArray(guilds) ? guilds[0] : guilds`.
 *
 * Choix non-évidents :
 * - `level` est dérivé de l'XP (Niveau = √(XP / 75) + 1) plutôt que stocké, pour rester
 *   l'unique source de vérité et éviter toute désynchronisation.
 * - `fetchAll()` hydrate en cascade tous les stores liés (characters, items, quests, visits,
 *   runs, friendships, progressions) via un seul `/guilds?populate=...` profond ; `fetchGuild()`
 *   et `refetchStats()` sont les variantes légères. `clearAll()` est le miroir au logout.
 * - `refetchStats()` se replie sur la valeur courante du store si la réponse n'expose ni la clé
 *   directe ni `attributes.*` (évite d'écraser une stat existante par `undefined`, #80).
 *
 * Invariants :
 * - Isolation par utilisateur : ne jamais lever le filtre serveur `guild.user`.
 * - Persistance Pinia en localStorage uniquement, et seul `guild` est persisté (`pick: ['guild']`) ;
 *   les données lourdes liées sont rechargées via `fetchAll()` (jamais en cookie → évite l'erreur 431).
 */
export const useGuildStore = defineStore('guild', () => {
  // State
  const guild = ref<Guild | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const hasGuild = computed(() => guild.value !== null)

  const gold = computed(() => guild.value?.gold ?? guild.value?.attributes?.gold ?? 0)
  const exp = computed(() => guild.value?.exp ?? guild.value?.attributes?.exp ?? 0)
  const scrap = computed(() => guild.value?.scrap ?? guild.value?.attributes?.scrap ?? 0)
  const name = computed(() => guild.value?.name ?? guild.value?.attributes?.name ?? '')
  const debugMode = computed(() => guild.value?.debug_mode ?? guild.value?.attributes?.debug_mode ?? false)
  const quizStreak = computed(() => guild.value?.quiz_streak ?? guild.value?.attributes?.quiz_streak ?? 0)

  /**
   * Calcule le niveau de la guilde à partir de l'XP
   * Formule : XP_total = 75 × Niveau²
   * Donc : Niveau = √(XP_total / 75) + 1
   * Le niveau minimum est 1 (avec 0 XP)
   */
  const level = computed(() => {
    const currentExp = Number(exp.value)
    return Math.floor(Math.sqrt(currentExp / 75)) + 1
  })

  const maxCharacters = computed(() => getMaxCharacters(level.value))

  const canAddCharacter = computed(() => {
    const characterStore = useCharacterStore()
    return characterStore.characterCount < maxCharacters.value
  })

  // Actions
  function setGuild(data: Guild) {
    guild.value = data
  }

  function clearGuild() {
    guild.value = null
    error.value = null
  }

  /**
   * Clears all stores (for logout)
   */
  function clearAll() {
    clearGuild()
    useCharacterStore().clearCharacters()
    useInventoryStore().clearItems()
    useQuestStore().clearQuests()
    useVisitStore().clearVisits()
    useRunStore().clearRuns()
    useFriendshipStore().clearFriendships()
    useNpcStore().clearNpcs()
    useMuseumStore().clearMuseums()
    usePOIStore().clearPOIs()
    useQuizStore().resetAll()
    useStatisticsStore().clearStatistics()
    useProgressionStore().clearProgressions()
    useFogStore().clearFog()
    usePlayerFriendshipStore().clearPlayerFriendships()
  }

  /**
   * Fetches the guild data for the current authenticated user (basic info only)
   */
  async function fetchGuild() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<StrapiListResponse<Guild>>('/guilds', {
        method: 'GET',
      })

      // The controller filters by user, so we get an array with 0 or 1 guild
      const guilds = response.data || response
      const guildData = (Array.isArray(guilds) ? guilds[0] : guilds) as Guild | undefined

      if (guildData) {
        setGuild(guildData)
      }
    } catch (e: any) {
      console.error('Failed to fetch guild:', e)
      error.value = e?.message || 'Failed to fetch guild'
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetches the guild with all related data and hydrates all stores
   */
  async function fetchAll() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<StrapiListResponse<Guild>>('/guilds', {
        method: 'GET',
        params: {
          populate: {
            characters: {
              populate: {
                icon: { fields: ['url'] },
              },
            },
            items: {
              populate: {
                rarity: true,
                tags: true,
                character: true,
                icon: { fields: ['url'] },
              },
            },
            quests: {
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
            visits: {
              populate: ['poi', 'items'],
            },
            runs: {
              populate: ['museum', 'npc', 'items'],
            },
            friendships: {
              populate: ['npc'],
            },
            progressions: {
              populate: {
                region: { fields: ['documentId', 'name'] },
                department: { fields: ['documentId', 'name'] },
                comcom: { fields: ['documentId', 'name'] }
              }
            }
          },
        },
      })

      // The controller filters by user, so we get an array with 0 or 1 guild
      const guilds = response.data || response
      const guildData = (Array.isArray(guilds) ? guilds[0] : guilds) as GuildAggregate | undefined

      if (guildData) {
        // Set guild basic info
        setGuild(guildData)

        // Hydrate other stores with related data
        const characters = guildData.characters?.data || guildData.characters || []
        const items = guildData.items?.data || guildData.items || []
        const quests = guildData.quests?.data || guildData.quests || []
        const visits = guildData.visits?.data || guildData.visits || []
        const runs = guildData.runs?.data || guildData.runs || []
        const friendships = guildData.friendships?.data || guildData.friendships || []
        const progressions = guildData.progressions?.data || guildData.progressions || []

        useCharacterStore().setCharacters(Array.isArray(characters) ? characters : [])
        useInventoryStore().setItems(Array.isArray(items) ? items : [])
        useQuestStore().setQuests(Array.isArray(quests) ? quests : [])
        useVisitStore().setVisits(Array.isArray(visits) ? visits : [])
        useRunStore().setRuns(Array.isArray(runs) ? runs : [])
        useFriendshipStore().setFriendships(Array.isArray(friendships) ? friendships : [])
        useProgressionStore().setProgressions(Array.isArray(progressions) ? progressions : [])
      }
    } catch (e: any) {
      console.error('Failed to fetch all guild data:', e)
      error.value = e?.message || 'Failed to fetch guild data'
    } finally {
      loading.value = false
    }
  }

  /**
   * Refresh CIBLÉ des progressions (fog-of-war) — requête /progressions légère (filtrée
   * par guilde côté serveur) au lieu du fetchAll() profond. Utilisé après complétion d'une
   * zone ; capture aussi d'éventuelles complétions en cascade (region/department).
   */
  async function fetchProgressions() {
    const client = useApi()
    try {
      const res = await client<StrapiListResponse<Progression>>('/progressions', {
        method: 'GET',
        params: {
          populate: {
            region: { fields: ['documentId', 'name'] },
            department: { fields: ['documentId', 'name'] },
            comcom: { fields: ['documentId', 'name'] },
          },
        },
      })
      const progressions = res.data || res || []
      useProgressionStore().setProgressions(Array.isArray(progressions) ? progressions : [])
    } catch (e: any) {
      console.error('Failed to fetch progressions:', e)
    }
  }

  /**
   * Refetch only the guild stats (gold, exp, scrap, debug_mode)
   */
  async function refetchStats() {
    const client = useApi()

    try {
      const response = await client<StrapiListResponse<Guild>>('/guilds', {
        method: 'GET',
        params: {
          fields: ['name', 'gold', 'exp', 'scrap', 'debug_mode', 'quiz_streak'],
        },
      })

      const guilds = response.data || response
      const guildData = (Array.isArray(guilds) ? guilds[0] : guilds) as GuildAggregate | undefined

      if (guildData && guild.value) {
        // Repli final sur la valeur courante du store : si une réponse inattendue n'expose ni la
        // clé directe ni `attributes.*`, on NE remplace PAS la stat existante par `undefined`. #80
        guild.value = {
          ...guild.value,
          gold: guildData.gold ?? guildData.attributes?.gold ?? guild.value.gold,
          exp: guildData.exp ?? guildData.attributes?.exp ?? guild.value.exp,
          scrap: guildData.scrap ?? guildData.attributes?.scrap ?? guild.value.scrap,
          debug_mode: guildData.debug_mode ?? guildData.attributes?.debug_mode ?? guild.value.debug_mode,
          quiz_streak: guildData.quiz_streak ?? guildData.attributes?.quiz_streak ?? guild.value.quiz_streak,
        }
      }
    } catch (e: any) {
      console.error('Failed to refetch guild stats:', e)
    }
  }

  async function createGuildSetup(payload: {
    guildName: string
    firstname: string
    lastname: string
    iconId: number
  }) {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<StrapiSingleResponse<Guild>>('/guilds/setup', {
        method: 'POST',
        body: payload
      })

      const data = (response.data || response) as GuildAggregate
      setGuild(data)
      // Hydrate characters if returned populated
      if (data.characters) {
          useCharacterStore().setCharacters(data.characters.data || data.characters || [])
      }
      return data
    } catch (e: any) {
      console.error('Failed to setup guild:', e)
      error.value = e?.message || 'Failed to setup guild'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Delete the current guild and all associated data
   */
  async function deleteGuild() {
    if (!guild.value) {
      throw new Error('No guild to delete')
    }

    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const guildId = guild.value.documentId || guild.value.id
      await client(`/guilds/${guildId}`, {
        method: 'DELETE',
      })

      // Clear all stores after successful deletion
      clearAll()

      return { success: true }
    } catch (e: any) {
      console.error('Failed to delete guild:', e)
      error.value = e?.message || 'Failed to delete guild'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * Bascule le mode debug de la guilde de l'utilisateur courant (ADMIN uniquement).
   *
   * `debug_mode` désactive le geofence anti-triche (consommé par MuseumDrawer/POIDrawer côté
   * front et run.service côté back) : il autorise expéditions et ouverture de coffres sans être
   * physiquement sur place — utile pour tester/démontrer l'app sans se déplacer. L'endpoint
   * `POST /guilds/toggle-debug` est doublement gardé admin (permission bootstrap §IV.3 +
   * re-check `role.type === 'admin'` dans le controller) et n'agit QUE sur la guilde de l'admin
   * authentifié (filtre `guild.user`, jamais une guilde arbitraire — invariant d'isolation §I).
   * On patche `debug_mode` depuis la réponse (mise à jour immuable) pour rester en phase sans
   * refetch complet.
   */
  async function toggleDebug() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<StrapiSingleResponse<Guild>>('/guilds/toggle-debug', {
        method: 'POST',
      })

      const data = (response.data || response) as GuildAggregate
      if (guild.value) {
        guild.value = {
          ...guild.value,
          debug_mode: data.debug_mode ?? data.attributes?.debug_mode ?? !guild.value.debug_mode,
        }
      }
      return data
    } catch (e: any) {
      console.error('Failed to toggle debug mode:', e)
      error.value = e?.message || 'Failed to toggle debug mode'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    guild,
    loading,
    error,
    // Getters
    hasGuild,
    gold,
    exp,
    scrap,
    name,
    level,
    maxCharacters,
    canAddCharacter,
    debugMode,
    quizStreak,
    // Actions
    setGuild,
    clearGuild,
    clearAll,
    fetchGuild,
    fetchAll,
    fetchProgressions,
    refetchStats,
    createGuildSetup,
    deleteGuild,
    toggleDebug,
  }
}, {
  persist: {
    pick: ['guild'],
  },
})
