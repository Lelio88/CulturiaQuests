/**
 * Réacceptation des CGU : un joueur connecté dont la version acceptée n'est plus la courante
 * (`terms_outdated`, calculé par le serveur) est conduit à `/account/conditions`.
 *
 * Restent ouvertes : les textes à lire, la page de suppression de compte (on doit pouvoir partir
 * sans accepter) et l'écran lui-même. S'exécute après `00-device-check` (ordre alphabétique).
 */
const ALWAYS_OPEN = new Set([
  '/account/conditions',
  '/CGU',
  '/politique-confidentialite',
  '/mentions-legales',
  '/suppression-compte',
])

export default defineNuxtRouteMiddleware((to) => {
  const { user } = useAuth()
  if (!user.value?.terms_outdated || ALWAYS_OPEN.has(to.path)) return
  return navigateTo('/account/conditions')
})
