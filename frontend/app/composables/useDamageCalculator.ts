/**
 * Calcul de la puissance (« dégâts ») des objets d'équipement.
 *
 * Source unique de l'équilibrage : `RARITY_MULTIPLIERS`. Changer un multiplicateur ici le répercute
 * partout (6 consommateurs : EquipmentOverlay, PostCard, items, MuseumDrawer, equipement, createpost).
 *
 * La rareté arrive sous 3 formes selon l'origine de la donnée (d'où le type guard `resolveRarityKey`) :
 *   - string brute ('rare') ;
 *   - objet Strapi v4 imbriqué `{ data: { attributes: { name } } }` ;
 *   - objet Strapi v5 aplati `{ name }`.
 * Une rareté inconnue/absente retombe sur multiplicateur 1 (jamais de crash / NaN).
 *
 * @example
 * const { calculateItemPower, calculateTotalPower } = useDamageCalculator()
 * calculateItemPower({ index_damage: 10, level: 3, rarity: 'rare' }) // 60
 */

// Rareté acceptée sous string, objet Strapi v4 ({data:{attributes:{name}}}) ou v5 ({name}).
type RarityInput =
  | string
  | { name?: string | null }
  | { data?: { attributes?: { name?: string | null } } }
  | null
  | undefined

// Forme minimale requise pour le calcul — volontairement permissive (les 6 appelants passent des
// items de provenances variées : stores, posts, loot). On ne contraint que les champs utilisés.
interface DamageItem {
  index_damage?: number | string | null
  level?: number | string | null
  rarity?: RarityInput
}

const RARITY_MULTIPLIERS: Record<string, number> = {
  basic: 1,
  common: 1.5,
  rare: 2,
  epic: 3,
  legendary: 5,
}

function resolveRarityKey(rarity: RarityInput): string {
  if (typeof rarity === 'string') return rarity.toLowerCase()
  if (rarity && typeof rarity === 'object') {
    const v4 = (rarity as { data?: { attributes?: { name?: string | null } } }).data?.attributes?.name
    const v5 = (rarity as { name?: string | null }).name
    const name = v4 ?? v5
    if (name) return name.toLowerCase()
  }
  return 'common'
}

export const useDamageCalculator = () => {
  /**
   * Calcule les dégâts d'un objet unique : floor(index_damage × level × multiplicateur de rareté).
   * Sécurise les données (Number || défaut) pour éviter NaN.
   */
  const calculateItemPower = (item: DamageItem | null | undefined): number => {
    if (!item) return 0

    const base = Number(item.index_damage) || 0
    const level = Number(item.level) || 1
    const multiplier = RARITY_MULTIPLIERS[resolveRarityKey(item.rarity)] || 1

    return Math.floor(base * level * multiplier)
  }

  /** Somme de la puissance d'une liste d'objets (0 si liste absente/invalide). */
  const calculateTotalPower = (items: DamageItem[] | null | undefined): number => {
    if (!items || !Array.isArray(items)) return 0
    return items.reduce((total, item) => total + calculateItemPower(item), 0)
  }

  return {
    RARITY_MULTIPLIERS,
    calculateItemPower,
    calculateTotalPower,
  }
}
