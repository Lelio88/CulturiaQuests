<template>
  <div>
    <div class="bg-white rounded-xl shadow-md border border-gray-100 flex overflow-hidden hover:shadow-lg transition-shadow duration-300 min-h-[100px]">
      <!-- Partie Gauche : Image (Buste) -->
      <div class="w-24 md:w-32 shrink-0 bg-gray-200 relative">
        <img
          :src="getNpcImage(getQuestNpc(quest))"
          :alt="getNpcName(getQuestNpc(quest))"
          class="w-full h-full object-cover object-top"
        />
      </div>

      <!-- Partie Droite : Contenu -->
      <div class="flex-1 p-3 flex flex-col justify-between gap-2">
        <div>
          <h2 class="font-pixel text-3xl">
            {{ getNpcName(getQuestNpc(quest)) }}
          </h2>

          <!-- Progression des 2 POI à visiter -->
          <ul class="mt-1 space-y-0.5">
            <li class="text-xs font-onest flex items-center gap-1.5" :class="poiADone ? 'text-green-600' : 'text-gray-500'">
              <span>{{ poiADone ? '✅' : '⏳' }}</span>
              <span class="truncate">{{ poiAName }}</span>
            </li>
            <li class="text-xs font-onest flex items-center gap-1.5" :class="poiBDone ? 'text-green-600' : 'text-gray-500'">
              <span>{{ poiBDone ? '✅' : '⏳' }}</span>
              <span class="truncate">{{ poiBName }}</span>
            </li>
          </ul>
        </div>

        <div class="flex justify-end">
          <!-- Les 2 POI visités mais pas encore réclamée → réclamer la récompense au PNJ -->
          <button
            v-if="claimable"
            :disabled="claiming"
            class="bg-[#59B846] hover:bg-[#469e36] disabled:opacity-60 text-white text-sm font-semibold py-2 px-6 rounded-lg transition-colors shadow-sm active:scale-95"
            @click="handleClaim"
          >
            {{ claiming ? '...' : 'Réclamer' }}
          </button>
          <!-- Sinon : bouton d'état (En cours / Complété) qui ouvre le dialogue du PNJ -->
          <QuestButton v-else class="scale-90 origin-bottom-right" :quest="quest" @toggle="showDialogue = true" />
        </div>
      </div>
    </div>

    <!-- Dialogue overlay RPG -->
    <Dialogue
      v-if="dialogLines.length > 0"
      :lines="dialogLines"
      :npc-firstname="npcFirstname"
      :text-type="dialogTextType"
      :visible="showDialogue"
      @complete="showDialogue = false"
    />
  </div>
</template>

<script setup lang="ts">
import type { Quest } from '~/types/quest'
import QuestButton from './QuestButton.vue'
import { useQuestStore } from '~/stores/quest'

const props = defineProps<{
  quest: Quest
}>()

const questStore = useQuestStore()
const showDialogue = ref(false)
const claiming = ref(false)

// Résolution polymorphe (nested v4 vs flattened v5)
const resolve = (raw: any) => raw?.data?.attributes || raw?.attributes || raw?.data || raw
const attrs = computed<any>(() => props.quest.attributes || props.quest)

// --- POI de la quête ---
const poiAName = computed(() => resolve(attrs.value.poi_a)?.name || 'Point A')
const poiBName = computed(() => resolve(attrs.value.poi_b)?.name || 'Point B')
const poiADone = computed(() => !!attrs.value.is_poi_a_completed)
const poiBDone = computed(() => !!attrs.value.is_poi_b_completed)

// --- États de la quête ---
const claimed = computed(() => !!attrs.value.date_end)
const bothDone = computed(() => poiADone.value && poiBDone.value)
const claimable = computed(() => bothDone.value && !claimed.value)
const questDocId = computed(() => attrs.value.documentId || (props.quest as any).documentId)

async function handleClaim() {
  if (claiming.value || !questDocId.value) return
  claiming.value = true
  const reward = await questStore.claimQuest(questDocId.value)
  claiming.value = false
  // Réclamation réussie (date_end désormais posé) → le PNJ affiche son dialogue de fin.
  if (reward) showDialogue.value = true
}

// --- Helpers PNJ (inchangés) ---
const getNpcImage = (npcRaw: any) => {
  const npcData = resolve(npcRaw)
  if (!npcData?.firstname) return '/assets/npc/placeholder.png'
  const name = npcData.firstname
  return `/assets/npc/${name}/${name}.webp`
}

const getNpcName = (npcRaw: any) => resolve(npcRaw)?.firstname || 'Inconnu'
const getQuestNpc = (quest: any) => (quest.attributes?.npc || quest.npc)

// Le dialogue de fin (quest_complete) s'affiche une fois la quête réclamée (date_end posé).
const dialogTextType = computed(() => (claimed.value && bothDone.value ? 'quest_complete' : 'quest_description'))

const npcFirstname = computed(() => resolve(getQuestNpc(props.quest))?.firstname || 'Inconnu')

const dialogLines = computed(() => {
  const data = resolve(getQuestNpc(props.quest))
  const dialogs = data?.dialogs?.data || data?.dialogs || []
  const targetType = dialogTextType.value
  const dialogObj = dialogs.find((d: any) => (d.attributes || d).text_type === targetType)
  if (!dialogObj) return []
  const dData = dialogObj.attributes || dialogObj
  return Array.isArray(dData.dialogues) ? dData.dialogues : []
})
</script>
