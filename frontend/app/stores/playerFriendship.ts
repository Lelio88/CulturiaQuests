import { defineStore } from 'pinia'
import type {
  PlayerFriendship,
  PlayerFriendshipsResponse,
  PlayerSearchResult,
  PlayerSearchResponse,
  PlayerFriendshipGuild,
} from '~/types/playerFriendship'

/**
 * Store Pinia des amitiés entre joueurs : recherche d'un joueur par pseudo,
 * envoi/acceptation/refus de demandes et suppression d'amis. Les relations
 * lient des guildes (`requester` / `receiver`), pas directement des comptes.
 *
 * Choix non-évidents :
 * - L'orientation d'une amitié (reçue vs envoyée) est calculée en comparant le
 *   `documentId` de la guilde courante (`myGuildDocumentId`, renvoyé par l'API)
 *   aux `requester`/`receiver` ; `getOtherGuild` retourne « l'autre » guilde.
 * - Chaque action mute `actionLoading[documentId]` (map par cible) pour piloter
 *   un état de chargement granulaire par bouton plutôt qu'un loading global.
 * - `calculateLevel` reprend la formule de niveau (sqrt(exp/75)+1) pour afficher
 *   le niveau d'un ami sans dépendre d'un autre store.
 *
 * Invariants :
 * - Après toute mutation (send/accept/reject/remove), on relance
 *   `fetchFriendships()` : le serveur reste la source de vérité sur le statut.
 * - L'isolation utilisateur et l'autorisation sont assurées côté backend
 *   (relation `guild.user`).
 *
 * @example
 * const store = usePlayerFriendshipStore()
 * await store.searchUser('Marin')
 * await store.sendRequest(store.searchResult.guildDocumentId)
 */
export const usePlayerFriendshipStore = defineStore('playerFriendship', () => {
  // State
  const friendships = ref<PlayerFriendship[]>([])
  const myGuildDocumentId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const searchResult = ref<PlayerSearchResult | null>(null)
  const searchMessage = ref<string | null>(null)
  const searchLoading = ref(false)

  const actionLoading = ref<Record<string, boolean>>({})

  // Computed
  const pendingReceived = computed(() =>
    friendships.value.filter(
      f => f.status === 'pending' && f.receiver.documentId === myGuildDocumentId.value
    )
  )

  const pendingSent = computed(() =>
    friendships.value.filter(
      f => f.status === 'pending' && f.requester.documentId === myGuildDocumentId.value
    )
  )

  const friends = computed(() =>
    friendships.value.filter(f => f.status === 'accepted')
  )

  const pendingReceivedCount = computed(() => pendingReceived.value.length)
  const hasPendingRequests = computed(() => pendingReceivedCount.value > 0)

  // Helpers
  function getOtherGuild(friendship: PlayerFriendship): PlayerFriendshipGuild {
    if (friendship.requester.documentId === myGuildDocumentId.value) {
      return friendship.receiver
    }
    return friendship.requester
  }

  function calculateLevel(exp: number): number {
    return Math.floor(Math.sqrt(Number(exp) / 75)) + 1
  }

  // Actions
  async function fetchFriendships() {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<PlayerFriendshipsResponse>('/player-friendships', {
        method: 'GET',
      })

      friendships.value = response.data || []
      if (response.myGuildDocumentId) {
        myGuildDocumentId.value = response.myGuildDocumentId
      }
    } catch (e: any) {
      console.error('Failed to fetch player friendships:', e)
      error.value = e?.message || 'Erreur lors du chargement des amitiés'
    } finally {
      loading.value = false
    }
  }

  async function searchUser(username: string) {
    const client = useApi()
    searchLoading.value = true
    searchResult.value = null
    searchMessage.value = null

    try {
      const response = await client<PlayerSearchResponse>('/player-friendships/search', {
        method: 'GET',
        params: { username },
      })

      searchResult.value = response.data || null
      searchMessage.value = response.message || null
    } catch (e: any) {
      console.error('Failed to search user:', e)
      searchMessage.value = extractApiError(e, 'Erreur lors de la recherche')
    } finally {
      searchLoading.value = false
    }
  }

  async function sendRequest(receiverGuildDocumentId: string) {
    const client = useApi()
    actionLoading.value[receiverGuildDocumentId] = true

    try {
      await client('/player-friendships/send', {
        method: 'POST',
        body: { receiverGuildDocumentId },
      })

      // Refresh list to get updated state
      await fetchFriendships()
      // Clear search after successful send
      searchResult.value = null
      searchMessage.value = null
    } catch (e: any) {
      console.error('Failed to send friend request:', e)
      searchMessage.value = extractApiError(e, 'Erreur lors de l\'envoi')
    } finally {
      actionLoading.value[receiverGuildDocumentId] = false
    }
  }

  async function acceptRequest(documentId: string) {
    const client = useApi()
    actionLoading.value[documentId] = true

    try {
      await client(`/player-friendships/${documentId}/accept`, {
        method: 'PUT',
      })

      await fetchFriendships()
    } catch (e: any) {
      console.error('Failed to accept friend request:', e)
      error.value = e?.message || 'Erreur lors de l\'acceptation'
    } finally {
      actionLoading.value[documentId] = false
    }
  }

  async function rejectRequest(documentId: string) {
    const client = useApi()
    actionLoading.value[documentId] = true

    try {
      await client(`/player-friendships/${documentId}/reject`, {
        method: 'PUT',
      })

      await fetchFriendships()
    } catch (e: any) {
      console.error('Failed to reject friend request:', e)
      error.value = e?.message || 'Erreur lors du refus'
    } finally {
      actionLoading.value[documentId] = false
    }
  }

  async function removeFriend(documentId: string) {
    const client = useApi()
    actionLoading.value[documentId] = true

    try {
      await client(`/player-friendships/${documentId}`, {
        method: 'DELETE',
      })

      await fetchFriendships()
    } catch (e: any) {
      console.error('Failed to remove friend:', e)
      error.value = e?.message || 'Erreur lors de la suppression'
    } finally {
      actionLoading.value[documentId] = false
    }
  }

  function clearPlayerFriendships() {
    friendships.value = []
    myGuildDocumentId.value = null
    loading.value = false
    error.value = null
    searchResult.value = null
    searchMessage.value = null
    searchLoading.value = false
    actionLoading.value = {}
  }

  return {
    // State
    friendships,
    myGuildDocumentId,
    loading,
    error,
    searchResult,
    searchMessage,
    searchLoading,
    actionLoading,
    // Computed
    pendingReceived,
    pendingSent,
    friends,
    pendingReceivedCount,
    hasPendingRequests,
    // Helpers
    getOtherGuild,
    calculateLevel,
    // Actions
    fetchFriendships,
    searchUser,
    sendRequest,
    acceptRequest,
    rejectRequest,
    removeFriend,
    clearPlayerFriendships,
  }
})
