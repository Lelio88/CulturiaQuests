/**
 * Plugin auth — hydrate l'utilisateur courant (`cq_user`) au démarrage à partir du cookie
 * HTTP-ONLY `cq_session`, via GET /api/auth/me.
 *
 * - S'exécute avant les middlewares de route → l'user est disponible dès le 1er rendu
 *   (pas de flash de déconnexion).
 * - Gate SSR : on ne tente l'appel serveur que si le cookie `cq_session` est présent
 *   → zéro round-trip Strapi pour un visiteur anonyme (`useCookie` lit l'en-tête entrant
 *   côté serveur, y compris un cookie httpOnly).
 * - `useState('cq_user')` est sérialisé dans le payload → pas de re-fetch à l'hydratation.
 *
 * NB (phase de migration) : tant que le login passe encore par @nuxtjs/strapi (culturia_jwt),
 * `cq_session` n'est pas posé → ce plugin laisse simplement `cq_user` à null (inerte, additif).
 */
export default defineNuxtPlugin(async () => {
  const { user, fetchMe } = useAuth()

  // Déjà hydraté (payload SSR) → rien à faire.
  if (user.value) return

  // Gate SSR : pas de session ⇒ pas d'appel /api/auth/me côté serveur.
  if (import.meta.server) {
    const session = useCookie('cq_session')
    if (!session.value) return
  }

  await fetchMe()
})
