/**
 * Plugin auth — hydrate l'utilisateur courant (`cq_user`) au démarrage à partir des cookies
 * HTTP-ONLY de session (`cq_session`, `cq_refresh`), via GET /api/auth/me.
 *
 * - S'exécute avant les middlewares de route → l'user est disponible dès le 1er rendu
 *   (pas de flash de déconnexion ; l'enforcement d'auth s'applique aussi en SSR).
 * - Gate SSR : on ne tente l'appel serveur que si un cookie de session est présent
 *   → zéro round-trip Strapi pour un visiteur anonyme (`useCookie` lit l'en-tête entrant
 *   côté serveur, y compris un cookie httpOnly). `cq_refresh` compte aussi : le jeton d'accès
 *   se renouvelle côté serveur (server/middleware/10-session.ts).
 * - `useState('cq_user')` est sérialisé dans le payload → pas de re-fetch à l'hydratation.
 * - Côté client, on réconcilie les stores Pinia persistés avec l'utilisateur courant
 *   (anti-fuite cross-user sur appareil partagé).
 */
export default defineNuxtPlugin(async () => {
  const { user, fetchMe, reconcileUser } = useAuth()

  // Hydrate si pas déjà fait (payload SSR absent).
  if (!user.value) {
    // Gate SSR : pas de session ⇒ pas d'appel /api/auth/me côté serveur.
    if (import.meta.server) {
      const session = useCookie('cq_session')
      const refresh = useCookie('cq_refresh')
      if (!session.value && !refresh.value) return
    }
    await fetchMe()
  }

  // Anti-fuite cross-user (client uniquement) : purge les stores persistés d'un autre user.
  if (import.meta.client) {
    reconcileUser(user.value?.id)
  }
})
