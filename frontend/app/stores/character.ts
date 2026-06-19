import { defineStore } from 'pinia'
import type { Character, CharacterFormData } from '~/types/character'
import type { StrapiMedia, StrapiListResponse, StrapiSingleResponse } from '~/types/strapi'

/**
 * Store des personnages de la guilde du joueur (CRUD + icônes).
 *
 * Gère la liste des personnages (rattachés à la guilde de l'utilisateur courant côté serveur)
 * et le catalogue d'icônes disponibles. Le nombre de personnages est plafonné par le niveau de
 * la guilde : `useGuildStore().canAddCharacter` compare `characterCount` à `maxCharacters`.
 *
 * Choix non-évidents :
 * - Les getters tolèrent les deux formes de payload Strapi (champ direct ou `attributes.*`,
 *   `icon` ou `icon.data`) car la même donnée transite par `fetchAll()` (populate profond) et
 *   par `fetchCharacters()` (populate ciblé).
 * - `filteredAvailableIcons` exclut les icônes déjà prises (`usedIconIds`) pour éviter les doublons
 *   visuels entre personnages.
 * - `createCharacter` / `saveCharacter` refont un `fetchCharacters()` après écriture pour resynchroniser
 *   l'état (les icônes peuplées ne sont pas renvoyées par le POST/PUT).
 *
 * Invariant : store NON persisté — rechargé via `useGuildStore().fetchAll()` (cf. note en bas de
 * fichier) pour éviter les données obsolètes en cas d'édition multi-appareils.
 */
export const useCharacterStore = defineStore('character', () => {
  // State
  const characters = ref<Character[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // State for icons
  const availableIcons = ref<StrapiMedia[]>([])
  const iconsLoading = ref(false)

  // Getters
  const hasCharacters = computed(() => characters.value.length > 0)
  const characterCount = computed(() => characters.value.length)

  const getCharacterById = computed(() => {
    return (id: number) => characters.value.find(c => c.id === id)
  })

  const usedIconIds = computed(() => {
    return characters.value
      .map(c => {
        const attrs = c.attributes || c
        const icon = attrs.icon?.data || attrs.icon
        return icon?.id ?? null
      })
      .filter((id): id is number => id !== null)
  })

  const filteredAvailableIcons = computed(() => {
    return availableIcons.value.filter(icon => !usedIconIds.value.includes(icon.id))
  })

  // Actions
  function setCharacters(data: Character[]) {
    characters.value = data
  }

  function clearCharacters() {
    characters.value = []
    error.value = null
  }

  function addCharacter(character: Character) {
    characters.value.push(character)
  }

  function removeCharacter(characterId: number) {
    characters.value = characters.value.filter(c => c.id !== characterId)
  }

  function updateCharacter(characterId: number, updates: Partial<Character>) {
    const index = characters.value.findIndex(c => c.id === characterId)
    if (index !== -1) {
      characters.value[index] = { ...characters.value[index], ...updates }
    }
  }

  async function fetchCharacters(withItems: boolean = false) {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      // Construct populate object conditionally
      const populateConfig: Record<string, unknown> = {
        icon: { fields: ['id', 'documentId', 'url', 'name'] },
      }

      if (withItems) {
        populateConfig.items = {
          populate: {
            rarity: true,
            tags: true,
            icon: { fields: ['url'] },
          },
        }
      }

      const response = await client<StrapiListResponse<Character>>('/characters', {
        method: 'GET',
        params: {
          populate: populateConfig,
        },
      })

      const data = response.data || response
      setCharacters(Array.isArray(data) ? data : [])
    } catch (e: any) {
      console.error('Failed to fetch characters:', e)
      error.value = e?.message || 'Failed to fetch characters'
    } finally {
      loading.value = false
    }
  }

  async function fetchCharacterIcons() {
    const client = useApi()
    iconsLoading.value = true

    try {
      const response = await client<StrapiListResponse<StrapiMedia>>('/character-icons', {
        method: 'GET',
      })

      const data = response.data || response
      availableIcons.value = Array.isArray(data) ? data : []
    } catch (e: any) {
      console.error('Failed to fetch character icons:', e)
      availableIcons.value = []
    } finally {
      iconsLoading.value = false
    }
  }

  async function createCharacter(data: CharacterFormData): Promise<Character | null> {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<StrapiSingleResponse<Character>>('/characters', {
        method: 'POST',
        body: {
          data: {
            firstname: data.firstname,
            lastname: data.lastname,
            icon: data.iconId || null,
          },
        },
      })

      const created = (response.data || response) as Character
      if (created) {
        await fetchCharacters()
        return created
      }
      return null
    } catch (e: any) {
      console.error('Failed to create character:', e)
      error.value = e?.message || 'Failed to create character'
      return null
    } finally {
      loading.value = false
    }
  }

  async function saveCharacter(documentId: string, data: CharacterFormData): Promise<boolean> {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      await client<StrapiSingleResponse<Character>>(`/characters/${documentId}`, {
        method: 'PUT',
        body: {
          data: {
            firstname: data.firstname,
            lastname: data.lastname,
            icon: data.iconId || null,
          },
        },
      })

      await fetchCharacters()
      return true
    } catch (e: any) {
      console.error('Failed to update character:', e)
      error.value = e?.message || 'Failed to update character'
      return false
    } finally {
      loading.value = false
    }
  }

  async function deleteCharacter(documentId: string): Promise<boolean> {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      await client<StrapiSingleResponse<Character>>(`/characters/${documentId}`, {
        method: 'DELETE',
      })

      characters.value = characters.value.filter(c => c.documentId !== documentId)
      return true
    } catch (e: any) {
      console.error('Failed to delete character:', e)
      error.value = e?.message || 'Failed to delete character'
      return false
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    characters,
    loading,
    error,
    availableIcons,
    iconsLoading,
    // Getters
    hasCharacters,
    characterCount,
    getCharacterById,
    usedIconIds,
    filteredAvailableIcons,
    // Actions
    setCharacters,
    clearCharacters,
    addCharacter,
    removeCharacter,
    updateCharacter,
    fetchCharacters,
    fetchCharacterIcons,
    createCharacter,
    saveCharacter,
    deleteCharacter,
  }
})
// Persistance supprimée - les characters sont rechargés via guildStore.fetchAll()
// Bien que petit, cela évite les données obsolètes si le joueur
// modifie son personnage depuis un autre appareil
