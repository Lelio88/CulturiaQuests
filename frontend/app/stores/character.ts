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
 * - Le catalogue d'icônes a son propre couple `iconsLoading` / `iconsError`, séparé de `loading` /
 *   `error` : il se charge sur l'écran d'inscription, hors session, et son échec bloque tout le
 *   parcours (cf. `fetchCharacterIcons`).
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
  const iconsError = ref<string | null>(null)

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
        const icon = ((attrs.icon as { data?: StrapiMedia })?.data || attrs.icon) as { id?: number } | null | undefined
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
      characters.value[index] = { ...characters.value[index], ...updates } as Character
    }
  }

  /**
   * Applique localement un changement d'équipement, après un PUT réussi côté API.
   *
   * Remplace le `fetchCharacters(true)` qui suivait chaque swap : celui-ci rechargeait tous les
   * personnages avec leurs items et toutes leurs relations pour un changement d'une seule pièce.
   * L'item fourni provient de l'inventaire, dont le populate (rarity, tags, icon) couvre celui de
   * `fetchCharacters(true)` — l'objet inséré est donc affichable tel quel.
   *
   * Passer `newItem: null` retire simplement l'ancienne pièce (déséquipement sec).
   *
   * @param characterId - Personnage concerné
   * @param oldItemId - Item à retirer du personnage, ou `null` si le slot était vide
   * @param newItem - Item à ajouter, ou `null` pour un simple retrait
   */
  function applyEquipmentSwap(
    characterId: number,
    oldItemId: number | null,
    newItem: Record<string, unknown> | null
  ) {
    const index = characters.value.findIndex(c => c.id === characterId)
    if (index === -1) return

    const character = characters.value[index] as Record<string, unknown>
    const holder = (character.attributes || character) as Record<string, unknown>

    // `items` arrive soit comme tableau nu (v5), soit enveloppé dans `{ data: [...] }` (v4).
    // On conserve la forme d'origine pour ne pas casser les lecteurs en aval.
    const rawItems = holder.items as unknown
    const isWrapped = !Array.isArray(rawItems) && !!(rawItems as { data?: unknown })?.data
    const list = (Array.isArray(rawItems)
      ? rawItems
      : ((rawItems as { data?: unknown[] })?.data || [])) as Record<string, unknown>[]

    const next = list.filter(i => i.id !== oldItemId)
    if (newItem) next.push(newItem)

    const nextItems = isWrapped ? { ...(rawItems as object), data: next } : next
    const nextHolder = { ...holder, items: nextItems }

    // Cast via `unknown` : payload polymorphe (v4/v5) que le type `Character` ne décrit que
    // partiellement, l'imbrication `attributes` n'y étant pas modélisée.
    characters.value[index] = (character.attributes
      ? { ...character, attributes: nextHolder }
      : nextHolder) as unknown as Character
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

  /**
   * Charge le catalogue d'icônes de personnage (route publique, consommée AVANT authentification
   * par l'écran d'inscription).
   *
   * `iconsError` est distinct de `error` (réservé au CRUD personnage) car l'échec n'a pas la même
   * conséquence : sans icônes, l'inscription est INFRANCHISSABLE (`canProceed` exige un `iconId`).
   * L'erreur doit donc rester visible et l'appel rejouable — la traiter comme « liste vide »
   * afficherait « Aucun élément disponible », indiscernable d'un catalogue réellement vide, et
   * laisserait le joueur bloqué sur un bouton grisé sans explication ni recours.
   *
   * Invariant : ne jamais retomber silencieusement sur `[]`. Un appel qui échoue laisse
   * `availableIcons` intact (un catalogue déjà chargé survit à un réessai raté).
   */
  async function fetchCharacterIcons() {
    const client = useApi()
    iconsLoading.value = true
    iconsError.value = null

    try {
      const response = await client<StrapiListResponse<StrapiMedia>>('/character-icons', {
        method: 'GET',
      })

      const data = response.data || response
      availableIcons.value = Array.isArray(data) ? data : []
    } catch (e: any) {
      console.error('Failed to fetch character icons:', e)
      // Message FIXE, volontairement non dérivé de l'erreur : les causes réelles (« fetch failed »,
      // « Non authentifié », timeout du proxy) ne disent rien à un joueur et l'action utile est la
      // même dans tous les cas — vérifier sa connexion et réessayer.
      iconsError.value = 'Impossible de charger les icônes. Vérifie ta connexion, puis réessaie.'
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
    iconsError,
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
    applyEquipmentSwap,
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
