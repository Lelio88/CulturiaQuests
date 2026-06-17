/**
 * Admin route middleware
 * Protège les routes /dashboard — redirige les non-admins vers l'accueil.
 *
 * S'exécute aussi en SSR (l'enforcement serveur a été activé avec la migration BFF #17) :
 * `user` est hydraté par plugins/auth.ts via /users/me-with-role (role peuplé), et
 * `verifyAdmin()` passe par le proxy (cookie forwardé en SSR par useRequestFetch).
 * `verifyAdmin` reste un filet de défense en profondeur (le backend filtre de toute façon
 * par ctx.state.user).
 */
export default defineNuxtRouteMiddleware(async () => {
  const { user } = useAuth()

  if (!user.value) {
    return navigateTo('/account/login')
  }

  const { checkAdminRole, verifyAdmin } = useAdmin()
  if (!checkAdminRole()) {
    await verifyAdmin()
    if (!checkAdminRole()) {
      return navigateTo('/')
    }
  }
})
