import { defineStore } from 'pinia'
import type { PostCardData, ToggleLikeResult } from '~/types/post'
import { formatCompactNumber, formatTimeAgo, formatDurationHMS } from '~/utils/format'
import { getImageUrl, getMuseumImageByTag } from '~/utils/strapiHelpers'

/**
 * Store du fil social : centralise TOUS les appels API liés aux posts (liste, création,
 * like, modification, suppression) et expose la liste normalisée prête pour l'affichage.
 *
 * Auparavant ces appels (et leur normalisation) vivaient en dur dans les pages/composants
 * (social/index.vue, createpost.vue, PostCard.vue) avec une logique dupliquée et un état non
 * partagé. Cette centralisation est l'objet de la story #36 (EPIC-ARCHI).
 *
 * Choix non-évidents :
 * - `fetchPosts` produit un view-model plat (`PostCardData`) : la vue n'accède jamais à la
 *   forme brute Strapi (relations author/run_history/best_loot), seulement à ce contrat stable.
 * - `totalDamage` est dérivé de `dps × durée(s)` (le back ne stocke pas le dégât total), via le
 *   helper local `getDurationSeconds` (tolère start/end absents → 0, jamais de NaN).
 * - `toggleLike`/`deletePost`/`updatePost`/`createPost` sont des actions FINES (un appel API)
 *   qui RETOURNENT la réponse et LAISSENT l'orchestration UI (optimistic-update, refresh, message
 *   d'erreur) à l'appelant — pour préserver le comportement existant à l'identique. La réponse de
 *   `toggle-like` expose `likes`/`liked` au niveau racine (hors enveloppe `data`).
 * - `useApi()` est appelé en tête de chaque action (contexte Nuxt présent) puis réutilisé.
 *
 * Invariants :
 * - Pas de persistance Pinia : le serveur est la source de vérité, `fetchPosts` recharge.
 * - L'isolation utilisateur (likes/auteur) est garantie côté backend.
 *
 * @example
 * const social = useSocialStore()
 * await social.fetchPosts()
 * const { likes, liked } = await social.toggleLike(postId)
 */

/** Durée d'un run en secondes (0 si bornes absentes/invalides — jamais de NaN). */
function getDurationSeconds(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000)
}

export const useSocialStore = defineStore('social', () => {
  // State
  const posts = ref<PostCardData[]>([])
  // Démarre à `true` : iso avec l'ancienne page (spinner peint dès le 1er rendu SSR avant fetchPosts).
  const loading = ref(true)
  const error = ref<string | null>(null)

  // Actions
  /**
   * Récupère le fil de posts et le normalise en `PostCardData[]` prêt pour l'affichage.
   */
  async function fetchPosts(): Promise<void> {
    const client = useApi()
    loading.value = true
    error.value = null

    try {
      const response = await client<{ data?: any[] }>('/posts', {
        params: {
          populate: {
            author: { populate: ['avatar'] },
            run_history: { populate: ['museum', 'museum.tags'] },
            best_loot: { populate: ['rarity', 'icon'] },
            likes: true,
          },
        },
      })

      posts.value = (response.data || []).map((post: any): PostCardData => {
        const author = post.author || {}
        const run = post.run_history || {}
        const museum = run.museum || {}
        const bestLoot = post.best_loot || {}

        const avatarUrl = author.avatar ? getImageUrl(author.avatar) : '/assets/user/placeholder_pdp.jpg'

        const durationSeconds = getDurationSeconds(run.date_start, run.date_end)
        const totalDamage = (run.dps || 0) * durationSeconds

        return {
          id: post.documentId || post.id,
          authorId: author.documentId || author.id,
          authorName: author.username || 'Explorateur',
          authorAvatar: avatarUrl as string,
          location: museum.name || 'Lieu inconnu',
          timeAgo: formatTimeAgo(post.createdAt),
          museumName: museum.name || 'Lieu inconnu',
          museumImage: getMuseumImageByTag(museum),

          bestLootName: bestLoot.name || 'Aucun loot',
          bestLootImage: getImageUrl(bestLoot.icon),
          bestLootRarity: bestLoot.rarity?.name || 'common',
          bestLootDamage: bestLoot.index_damage || 0,
          bestLootLevel: bestLoot.level || 1,
          bestLootId: bestLoot.documentId || bestLoot.id,
          showLoot: post.show_loot !== false,

          duration: formatDurationHMS(durationSeconds),
          rawDuration: durationSeconds,
          tier: run.threshold_reached || 0,

          totalDamage: formatCompactNumber(totalDamage),
          xp: formatCompactNumber(run.xp_earned),
          gold: formatCompactNumber(run.gold_earned),

          rawTotalDamage: totalDamage,
          rawXp: run.xp_earned || 0,
          rawGold: run.gold_earned || 0,

          tags: post.tags || [],
          likes: post.likes || 0,
          hasLiked: post.hasLiked || false,
        }
      })
    } catch (e: unknown) {
      console.error('Erreur lors de la récupération des posts :', e)
      error.value = extractApiError(e, 'Erreur lors de la récupération des posts')
    } finally {
      loading.value = false
    }
  }

  /**
   * Crée un post. `payload` doit déjà contenir l'enveloppe `{ data: {...} }` attendue par Strapi.
   * Propage l'erreur (l'appelant gère le message UI).
   */
  function createPost(payload: { data: Record<string, unknown> }): Promise<unknown> {
    const client = useApi()
    return client('/posts', { method: 'POST', body: payload })
  }

  /**
   * Bascule le like du post courant. Retourne `{ likes, liked }` (état serveur) ;
   * l'appelant applique l'optimistic-update et la réconciliation.
   */
  function toggleLike(postId: string | number): Promise<ToggleLikeResult> {
    const client = useApi()
    return client<ToggleLikeResult>(`/posts/${postId}/toggle-like`, { method: 'POST' })
  }

  /** Supprime un post. Propage l'erreur (l'appelant gère le message UI + le refresh). */
  function deletePost(postId: string | number): Promise<unknown> {
    const client = useApi()
    return client(`/posts/${postId}`, { method: 'DELETE' })
  }

  /**
   * Met à jour un post. `data` est le contenu métier (show_loot, tags, best_loot) ; le store
   * l'enveloppe dans `{ data }`. Propage l'erreur (l'appelant gère le message UI + le refresh).
   */
  function updatePost(postId: string | number, data: Record<string, unknown>): Promise<unknown> {
    const client = useApi()
    return client(`/posts/${postId}`, { method: 'PUT', body: { data } })
  }

  return {
    // State
    posts,
    loading,
    error,
    // Actions
    fetchPosts,
    createPost,
    toggleLike,
    deletePost,
    updatePost,
  }
})
