/**
 * Modèle de présentation d'un post social, tel que normalisé par `useSocialStore`
 * à partir de la réponse brute Strapi (`/posts` + relations author/run_history/best_loot).
 *
 * Ce type est le contrat consommé par `PostCard.vue` : la page n'accède jamais à la
 * forme brute de l'API, uniquement à ce view-model stable. #36
 */
export interface PostCardData {
  id: string | number
  authorId: string | number | undefined
  authorName: string
  authorAvatar: string
  location: string
  timeAgo: string
  museumName: string
  museumImage: string
  bestLootName: string
  bestLootImage: string | null
  bestLootRarity: string
  bestLootDamage: number
  bestLootLevel: number
  bestLootId: string | number | undefined
  showLoot: boolean
  duration: string
  rawDuration: number
  tier: number
  totalDamage: string
  xp: string
  gold: string
  rawTotalDamage: number
  rawXp: number
  rawGold: number
  tags: string[]
  likes: number
  hasLiked: boolean
}

/** Réponse de l'endpoint `POST /posts/:id/toggle-like` (champs au niveau racine, hors enveloppe `data`). */
export interface ToggleLikeResult {
  likes: number
  liked: boolean
}
