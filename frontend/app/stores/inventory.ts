import { defineStore } from 'pinia'
import type { Item } from '~/types/item'
import type { StrapiListResponse } from '~/types/strapi'
import { useGuildStore } from './guild'

/**
 * Store de l'inventaire du joueur (items de la guilde) + catalogue d'icônes d'items.
 *
 * Détient les items rattachés à la guilde de l'utilisateur courant (filtrés côté serveur) et
 * expose des getters de tri/filtre : par slot (`weapon` | `helmet` | `charm`), par rareté,
 * items recyclés (`scrappedItems`) vs équipables (`equippableItems`).
 *
 * Choix non-évidents :
 * - Les getters tolèrent les deux formes de payload Strapi (champ direct ou `attributes.*`,
 *   `rarity` ou `rarity.data.attributes`) car les items arrivent via `fetchAll()` (populate profond)
 *   et via `fetchItems()`.
 * - `updateItem(itemId, updates)` applique une mise à jour IMMUABLE : remplace l'entrée par un
 *   nouvel objet `{ ...ancien, ...updates }` au lieu de muter en place.
 *
 * Invariant : store NON persisté — rechargé via `useGuildStore().fetchAll()` (cf. note en bas de
 * fichier) car les items imbriquent beaucoup de relations (rarity, tags, icon, character) ;
 * les persister en cookie déclencherait l'erreur 431 (Request Header Fields Too Large).
 *
 * @example
 * const inventory = useInventoryStore()
 * inventory.updateItem(item.id, { isScrapped: true }) // marque recyclé sans muter l'item d'origine
 */
export const useInventoryStore = defineStore('inventory', () => {
  // State
  const items = ref<Item[]>([])
  const availableIcons = ref<Record<string, unknown>[]>([])
  const loading = ref(false)
  const iconsLoading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const hasItems = computed(() => items.value.length > 0)
  const itemCount = computed(() => items.value.length)

  const itemsBySlot = computed(() => {
    return (slot: 'weapon' | 'helmet' | 'charm') => {
      return items.value.filter(i =>
        i.slot === slot || i.attributes?.slot === slot
      )
    }
  })

  const itemsByRarity = computed(() => {
    return (rarityName: string) => {
      return items.value.filter(i => {
        const rarity = i.rarity || i.attributes?.rarity
        return rarity?.name === rarityName || rarity?.data?.attributes?.name === rarityName
      })
    }
  })

  const scrappedItems = computed(() => {
    return items.value.filter(i =>
      i.isScrapped || i.attributes?.isScrapped
    )
  })

  const equippableItems = computed(() => {
    return items.value.filter(i =>
      !(i.isScrapped || i.attributes?.isScrapped)
    )
  })

  // Actions
  function setItems(data: Item[]) {
    items.value = data
  }

  function clearItems() {
    items.value = []
    error.value = null
  }

  function addItem(item: Item) {
    items.value.push(item)
  }

  function removeItem(itemId: number) {
    items.value = items.value.filter(i => i.id !== itemId)
  }

  function updateItem(itemId: number, updates: Partial<Item>) {
    const index = items.value.findIndex(i => i.id === itemId)
    if (index !== -1) {
      items.value[index] = { ...items.value[index], ...updates }
    }
  }

  async function fetchItems() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<StrapiListResponse<Item>>('/items', {
        method: 'GET',
        params: {
          populate: {
            rarity: true,
            tags: true,
            character: true,
            icon: { fields: ['url'] },
          },
        },
      })

      const data = response.data || response
      setItems(Array.isArray(data) ? data : [])
    } catch (e: any) {
      console.error('Failed to fetch items:', e)
      error.value = e?.message || 'Failed to fetch items'
    } finally {
      loading.value = false
    }
  }

  async function fetchItemIcons() {
    const client = useApi()
    iconsLoading.value = true
    try {
      const response = await client<StrapiListResponse<Record<string, unknown>>>('/item-icons')
      availableIcons.value = response.data || []
    } catch (e: any) {
      console.error('Failed to fetch item icons:', e)
    } finally {
      iconsLoading.value = false
    }
  }

  /**
   * Recycle une liste d'items (#37) : marque chaque item `isScrapped` côté API (et le détache de
   * son personnage), crédite la guilde du scrap gagné, puis met à jour l'état local de façon
   * IMMUABLE (via `updateItem`, plus de mutation directe).
   *
   * `scrapGain` est calculé et fourni par l'appelant (depuis le view-model, rareté en string) —
   * NE PAS le recalculer ici sur les items bruts du store (rareté en objet), au risque d'un
   * multiplicateur erroné. L'écriture du scrap guilde est ABSOLUE (scrap courant + gain), iso au
   * comportement existant.
   */
  async function recycleItems(itemIds: number[], scrapGain: number): Promise<void> {
    const client = useApi()
    const guildStore = useGuildStore()

    // 1. Marquer chaque item recyclé côté API
    for (const id of itemIds) {
      const item = items.value.find(i => i.id === id)
      if (!item) continue
      const apiId = item.documentId || item.id
      await client(`/items/${apiId}`, { method: 'PUT', body: { data: { isScrapped: true, character: null } } })
    }

    // 2. Créditer la guilde (écriture absolue : iso comportement existant)
    if (guildStore.guild) {
      const guildApiId = guildStore.guild.documentId || guildStore.guild.id
      await client(`/guilds/${guildApiId}`, { method: 'PUT', body: { data: { scrap: (guildStore.scrap || 0) + scrapGain } } })
      await guildStore.refetchStats()
    }

    // 3. Mise à jour locale IMMUABLE
    for (const id of itemIds) {
      updateItem(id, { isScrapped: true } as Partial<Item>)
    }
  }

  /**
   * Améliore un item au niveau `newLevel` (#37) : débite la guilde de `cost` (or + scrap, écriture
   * ABSOLUE iso à l'existant), monte le niveau de l'item côté API, puis met à jour l'état local de
   * façon IMMUABLE. L'appelant a déjà vérifié la solvabilité (`canAffordUpgrade`).
   */
  async function upgradeItem(itemId: number, newLevel: number, cost: { gold: number; scrap: number }): Promise<void> {
    const client = useApi()
    const guildStore = useGuildStore()
    const item = items.value.find(i => i.id === itemId)
    const apiId = item?.documentId || itemId

    // 1. Débiter la guilde (écriture absolue : iso)
    if (guildStore.guild) {
      const guildApiId = guildStore.guild.documentId || guildStore.guild.id
      await client(`/guilds/${guildApiId}`, { method: 'PUT', body: { data: { gold: guildStore.gold - cost.gold, scrap: guildStore.scrap - cost.scrap } } })
      await guildStore.refetchStats()
    }

    // 2. Monter le niveau de l'item côté API
    await client(`/items/${apiId}`, { method: 'PUT', body: { data: { level: newLevel } } })

    // 3. Mise à jour locale IMMUABLE
    updateItem(itemId, { level: newLevel } as Partial<Item>)
  }

  return {
    // State
    items,
    availableIcons,
    loading,
    iconsLoading,
    error,
    // Getters
    hasItems,
    itemCount,
    itemsBySlot,
    itemsByRarity,
    scrappedItems,
    equippableItems,
    // Actions
    setItems,
    clearItems,
    addItem,
    removeItem,
    updateItem,
    fetchItems,
    fetchItemIcons,
    recycleItems,
    upgradeItem,
  }
})
// Persistance supprimée - les items sont rechargés via guildStore.fetchAll()
// Cela évite l'erreur 431 (cookies trop volumineux) car les items
// contiennent beaucoup de données imbriquées (rarity, tags, icon, character)
