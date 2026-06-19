/**
 * Formules d'économie des objets (recyclage & amélioration), extraites de EquipmentOverlay.vue
 * où elles étaient enfouies dans un composant de présentation. #37
 *
 * Deux barèmes de rareté DISTINCTS, volontairement séparés :
 *   - recyclage (`RECYCLE_RARITY_MULT`) : barème spécifique au scrap gagné en recyclant ;
 *   - amélioration (`POWER_RARITY_MULT`) : miroir du barème de puissance de useDamageCalculator
 *     (mêmes valeurs), utilisé pour pondérer le coût de montée de niveau.
 *
 * Les corps de fonction sont repris À L'IDENTIQUE de l'ancien composant (aucun changement de
 * comportement) : la rareté reçue est tantôt une string ('rare'), tantôt un objet Strapi `{ name }`
 * selon l'appelant — la résolution gère les deux. Une rareté inconnue retombe sur multiplicateur 1
 * (jamais de NaN).
 *
 * @example
 * const { calculateScrapForOneItem, getLevelCost, computeMaxAffordableLevels } = useItemFormulas()
 * calculateScrapForOneItem({ level: 3, index_damage: 10, rarity: 'rare' }) // floor(3*5 + 10/2) = 20
 * getLevelCost(1, 'common', 10)                                            // { scrap, gold }
 */

type RarityInput = string | { name?: string | null } | null | undefined

interface FormulaItem {
  level?: number | null
  index_damage?: number | null
  rarity?: RarityInput
}

interface LevelCost {
  scrap: number
  gold: number
}

const RECYCLE_RARITY_MULT: Record<string, number> = { basic: 1, common: 2, rare: 5, epic: 10, legendary: 20 }
const POWER_RARITY_MULT: Record<string, number> = { basic: 1, common: 1.5, rare: 2, epic: 3, legendary: 5 }

export function useItemFormulas() {
  /** Scrap gagné en recyclant un objet : floor(niveau × mult_rareté + dégâts/2). Rareté inconnue → mult 1. */
  function calculateScrapForOneItem(item: FormulaItem): number {
    const level = item.level || 1
    const damage = item.index_damage || 0
    const rarityKey = (typeof item.rarity === 'string' ? item.rarity : item.rarity?.name || '').toLowerCase()
    const rarityMult = RECYCLE_RARITY_MULT[rarityKey] || 1
    return Math.floor((level * rarityMult) + (damage / 2))
  }

  /** Coût (scrap + or) pour monter UN niveau, depuis le niveau courant. */
  function getLevelCost(level: number, rarity: RarityInput, indexDamage: number): LevelCost {
    const rarityKey = (typeof rarity === 'string' ? rarity : rarity?.name || 'common').toLowerCase()
    const rarityMult = POWER_RARITY_MULT[rarityKey] || 1
    const damageGain = (indexDamage || 0) * rarityMult
    const levelTax = 1 + level * 0.05
    return { scrap: Math.ceil(damageGain * 0.5 * levelTax), gold: Math.ceil(damageGain * 5 * levelTax) }
  }

  /**
   * Nombre maximal de niveaux finançables avec l'or et le scrap disponibles, en cumulant
   * le coût croissant de chaque niveau (plafond de sécurité : 1000 itérations).
   */
  function computeMaxAffordableLevels(params: {
    currentLevel: number
    rarity: RarityInput
    indexDamage: number
    userGold: number
    userScrap: number
  }): number {
    const { currentLevel, rarity, indexDamage, userGold, userScrap } = params
    let possibleLevels = 0
    let currentCostScrap = 0
    let currentCostGold = 0
    for (let i = 0; i < 1000; i++) {
      const nextLvlCost = getLevelCost(currentLevel + i, rarity, indexDamage)
      if (currentCostScrap + nextLvlCost.scrap <= userScrap && currentCostGold + nextLvlCost.gold <= userGold) {
        currentCostScrap += nextLvlCost.scrap
        currentCostGold += nextLvlCost.gold
        possibleLevels++
      } else {
        break
      }
    }
    return possibleLevels
  }

  return { calculateScrapForOneItem, getLevelCost, computeMaxAffordableLevels }
}
