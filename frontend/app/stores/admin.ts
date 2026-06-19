import { defineStore } from 'pinia'

interface PlayerSummary {
  id: number
  username: string
  email: string
  blocked: boolean
  createdAt: string
  role: { id: number; name: string; type: string }
  guild: {
    id: number; documentId: string; name: string; gold: number; exp: number | string
    scrap: number; debug_mode: boolean; level: number; characterCount: number; itemCount: number
  } | null
}

interface PlayerDetail extends PlayerSummary {
  characters: Array<{ id: number; documentId: string; firstname: string; lastname: string; icon?: { url: string } }>
  stats: Record<string, any> | null
  recentActivity: { runs: any[]; visits: any[]; quizAttempts: any[] }
}

interface ActivityPeriod { last24h: number; last7d: number; last30d: number }

interface DashboardOverview {
  totals: { users: number; guilds: number; characters: number; items: number; runs: number; visits: number; quests: number; quizAttempts: number }
  recent: { newUsers7d: number; newGuilds7d: number }
  activity: { expeditions: ActivityPeriod; chestOpened: ActivityPeriod; quizAttempts: ActivityPeriod }
  economy: { totalGoldInCirculation: number; totalExpInCirculation: number; itemsByRarity: Record<string, number> }
}

interface Pagination { page: number; pageSize: number; pageCount: number; total: number }

/**
 * Store du dashboard admin : agrège les données de pilotage exposées par les endpoints
 * custom `/admin-dashboard/*` du backend (overview, joueurs, carte, économie, expéditions,
 * quiz, social, connexions, demandes RGPD).
 *
 * Choix non-évidents :
 * - Les payloads ne sont PAS du CRUD Strapi standard : chaque endpoint renvoie une forme
 *   pré-agrégée côté serveur. Beaucoup de slices sont donc typées `any` (mapData, economyData,
 *   etc.) faute de contrat figé ; seuls overview/players/playerDetail/RGPD ont une interface.
 * - Les mutations (toggleBlockPlayer, changePlayerRole) patchent le tableau `players` ET
 *   `playerDetail` en local après succès API, pour éviter un refetch complet de la liste.
 * - `markGdprProcessed` n'applique la mutation locale (statut + décrément du compteur) qu'APRÈS
 *   le succès de l'await : sur échec API, l'état reste cohérent avec le serveur (#81).
 *
 * Invariants :
 * - Réservé au rôle `admin` : ces endpoints exposent des données cross-utilisateur et ne sont
 *   donc PAS soumis à l'isolation par `guild.user`. L'accès est gardé par les permissions
 *   `admin-dashboard.*` accordées au bootstrap backend, jamais via le store.
 * - `clearAdmin()` doit remettre toutes les slices à leur valeur initiale (appel au logout/
 *   changement de compte) pour ne pas laisser fuiter les données admin d'une session précédente.
 * - Toutes les actions passent par `useApi()` (client BFF httpOnly), jamais d'appel Strapi direct.
 */
export const useAdminStore = defineStore('admin', () => {
  const overview = ref<DashboardOverview | null>(null)
  const players = ref<PlayerSummary[]>([])
  const playerDetail = ref<PlayerDetail | null>(null)
  const pagination = ref<Pagination>({ page: 1, pageSize: 25, pageCount: 0, total: 0 })
  const mapData = ref<any>(null)
  const economyData = ref<any>(null)
  const expeditionsData = ref<any>(null)
  const quizData = ref<any>(null)
  const socialData = ref<any>(null)
  const connectionData = ref<any>(null)
  const gdprRequests = ref<any[]>([])
  const gdprPagination = ref({ page: 1, pageSize: 10, pageCount: 0, total: 0 })
  const gdprPendingCount = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchOverview() {
    const client = useApi()
    loading.value = true; error.value = null
    try { overview.value = await client<DashboardOverview>('/admin-dashboard/overview', { method: 'GET' }) }
    catch (e: any) { error.value = e?.message || 'Failed to fetch overview' }
    finally { loading.value = false }
  }

  async function fetchPlayers(params: { page?: number; pageSize?: number; search?: string; sortBy?: string; sortOrder?: string } = {}) {
    const client = useApi()
    loading.value = true; error.value = null
    try {
      const response = await client<{ data: PlayerSummary[]; pagination: Pagination }>('/admin-dashboard/players', {
        method: 'GET', params: { page: params.page || 1, pageSize: params.pageSize || 25, search: params.search || '', sortBy: params.sortBy || 'createdAt', sortOrder: params.sortOrder || 'desc' },
      })
      players.value = response.data; pagination.value = response.pagination
    } catch (e: any) { error.value = e?.message || 'Failed to fetch players' }
    finally { loading.value = false }
  }

  async function fetchPlayerDetail(userId: number) {
    const client = useApi()
    loading.value = true; error.value = null
    try { playerDetail.value = await client<PlayerDetail>(`/admin-dashboard/players/${userId}`, { method: 'GET' }) }
    catch (e: any) { error.value = e?.message || 'Failed to fetch player detail' }
    finally { loading.value = false }
  }

  async function toggleBlockPlayer(userId: number) {
    const client = useApi()
    try {
      const response = await client<{ id: number; username: string; blocked: boolean }>(`/admin-dashboard/players/${userId}/toggle-block`, { method: 'PUT' })
      const idx = players.value.findIndex((p) => p.id === userId)
      if (idx !== -1) players.value[idx].blocked = response.blocked
      if (playerDetail.value?.id === userId) playerDetail.value.blocked = response.blocked
      return response
    } catch (e: any) { error.value = e?.message || 'Failed to toggle block'; throw e }
  }

  async function changePlayerRole(userId: number, role: string) {
    const client = useApi()
    try {
      const response = await client<{ id: number; username: string; role: { id: number; name: string; type: string } }>(`/admin-dashboard/players/${userId}/role`, { method: 'PUT', body: { role } })
      const idx = players.value.findIndex((p) => p.id === userId)
      if (idx !== -1) players.value[idx].role = response.role
      if (playerDetail.value?.id === userId) playerDetail.value.role = response.role
      return response
    } catch (e: any) { error.value = e?.message || 'Failed to change role'; throw e }
  }

  async function fetchMapData() {
    const client = useApi()
    loading.value = true; error.value = null
    try { mapData.value = await client<any>('/admin-dashboard/map', { method: 'GET' }) }
    catch (e: any) { error.value = e?.message || 'Failed to fetch map data' }
    finally { loading.value = false }
  }

  async function fetchEconomy() {
    const client = useApi()
    loading.value = true; error.value = null
    try { economyData.value = await client<any>('/admin-dashboard/economy', { method: 'GET' }) }
    catch (e: any) { error.value = e?.message || 'Failed to fetch economy data' }
    finally { loading.value = false }
  }

  async function fetchExpeditions() {
    const client = useApi()
    loading.value = true; error.value = null
    try { expeditionsData.value = await client<any>('/admin-dashboard/expeditions', { method: 'GET' }) }
    catch (e: any) { error.value = e?.message || 'Failed to fetch expeditions data' }
    finally { loading.value = false }
  }

  async function fetchQuiz() {
    const client = useApi()
    loading.value = true; error.value = null
    try { quizData.value = await client<any>('/admin-dashboard/quiz', { method: 'GET' }) }
    catch (e: any) { error.value = e?.message || 'Failed to fetch quiz data' }
    finally { loading.value = false }
  }

  async function fetchSocial() {
    const client = useApi()
    loading.value = true; error.value = null
    try { socialData.value = await client<any>('/admin-dashboard/social', { method: 'GET' }) }
    catch (e: any) { error.value = e?.message || 'Failed to fetch social data' }
    finally { loading.value = false }
  }

  async function fetchConnections() {
    const client = useApi()
    loading.value = true; error.value = null
    try { connectionData.value = await client<any>('/admin-dashboard/connections', { method: 'GET' }) }
    catch (e: any) { error.value = e?.message || 'Failed to fetch connection data' }
    finally { loading.value = false }
  }

  async function fetchGdprRequests(page = 1) {
    const client = useApi()
    try {
      const res = await client<{ requests: any[]; pendingCount: number; pagination: typeof gdprPagination.value }>(
        '/admin-dashboard/gdpr-requests',
        { method: 'GET', params: { page, pageSize: gdprPagination.value.pageSize } }
      )
      gdprRequests.value = res.requests
      gdprPendingCount.value = res.pendingCount
      gdprPagination.value = res.pagination
    } catch (e: any) { error.value = e?.message || 'Failed to fetch GDPR requests' }
  }

  async function markGdprProcessed(id: number) {
    const client = useApi()
    // try/catch + error.value comme les autres actions du store : sur échec API, l'erreur est
    // exposée et la mutation locale (statut + compteur) n'est PAS appliquée (l'await précède). #81
    try {
      await client(`/admin-dashboard/gdpr-requests/${id}/process`, { method: 'PUT' })
      const req = gdprRequests.value.find(r => r.id === id)
      if (req && req.status === 'pending') {
        req.status = 'processed'
        // Le compteur global vient du serveur : on le décrémente localement pour rester réactif.
        gdprPendingCount.value = Math.max(0, gdprPendingCount.value - 1)
      }
    } catch (e: any) {
      error.value = e?.message || 'Failed to mark GDPR request as processed'
      throw e
    }
  }

  function clearAdmin() {
    overview.value = null; players.value = []; playerDetail.value = null
    pagination.value = { page: 1, pageSize: 25, pageCount: 0, total: 0 }
    mapData.value = null; economyData.value = null; expeditionsData.value = null
    quizData.value = null; socialData.value = null; connectionData.value = null
    gdprRequests.value = []; gdprPendingCount.value = 0
    gdprPagination.value = { page: 1, pageSize: 10, pageCount: 0, total: 0 }; error.value = null
  }

  return {
    overview, players, playerDetail, pagination, mapData, economyData, expeditionsData, quizData, socialData, connectionData, loading, error,
    fetchOverview, fetchPlayers, fetchPlayerDetail, toggleBlockPlayer, changePlayerRole,
    fetchMapData, fetchEconomy, fetchExpeditions, fetchQuiz, fetchSocial, fetchConnections,
    gdprRequests, gdprPagination, gdprPendingCount, fetchGdprRequests, markGdprProcessed, clearAdmin,
  }
})
