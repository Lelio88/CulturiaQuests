<template>
  <div class="min-h-screen flex flex-col bg-[#f3f3f3] pb-24">
    <!-- Header -->
    <div class="flex items-center px-6 pt-[env(safe-area-inset-top)] pb-4">
      <div
        class="bg-white rounded-full w-10 h-10 flex items-center justify-center shrink-0 cursor-pointer"
        @click="router.push('/social/friends')"
      >
        <Icon name="mdi:arrow-left" class="w-6 h-6 text-black" />
      </div>
      <h1 class="flex-1 text-center text-2xl font-power text-indigo-950 pr-10 truncate">Profil</h1>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="w-10 h-10 border-4 border-[#4D4DFF] border-t-transparent rounded-full animate-spin" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center px-6">
      <p class="text-sm font-onest text-indigo-950 opacity-60 text-center">{{ error }}</p>
    </div>

    <div v-else class="flex-1 overflow-y-auto px-6 space-y-4">
      <!-- Identité -->
      <div class="bg-white rounded-[28px] p-6 text-center">
        <div class="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-3">
          <Icon name="mdi:account" class="w-9 h-9 text-indigo-500" />
        </div>
        <p class="font-power text-xl text-indigo-950 truncate">{{ summary?.guildName || 'Guilde' }}</p>
        <p class="text-sm font-onest text-indigo-950 opacity-60 mt-1">
          {{ completedCount }} zone{{ completedCount > 1 ? 's' : '' }} complétée{{ completedCount > 1 ? 's' : '' }}
        </p>
      </div>

      <!-- Badges favoris (équipés) -->
      <div class="bg-white rounded-[28px] p-6">
        <h2 class="text-xl font-power text-indigo-950 mb-4">Badges favoris</h2>
        <div v-if="displayBadges.length > 0" class="grid grid-cols-4 gap-3">
          <div v-for="badge in displayBadges" :key="badge.id" class="flex flex-col items-center gap-1">
            <div
              class="w-full aspect-square bg-indigo-50 rounded-xl p-1 border border-indigo-100 flex items-center justify-center overflow-hidden"
            >
              <img :src="badge.image" :alt="badge.name" class="w-full h-full object-contain">
            </div>
            <span class="text-[10px] font-onest text-indigo-950 opacity-60 text-center truncate w-full">
              {{ badge.name }}
            </span>
          </div>
        </div>
        <p v-else class="text-sm font-onest text-indigo-950 opacity-40 text-center py-4">
          Aucun badge équipé
        </p>
      </div>

      <!-- Exploration -->
      <div class="bg-white rounded-[28px] p-6">
        <h2 class="text-xl font-power text-indigo-950 mb-4">Exploration</h2>
        <div class="grid grid-cols-3 gap-3 text-center">
          <div>
            <p class="text-2xl font-power text-indigo-600">{{ summary?.completedComcomIds?.length || 0 }}</p>
            <p class="text-xs font-onest text-indigo-950 opacity-60">Comcoms</p>
          </div>
          <div>
            <p class="text-2xl font-power text-indigo-600">{{ summary?.completedDepartmentIds?.length || 0 }}</p>
            <p class="text-xs font-onest text-indigo-950 opacity-60">Départements</p>
          </div>
          <div>
            <p class="text-2xl font-power text-indigo-600">{{ summary?.completedRegionIds?.length || 0 }}</p>
            <p class="text-xs font-onest text-indigo-950 opacity-60">Régions</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useZoneStore } from '~/stores/zone'
import { resolveEquippedBadge, type DisplayBadge } from '~/utils/badgeAssets'

interface BadgeSummary {
  guildName: string
  equippedBadgeIds: string[]
  completedComcomIds: string[]
  completedDepartmentIds: string[]
  completedRegionIds: string[]
}

const router = useRouter()
const route = useRoute()
const zoneStore = useZoneStore()

const guildId = computed(() => route.params.guildId as string)
const loading = ref(true)
const error = ref<string | null>(null)
const summary = ref<BadgeSummary | null>(null)

const completedCount = computed(() =>
  (summary.value?.completedComcomIds?.length || 0) +
  (summary.value?.completedDepartmentIds?.length || 0) +
  (summary.value?.completedRegionIds?.length || 0)
)

const displayBadges = computed<DisplayBadge[]>(() => {
  const ids = summary.value?.equippedBadgeIds || []
  // Comcoms complétées de l'ami → sert à calculer le VRAI palier (bronze/or/plat) des badges
  // dépt/région, comme le fait stores/badge.ts pour ses propres badges.
  const completedComcomIds = new Set(summary.value?.completedComcomIds || [])
  return ids
    .map(id => resolveEquippedBadge(id, {
      comcoms: zoneStore.comcoms,
      departments: zoneStore.departments,
      regions: zoneStore.regions,
    }, completedComcomIds))
    .filter((b): b is DisplayBadge => b !== null)
})

onMounted(async () => {
  try {
    if (!zoneStore.isInitialized) {
      await zoneStore.init()
    }
    const client = useApi()
    const res = await client<any>(`/guilds/${guildId.value}/badge-summary`)
    // Le controller renvoie l'objet à plat (ctx.send) ; on tolère un éventuel wrapper { data }.
    summary.value = (res?.data ?? res) as BadgeSummary
  } catch (e: any) {
    console.error('Failed to load friend profile:', e)
    error.value = 'Profil indisponible'
  } finally {
    loading.value = false
  }
})

definePageMeta({
  layout: 'default',
})
</script>
