/**
 * Formules d'économie des objets (recyclage & amélioration) — SOURCE SERVEUR-AUTORITATIVE.
 *
 * Miroir EXACT de `frontend/app/composables/useItemFormulas.ts` : le front s'en sert pour l'AFFICHAGE
 * (aperçu du scrap gagné / du coût), mais le calcul qui fait AUTORITÉ (crédit/débit réel) doit se
 * faire ici, côté serveur — sinon le client peut envoyer un gain/coût arbitraire (triche économie).
 * Toute évolution du barème doit rester synchronisée entre les deux fichiers (#audit HIGH#1).
 *
 * Deux barèmes de rareté DISTINCTS (comme côté front) :
 *   - recyclage (`RECYCLE_RARITY_MULT`) : scrap gagné au recyclage ;
 *   - amélioration (`POWER_RARITY_MULT`) : miroir du barème de puissance, pondère le coût de niveau.
 * Rareté inconnue → multiplicateur 1 (jamais de NaN).
 */

type RarityInput = string | { name?: string | null } | null | undefined;

const RECYCLE_RARITY_MULT: Record<string, number> = { basic: 1, common: 2, rare: 5, epic: 10, legendary: 20 };
const POWER_RARITY_MULT: Record<string, number> = { basic: 1, common: 1.5, rare: 2, epic: 3, legendary: 5 };

function rarityKeyOf(rarity: RarityInput, fallback = ''): string {
  return (typeof rarity === 'string' ? rarity : rarity?.name || fallback).toLowerCase();
}

/** Scrap gagné en recyclant un objet : floor(niveau × mult_rareté + dégâts/2). Rareté inconnue → mult 1. */
export function calculateScrapForOneItem(item: { level?: number | null; index_damage?: number | null; rarity?: RarityInput }): number {
  const level = item.level || 1;
  const damage = item.index_damage || 0;
  const rarityMult = RECYCLE_RARITY_MULT[rarityKeyOf(item.rarity)] || 1;
  return Math.floor(level * rarityMult + damage / 2);
}

/** Coût (scrap + or) pour monter UN niveau, depuis le niveau courant. */
export function getLevelCost(level: number, rarity: RarityInput, indexDamage: number): { scrap: number; gold: number } {
  const rarityMult = POWER_RARITY_MULT[rarityKeyOf(rarity, 'common')] || 1;
  const damageGain = (indexDamage || 0) * rarityMult;
  const levelTax = 1 + level * 0.05;
  return { scrap: Math.ceil(damageGain * 0.5 * levelTax), gold: Math.ceil(damageGain * 5 * levelTax) };
}

/** Coût CUMULÉ pour monter `levels` niveaux depuis `currentLevel`. */
export function getCumulativeUpgradeCost(currentLevel: number, levels: number, rarity: RarityInput, indexDamage: number): { scrap: number; gold: number } {
  let scrap = 0;
  let gold = 0;
  for (let i = 0; i < levels; i++) {
    const c = getLevelCost(currentLevel + i, rarity, indexDamage);
    scrap += c.scrap;
    gold += c.gold;
  }
  return { scrap, gold };
}
