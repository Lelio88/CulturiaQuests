<template>
  <transition name="slide-up">
    <div v-if="isOpen" class="fixed inset-0 z-[100] flex flex-col">
      
      <div class="absolute inset-0 bg-gray-100/95 backdrop-blur-sm" @click="closeModal"></div>

      <div class="relative flex flex-col h-full w-full max-w-lg mx-auto pointer-events-none">
        
        <OverlayHeader :title="headerTitle" @close="closeModal" />

        <div class="pointer-events-auto px-4 py-2">
          <TopPanelEquip 
            v-if="currentMode === 'normal'"
            :character="character"
            :activeSlot="activeSlot"
            @change-slot="changeSlot"
          />

          <TopPanelRecycle 
            v-else-if="currentMode === 'recycle'"
            :count="itemsToRecycle.size"
            :gain="totalScrapGain"
          />

          <TopPanelUpgrade 
            v-else-if="currentMode === 'upgrade'"
            :item="selectedItemObject"
            :userGold="guildStore.gold"
            :userScrap="guildStore.scrap"
            :cost="upgradeCost"
            :stats="projectedStats"
            :increment="upgradeIncrement"
            :canAfford="canAffordUpgrade"
            @set-increment="setUpgradeIncrement"
            @set-max="setMaxUpgrade"
          />
        </div>

        <InventoryGrid
          v-model:sortBy="sortBy"
          :items="filteredItems"
          :loading="loading"
          :activeTag="activeTag ?? undefined"
          :availableTags="availableTags"
          :isRecycleMode="currentMode === 'recycle'"
          :isUpgradeMode="currentMode === 'upgrade'"
          :selectedId="selectedItemId ?? undefined"
          :selectedRecycleIds="itemsToRecycle"
          @toggle-tag="toggleTag"
          @item-click="handleItemClick"
        />

        <ActionFooter 
          :mode="currentMode"
          :hasSelection="!!selectedItemId"
          :canRecycle="itemsToRecycle.size > 0"
          :canAffordUpgrade="canAffordUpgrade"
          :newLevel="projectedStats.newLevel"
          @equip="handleEquip"
          @toggle-recycle="toggleRecycleMode"
          @confirm-recycle="confirmRecycle"
          @toggle-upgrade="toggleUpgradeMode"
          @confirm-upgrade="confirmUpgrade"
        />

      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useGuildStore } from '~/stores/guild'
import { useInventoryStore } from '~/stores/inventory'
import { useDamageCalculator } from '~/composables/useDamageCalculator'
import { useItemFormulas } from '~/composables/useItemFormulas'
import { useFooterVisibility } from '~/composables/useFooterVisibility'

import OverlayHeader from './equipment/OverlayHeader.vue'
import InventoryGrid from './equipment/InventoryGrid.vue'
import ActionFooter from './equipment/ActionFooter.vue'
import TopPanelEquip from './equipment/TopPanelEquip.vue'
import TopPanelRecycle from './equipment/TopPanelRecycle.vue'
import TopPanelUpgrade from './equipment/TopPanelUpgrade.vue'

/**
 * Item d'inventaire projeté pour l'affichage (view-model issu de equipement.vue:mapSingleItem,
 * qui définit toujours ces champs — d'où leur caractère requis). `slot` est lu défensivement par
 * filteredItems mais non produit par le mapper (optionnel).
 */
interface InventoryItemView {
  id: number
  documentId?: string
  level: number
  index_damage: number
  rarity: string
  category: string
  image: string
  types: string[]
  isScrapped: boolean
  power: number
  slot?: string
  isEquippedByCurrentChar?: boolean
}

const props = defineProps<{
  isOpen?: boolean
  character?: Record<string, any>
  initialSlot?: string
  allInventory: InventoryItemView[]
  loading?: boolean
}>()
const emit = defineEmits(['close', 'equip'])

const guildStore = useGuildStore()
const inventoryStore = useInventoryStore()
const { calculateItemPower } = useDamageCalculator()
const { calculateScrapForOneItem, getLevelCost, computeMaxAffordableLevels } = useItemFormulas()
const { hideFooter, showFooter } = useFooterVisibility()

const activeSlot = ref('weapon');
const selectedItemId = ref<string | number | null>(null);
const sortBy = ref('rarity');
const activeTag = ref<string | null>(null);
const isRecycleMode = ref(false);
const itemsToRecycle = ref(new Set<number>());
const isUpgradeMode = ref(false);
const upgradeIncrement = ref(1);

const availableTags = ['nature', 'history', 'science', 'art', 'make', 'society'];
const rarityWeight: Record<string, number> = { legendary: 4, epic: 3, rare: 2, common: 1, basic: 0 };

const currentMode = computed(() => {
    if (isRecycleMode.value) return 'recycle';
    if (isUpgradeMode.value) return 'upgrade';
    return 'normal';
});

const headerTitle = computed(() => {
    if (currentMode.value === 'recycle') return 'Recyclage';
    if (currentMode.value === 'upgrade') return 'Amélioration';
    return 'Équipement';
});

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    if (props.initialSlot) activeSlot.value = props.initialSlot
    resetAllModes()
    hideFooter() // Masquer le footer quand l'overlay s'ouvre
  } else {
    showFooter() // Réafficher le footer quand l'overlay se ferme
  }
})

const closeModal = () => { 
  resetAllModes()
  showFooter() // Réafficher le footer à la fermeture
  emit('close')
}
const resetAllModes = () => {
    selectedItemId.value = null;
    isRecycleMode.value = false;
    isUpgradeMode.value = false;
    itemsToRecycle.value.clear();
    upgradeIncrement.value = 1;
};
const changeSlot = (slot: string) => {
  if (currentMode.value !== 'normal') return;
  activeSlot.value = slot;
  activeTag.value = null;
  selectedItemId.value = null;
};
const toggleTag = (tag: string) => { activeTag.value = activeTag.value === tag ? null : tag; };

const handleItemClick = (item: InventoryItemView) => {
    if (isRecycleMode.value) {
        if (itemsToRecycle.value.has(item.id)) itemsToRecycle.value.delete(item.id);
        else itemsToRecycle.value.add(item.id);
        return;
    }
    selectNewItem(item);
};
const selectNewItem = (item: InventoryItemView) => {
  selectedItemId.value = selectedItemId.value === item.id ? null : item.id;
  if(isUpgradeMode.value) upgradeIncrement.value = 1;
};
const toggleRecycleMode = () => {
    isRecycleMode.value = !isRecycleMode.value;
    isUpgradeMode.value = false; 
    itemsToRecycle.value.clear();
    selectedItemId.value = null;
};
const toggleUpgradeMode = () => {
    isUpgradeMode.value = !isUpgradeMode.value;
    isRecycleMode.value = false; 
    selectedItemId.value = null;
    upgradeIncrement.value = 1;
};

// --- LOGIQUE RECYCLAGE ---
// Formule de scrap extraite dans useItemFormulas (#37). Le total est calculé ici sur le view-model
// (rareté en string) puis transmis au store, qui ne le recalcule pas sur les items bruts.
const totalScrapGain = computed(() => {
    let total = 0;
    itemsToRecycle.value.forEach(id => {
        const item = props.allInventory.find(i => i.id === id);
        if (item) total += calculateScrapForOneItem(item);
    });
    return total;
});
const confirmRecycle = async () => {
    if (itemsToRecycle.value.size === 0) return;
    try {
        // Recyclage serveur-autoritatif (#audit HIGH#1) : le store n'envoie que les ids, le scrap est
        // calculé + crédité côté serveur. totalScrapGain reste utilisé pour l'aperçu UI uniquement.
        await inventoryStore.recycleItems(Array.from(itemsToRecycle.value));
        resetAllModes();
    } catch (e) { console.error("Erreur recyclage", e); }
};

// --- LOGIQUE AMÉLIORATION ---
const selectedItemObject = computed(() => {
    if (!selectedItemId.value) return null;
    return props.allInventory.find(i => i.id === selectedItemId.value) || null;
});
// getLevelCost extrait dans useItemFormulas (#37).
const upgradeCost = computed(() => {
    if (!selectedItemObject.value) return { scrap: 0, gold: 0 };
    const currentLevel = selectedItemObject.value.level || 1;
    const rarity = selectedItemObject.value.rarity;
    const indexDamage = selectedItemObject.value.index_damage || 0;
    let totalScrap = 0, totalGold = 0;
    for (let i = 0; i < upgradeIncrement.value; i++) {
        const lvlCost = getLevelCost(currentLevel + i, rarity, indexDamage);
        totalScrap += lvlCost.scrap; totalGold += lvlCost.gold;
    }
    return { scrap: totalScrap, gold: totalGold };
});
const projectedStats = computed(() => {
    if (!selectedItemObject.value) return { newLevel: 0, damageGain: 0 };
    const item = selectedItemObject.value;
    const currentDmg = calculateItemPower(item);
    const futureDmg = calculateItemPower({ ...item, level: item.level + upgradeIncrement.value });
    return { newLevel: item.level + upgradeIncrement.value, damageGain: futureDmg - currentDmg };
});
const canAffordUpgrade = computed(() => {
    return (guildStore.gold || 0) >= upgradeCost.value.gold && (guildStore.scrap || 0) >= upgradeCost.value.scrap;
});
const setUpgradeIncrement = (val: number) => { upgradeIncrement.value = val; };
const setMaxUpgrade = () => {
    if (!selectedItemObject.value) return;
    const possibleLevels = computeMaxAffordableLevels({
        currentLevel: selectedItemObject.value.level || 1,
        rarity: selectedItemObject.value.rarity,
        indexDamage: selectedItemObject.value.index_damage || 0,
        userGold: guildStore.gold || 0,
        userScrap: guildStore.scrap || 0,
    });
    upgradeIncrement.value = possibleLevels > 0 ? possibleLevels : 1;
};
const confirmUpgrade = async () => {
    if (!selectedItemObject.value || !canAffordUpgrade.value) return;
    try {
        // Amélioration serveur-autoritative (#audit HIGH#1) : le store envoie l'item + le nombre de
        // niveaux ; le coût est calculé + débité côté serveur (upgradeCost reste pour l'aperçu UI).
        await inventoryStore.upgradeItem(selectedItemObject.value.id, upgradeIncrement.value);
        upgradeIncrement.value = 1;
    } catch (e) { console.error("Erreur upgrade", e); }
};

// --- LOGIQUE STANDARD ---
const handleEquip = () => {
  if (!selectedItemId.value) return;
  const itemToEquip = props.allInventory.find(i => i.id === selectedItemId.value);
  if (itemToEquip) { emit('equip', itemToEquip); selectedItemId.value = null; }
};

// Dans components/EquipmentOverlay.vue

// --- FILTRAGE ET TRI ---
const filteredItems = computed(() => {
  if (!props.allInventory) return [];
  
  let items = props.allInventory.filter(item => {
    // 1. Filtrer les items recyclés
    const isNotScrapped = !item.isScrapped;

    // 2. Filtrer par slot (Arme, Armure...)
    const isCategoryMatch = (item.category || item.slot || '').toLowerCase() === activeSlot.value.toLowerCase();

    // 3. Vérifier si l'objet est déjà équipé par QUICONQUE
    const rawItem = inventoryStore.items.find(i => i.id === item.id);
    let isEquipped = false;

    if (rawItem) {
        const attrs: any = rawItem.attributes || rawItem;

        if (attrs.character) {
             if (attrs.character.data) isEquipped = true;
             else if (typeof attrs.character === 'number' || attrs.character.id) isEquipped = true;
        }
    }

    // 4. En mode upgrade, autoriser les items équipés par le personnage sélectionné
    const isEquippedByCurrentChar = isEquipped && rawItem && (() => {
      const attrs: any = rawItem.attributes || rawItem;
      const charData = attrs.character?.data || attrs.character;
      const equippedCharId = charData?.id ?? charData;
      return equippedCharId === props.character?.id;
    })();

    const shouldExclude = isEquipped && !(currentMode.value === 'upgrade' && isEquippedByCurrentChar);
    return isCategoryMatch && !shouldExclude && isNotScrapped;
  });

  // Enrichir les items avec le flag isEquippedByCurrentChar pour l'affichage du badge
  items = items.map(item => {
    const rawItem = inventoryStore.items.find(i => i.id === item.id);
    let equipped = false;
    if (rawItem) {
      const attrs: any = rawItem.attributes || rawItem;
      if (attrs.character) {
        const charData = attrs.character?.data || attrs.character;
        const equippedCharId = charData?.id ?? charData;
        equipped = equippedCharId === props.character?.id;
      }
    }
    return equipped ? { ...item, isEquippedByCurrentChar: true } : item;
  });

  // Filtrage par Tag (Nature, Art...)
  if (activeTag.value) {
      const tag = activeTag.value.toLowerCase();
      items = items.filter(item => item.types && item.types.includes(tag));
  }

  // Tri
  return items.sort((a, b) => {
    if (sortBy.value === 'damage') {
        const dmgA = calculateItemPower(a);
        const dmgB = calculateItemPower(b);
        if (dmgA === dmgB) return b.level - a.level; return dmgB - dmgA;
    }
    if (sortBy.value === 'level') return b.level - a.level;
    const weightA = rarityWeight[a.rarity?.toLowerCase()] || 0, weightB = rarityWeight[b.rarity?.toLowerCase()] || 0;
    if (weightB === weightA) return b.level - a.level; return weightB - weightA;
  });
});
</script>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translateY(20px); }
</style>