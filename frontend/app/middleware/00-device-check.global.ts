export default defineNuxtRouteMiddleware((to) => {
  // user est hydraté en SSR par plugins/auth.ts (cookie cq_session) → l'auth est
  // désormais appliquée aussi côté serveur (redirection 302 serveur sur route protégée).
  const { user } = useAuth()
  const config = useRuntimeConfig()
  
  // Device detection (might be undefined if module not loaded or SSR issue)
  let isDesktop = false
  try {
    const device = useDevice()
    if (device) {
      isDesktop = device.isDesktop
    }
  } catch (e) {
    // Fallback or ignore if useDevice is not available
  }

  // Allow desktop access if ALLOW_DESKTOP is set to true in .env
  // Handle both string 'true' and boolean true
  const allowDesktop = String(config.public.allowDesktop) === 'true'

  // Dashboard routes are always allowed on desktop (admin panel)
  const isDashboardRoute = to.path.startsWith('/dashboard')

  // Define public routes accessible without authentication
  const publicRoutes = [
    '/',
    '/error',
    '/account/login',
    '/account/register',
    '/CGU',
    '/mentions-legales',
    '/politique-confidentialite'
  ]

  // Check authentication FIRST so that the desktop early-return below cannot
  // bypass the auth guard (previously a bare `return` short-circuited this).
  if (!user.value) {
    // If user is not authenticated and trying to access a protected route
    if (!publicRoutes.includes(to.path)) {
      return navigateTo('/account/login')
    }
  }

  // Desktop access is not allowed (mobile-first) : l'UI de blocage est gérée par le composant
  // global `DesktopGate.vue` (overlay plein écran monté dans app.vue). On laisse donc rendre la
  // route ici — l'overlay recouvre le jeu, tout en gardant dashboard/login/légal accessibles.
  if (!allowDesktop && isDesktop && !isDashboardRoute) {
    return
  }
})
