<template>
  <div class="p-4 md:p-8">
    <!-- Header -->
    <div class="mb-8 text-center">
      <h1 class="text-2xl md:text-3xl font-power text-white tracking-wide">Vue d'ensemble</h1>
      <p class="text-gray-400 mt-1 font-onest text-sm">Statistiques globales de CulturiaQuests</p>
    </div>

    <!-- Loading State -->
    <div v-if="adminStore.loading && !adminStore.overview" class="space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="bg-gray-900 rounded-xl p-6 animate-pulse">
          <div class="h-4 bg-gray-800 rounded w-24 mb-3" />
          <div class="h-8 bg-gray-800 rounded w-16" />
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="adminStore.error" class="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
      <Icon name="bx-error-circle" class="w-8 h-8 text-red-400 mx-auto mb-2" />
      <p class="text-red-300 font-onest">{{ adminStore.error }}</p>
      <button class="mt-3 text-sm text-red-400 hover:text-red-300 underline" @click="adminStore.fetchOverview()">
        Réessayer
      </button>
    </div>

    <!-- Data -->
    <div v-else-if="adminStore.overview" class="space-y-8">
      <!-- KPI Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardKpiCard
          v-for="kpi in mainKpis"
          :key="kpi.label"
          :icon="kpi.icon"
          :label="kpi.label"
          :value="kpi.value"
          :sub="kpi.sub"
          :color="kpi.color"
        />
      </div>

      <!-- Activity & Economy Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Activity by period -->
        <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 class="text-lg font-power text-white mb-4">Activite recente</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm font-onest min-w-[400px]">
              <thead>
                <tr class="text-gray-500 border-b border-gray-800">
                  <th class="text-left py-2 pr-4">Metrique</th>
                  <th class="text-right py-2 px-4">24h</th>
                  <th class="text-right py-2 px-4">7j</th>
                  <th class="text-right py-2 pl-4">30j</th>
                </tr>
              </thead>
              <tbody class="text-gray-300">
                <tr v-for="row in activityRows" :key="row.label" class="border-b border-gray-800/50">
                  <td class="py-3 pr-4 flex items-center gap-2">
                    <Icon :name="row.icon" class="w-4 h-4 text-gray-500" />
                    {{ row.label }}
                  </td>
                  <td class="text-right py-3 px-4 font-medium">{{ row.last24h }}</td>
                  <td class="text-right py-3 px-4 font-medium">{{ row.last7d }}</td>
                  <td class="text-right py-3 pl-4 font-medium">{{ row.last30d }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Economy -->
        <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 class="text-lg font-power text-white mb-4">Economie</h2>
          <div class="space-y-4">
            <!-- Gold & XP -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="bg-gray-800/50 rounded-lg p-4">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Or en circulation</p>
                <p class="text-2xl font-bold text-amber-400">{{ formatNumber(adminStore.overview.economy.totalGoldInCirculation) }}</p>
              </div>
              <div class="bg-gray-800/50 rounded-lg p-4">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">XP totale</p>
                <p class="text-2xl font-bold text-blue-400">{{ formatNumber(adminStore.overview.economy.totalExpInCirculation) }}</p>
              </div>
            </div>

            <!-- Item rarity distribution -->
            <div>
              <p class="text-sm text-gray-400 mb-3">Repartition des items par rarete</p>
              <div class="space-y-2">
                <div
                  v-for="(count, rarity) in adminStore.overview.economy.itemsByRarity"
                  :key="rarity"
                  class="flex items-center gap-3"
                >
                  <span
                    class="text-xs font-medium w-24 capitalize"
                    :class="rarityColor(String(rarity))"
                  >
                    {{ rarity }}
                  </span>
                  <div class="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all"
                      :class="rarityBarColor(String(rarity))"
                      :style="{ width: rarityPercent(count as number) + '%' }"
                    />
                  </div>
                  <span class="text-sm text-gray-400 w-12 text-right">{{ count }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Connection Charts -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Weekly Connections Chart -->
        <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 class="text-lg font-power text-white mb-4">Connexions hebdomadaires</h2>
          <div v-if="!adminStore.connectionData" class="h-64 flex items-center justify-center">
            <div class="animate-pulse text-gray-600 text-sm font-onest">Chargement...</div>
          </div>
          <div v-else-if="weeklyChartData.length === 0" class="h-64 flex items-center justify-center">
            <p class="text-gray-600 text-sm font-onest">Aucune donnee de connexion disponible</p>
          </div>
          <div v-else>
            <LineChart
              :data="weeklyChartData"
              :height="280"
              :categories="weeklyCategories"
              :x-formatter="weeklyXFormatter"
              :y-grid-line="true"
              :x-num-ticks="6"
              :y-num-ticks="5"
              :curve-type="CurveType.MonotoneX"
            />
          </div>
        </div>

        <!-- Peak Hours Chart -->
        <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <h2 class="text-lg font-power text-white mb-4">Horaires de frequentation</h2>
          <div v-if="!adminStore.connectionData" class="h-64 flex items-center justify-center">
            <div class="animate-pulse text-gray-600 text-sm font-onest">Chargement...</div>
          </div>
          <div v-else-if="peakHoursData.length === 0" class="h-64 flex items-center justify-center">
            <p class="text-gray-600 text-sm font-onest">Aucune donnee de connexion disponible</p>
          </div>
          <div v-else>
            <BarChart
              :data="peakHoursData"
              :height="280"
              :categories="peakHoursCategories"
              :y-axis="['count']"
              :x-formatter="peakHoursXFormatter"
              :y-grid-line="true"
              :x-num-ticks="12"
              :y-num-ticks="5"
              :radius="4"
              :bar-padding="0.2"
            />
          </div>
        </div>
      </div>

      <!-- GDPR Requests -->
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="flex items-center gap-3 mb-4">
          <h2 class="text-lg font-power text-white">Demandes RGPD</h2>
          <span
            v-if="pendingGdprCount > 0"
            class="bg-amber-500 text-black text-xs font-bold px-2 py-0.5 rounded-full"
          >
            {{ pendingGdprCount }} en attente
          </span>
        </div>
        <div v-if="adminStore.gdprRequests.length === 0" class="text-gray-500 text-sm font-onest py-4 text-center">
          Aucune demande pour le moment
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm font-onest min-w-[600px]">
            <thead>
              <tr class="text-gray-500 border-b border-gray-800">
                <th class="text-left py-2 pr-4">Utilisateur</th>
                <th class="text-left py-2 px-4">Email</th>
                <th class="text-left py-2 px-4">Date</th>
                <th class="text-left py-2 px-4">Statut</th>
                <th class="py-2 pl-4" />
              </tr>
            </thead>
            <tbody class="text-gray-300">
              <tr
                v-for="req in adminStore.gdprRequests"
                :key="req.id"
                class="border-b border-gray-800/50"
              >
                <td class="py-3 pr-4">{{ req.user?.username || '–' }}</td>
                <td class="py-3 px-4 text-gray-400">{{ req.user?.email || '–' }}</td>
                <td class="py-3 px-4 text-gray-500">{{ formatDate(req.createdAt) }}</td>
                <td class="py-3 px-4">
                  <span
                    class="text-xs font-medium px-2 py-0.5 rounded-full"
                    :class="req.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'"
                  >
                    {{ req.status === 'pending' ? 'En attente' : 'Traité' }}
                  </span>
                </td>
                <td class="py-3 pl-4 text-right">
                  <button
                    v-if="req.status === 'pending'"
                    class="text-xs text-indigo-400 hover:text-indigo-300 underline"
                    @click="handleMarkGdprProcessed(req.id)"
                  >
                    Marquer traité
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-if="adminStore.gdprPagination.pageCount > 1"
          class="flex items-center justify-between mt-3 text-sm font-onest text-gray-400"
        >
          <button
            :disabled="adminStore.gdprPagination.page <= 1"
            class="px-3 py-1 rounded bg-gray-800 disabled:opacity-40 hover:bg-gray-700 transition-colors"
            @click="adminStore.fetchGdprRequests(adminStore.gdprPagination.page - 1)"
          >
            Précédent
          </button>
          <span>Page {{ adminStore.gdprPagination.page }} / {{ adminStore.gdprPagination.pageCount }} · {{ adminStore.gdprPagination.total }} demandes</span>
          <button
            :disabled="adminStore.gdprPagination.page >= adminStore.gdprPagination.pageCount"
            class="px-3 py-1 rounded bg-gray-800 disabled:opacity-40 hover:bg-gray-700 transition-colors"
            @click="adminStore.fetchGdprRequests(adminStore.gdprPagination.page + 1)"
          >
            Suivant
          </button>
        </div>
      </div>

      <!-- Mode Debug (admin) — toggle le geofence anti-triche pour la guilde de l'admin -->
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <Icon name="bx-bug" class="w-5 h-5 text-yellow-400" />
              <h2 class="text-lg font-power text-white">Mode Debug</h2>
              <span
                class="text-xs font-medium px-2 py-0.5 rounded-full"
                :class="guildStore.debugMode ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700/50 text-gray-400'"
              >
                {{ guildStore.debugMode ? 'Actif' : 'Inactif' }}
              </span>
            </div>
            <p class="text-sm text-gray-400 font-onest mt-1 max-w-xl">
              Désactive le geofence anti-triche <strong>pour votre propre guilde</strong> : permet de lancer
              expéditions et coffres sans être physiquement sur place (tests / démos). Réservé aux administrateurs.
            </p>
          </div>
          <button
            v-if="guildStore.hasGuild"
            class="shrink-0 px-4 py-2 rounded-lg font-onest text-sm font-medium border transition-colors disabled:opacity-50"
            :class="guildStore.debugMode
              ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40 hover:bg-yellow-500/30'
              : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700'"
            :disabled="guildStore.loading"
            @click="handleToggleDebug"
          >
            {{ guildStore.debugMode ? 'Désactiver' : 'Activer' }}
          </button>
          <p v-else class="shrink-0 text-sm text-gray-500 font-onest italic">
            Aucune guilde sur ce compte
          </p>
        </div>
      </div>

      <!-- Secondary KPIs -->
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div
          v-for="kpi in secondaryKpis"
          :key="kpi.label"
          class="bg-gray-900 border border-gray-800 rounded-xl p-4"
        >
          <div class="flex items-center gap-2 mb-2">
            <Icon :name="kpi.icon" class="w-4 h-4 text-gray-500" />
            <span class="text-xs text-gray-500 font-onest">{{ kpi.label }}</span>
          </div>
          <p class="text-xl font-bold text-white">{{ kpi.value }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: ['admin'],
})

const adminStore = useAdminStore()
const guildStore = useGuildStore()

onMounted(async () => {
  // Chargement initial parallèle, attendu et protégé : une promesse rejetée ne doit pas remonter
  // non gérée. Les stores positionnent déjà error.value en interne ; le catch est une ceinture. #81
  try {
    await Promise.all([
      adminStore.fetchOverview(),
      adminStore.fetchConnections(),
      adminStore.fetchGdprRequests(),
    ])
  } catch (e) {
    console.error('Dashboard initial load failed:', e)
  }

  // Charge la guilde de l'admin (pour l'état debug_mode du toggle), sans bloquer le dashboard si absente.
  try {
    if (!guildStore.hasGuild) await guildStore.fetchGuild()
  } catch (e) {
    console.error('Dashboard: guild fetch for debug toggle failed:', e)
  }
})

/**
 * Bascule le mode debug de la guilde de l'admin courant (endpoint admin-gated POST /guilds/toggle-debug).
 * Le store patche debug_mode depuis la réponse — pas besoin de refetch.
 */
async function handleToggleDebug() {
  try {
    await guildStore.toggleDebug()
  } catch (e) {
    console.error('Failed to toggle debug mode:', e)
  }
}

// KPI data
const mainKpis = computed(() => {
  const t = adminStore.overview?.totals
  const r = adminStore.overview?.recent
  if (!t || !r) return []
  return [
    {
      icon: 'bxs-user',
      label: 'Utilisateurs',
      value: t.users,
      sub: `+${r.newUsers7d} cette semaine`,
      color: 'blue',
    },
    {
      icon: 'bxs-castle',
      label: 'Guildes',
      value: t.guilds,
      sub: `+${r.newGuilds7d} cette semaine`,
      color: 'amber',
    },
    {
      icon: 'mdi:sword',
      label: 'Personnages',
      value: t.characters,
      sub: null,
      color: 'emerald',
    },
    {
      icon: 'bx-package',
      label: 'Items',
      value: t.items,
      sub: null,
      color: 'purple',
    },
  ]
})

const activityRows = computed(() => {
  const a = adminStore.overview?.activity
  if (!a) return []
  return [
    {
      icon: 'game-icons:medieval-barracks',
      label: 'Expeditions',
      ...a.expeditions,
    },
    {
      icon: 'game-icons:open-chest',
      label: 'Coffres ouverts',
      ...a.chestOpened,
    },
    {
      icon: 'bxs-brain',
      label: 'Quiz joues',
      ...a.quizAttempts,
    },
  ]
})

const secondaryKpis = computed(() => {
  const t = adminStore.overview?.totals
  if (!t) return []
  return [
    { icon: 'game-icons:medieval-barracks', label: 'Expeditions totales', value: t.runs },
    { icon: 'game-icons:open-chest', label: 'Visites totales', value: t.visits },
    { icon: 'game-icons:scroll-quill', label: 'Quetes totales', value: t.quests },
    { icon: 'bxs-brain', label: 'Quiz joues', value: t.quizAttempts },
  ]
})

// ─── Charts data ─────────────────────────────────────────
const weeklyChartData = computed(() => {
  const data = adminStore.connectionData?.weeklyConnections
  if (!data || data.length === 0) return []
  return data.map((w: any, i: number) => ({
    index: i,
    week: w.week,
    uniquePlayers: w.uniquePlayers,
    totalConnections: w.totalConnections,
  }))
})

const weeklyCategories = {
  uniquePlayers: { name: 'Joueurs uniques', color: '#3b82f6' },
  totalConnections: { name: 'Connexions totales', color: '#8b5cf6' },
}

const weeklyXFormatter = (tick: number): string => {
  const entry = weeklyChartData.value[tick]
  return entry?.week ?? ''
}

const peakHoursData = computed(() => {
  const data = adminStore.connectionData?.peakHours
  if (!data || data.length === 0) return []
  return data.map((h: any, i: number) => ({
    index: i,
    label: h.label,
    count: h.count,
  }))
})

const peakHoursCategories = {
  count: { name: 'Connexions', color: '#f59e0b' },
}

const peakHoursXFormatter = (tick: number): string => {
  const entry = peakHoursData.value[tick]
  return entry?.label ?? ''
}

// GDPR — compteur global (toutes pages) fourni par le serveur, pas calculé sur la page courante
const pendingGdprCount = computed(() => adminStore.gdprPendingCount)

async function handleMarkGdprProcessed(id: number) {
  try {
    await adminStore.markGdprProcessed(id)
  } catch (e) {
    console.error('Failed to mark GDPR request as processed:', e)
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '–'
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Helpers
function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

function rarityColor(rarity: string): string {
  const map: Record<string, string> = {
    basic: 'text-gray-400',
    common: 'text-green-400',
    rare: 'text-blue-400',
    epic: 'text-purple-400',
    legendary: 'text-amber-400',
  }
  return map[rarity.toLowerCase()] || 'text-gray-400'
}

function rarityBarColor(rarity: string): string {
  const map: Record<string, string> = {
    basic: 'bg-gray-500',
    common: 'bg-green-500',
    rare: 'bg-blue-500',
    epic: 'bg-purple-500',
    legendary: 'bg-amber-500',
  }
  return map[rarity.toLowerCase()] || 'bg-gray-500'
}

function rarityPercent(count: number): number {
  const total = Object.values(adminStore.overview?.economy.itemsByRarity || {}).reduce(
    (sum: number, c) => sum + (c as number),
    0
  )
  if (!total) return 0
  return Math.max(2, (count / total) * 100)
}
</script>
