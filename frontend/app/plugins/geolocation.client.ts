import { saveLastPosition } from '~/utils/last-position'
import { useFogStore } from '~/stores/fog'
import { useZoneCompletion } from '~/composables/useZoneCompletion'
import { useGeolocation } from '~/composables/useGeolocation'

/**
 * Pilote le cycle de vie du tracking GPS **au niveau application**.
 *
 * Avant ce plugin, `useGeolocation()` n'était instancié que par `pages/map.vue` et coupé à son
 * démontage : quitter la carte arrêtait le GPS. Un joueur qui marchait en répondant au quiz ne
 * voyait ni sa position, ni son brouillard, mis à jour — et retrouvait au retour une position
 * périmée qu'il fallait re-fixer.
 *
 * Choix non-évidents :
 * - **Piloté par la route, pas par le layout.** Les pages de jeu sont réparties sur trois layouts
 *   (`default`, `footerless` pour le quiz, `blank` pour le coffre et l'expédition) et `blank` sert
 *   aussi au login et aux pages légales. Aucun layout ne décrit donc « page de jeu » ; une liste
 *   d'exclusion par préfixe de route le fait, en un seul endroit.
 * - **Ne demande jamais la permission.** Le tracking ne démarre que si l'autorisation est DÉJÀ
 *   acquise. Faire autrement ferait surgir la popup système sur une page arbitraire (un quiz, une
 *   story) hors de tout contexte : la demande reste la responsabilité de `GeolocationRequest.vue`,
 *   affiché sur la carte avec son explication.
 * - **Stores résolus paresseusement**, à l'intérieur des callbacks : le plugin peut s'initialiser
 *   avant que Pinia n'ait fini d'être installé.
 *
 * Invariant : les effets de jeu liés à la position (mémorisation, brouillard, couverture de zone)
 * sont abonnés ICI et non dans `map.vue` — c'est ce qui les rend actifs sur toutes les pages.
 * `map.vue` ne conserve que ce qui est propre à la carte (le recentrage initial).
 */

/**
 * Préfixes de routes SANS tracking : administration et pages hors-jeu (aucune mécanique
 * géolocalisée, et allumer le GPS y serait une dépense de batterie pure).
 */
const UNTRACKED_ROUTE_PREFIXES = [
  '/dashboard',
  '/account/login',
  '/account/register',
  '/account/forgot-password',
  '/account/reset-password',
  '/CGU',
  '/mentions-legales',
  '/politique-confidentialite',
]

/** Clé du choix utilisateur mémorisé par `GeolocationRequest.vue`. */
const GEOLOC_CHOICE_KEY = 'culturia_geoloc_choice'

function isTrackedRoute(path: string): boolean {
  // La racine est l'écran d'accueil (hors jeu) : comparaison exacte, sinon le préfixe '/'
  // exclurait toute l'application.
  if (path === '/') return false
  return !UNTRACKED_ROUTE_PREFIXES.some(prefix => path.startsWith(prefix))
}

/**
 * L'autorisation de géolocalisation est-elle déjà acquise ?
 *
 * Deux sources, car l'API Permissions est absente de plusieurs WebViews mobiles : l'état système
 * quand il est lisible, sinon le choix explicite mémorisé par `GeolocationRequest.vue`.
 */
async function hasGeolocationConsent(): Promise<boolean> {
  if (!navigator.geolocation) return false

  try {
    if (navigator.permissions?.query) {
      const permission = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
      if (permission.state === 'granted') return true
      if (permission.state === 'denied') return false
    }
  } catch {
    // API Permissions indisponible ou refusant la requête → repli sur le choix mémorisé.
  }

  try {
    return localStorage.getItem(GEOLOC_CHOICE_KEY) === 'allow'
  } catch {
    return false
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const geolocation = useGeolocation()

  // Effets de jeu liés à la position, actifs sur TOUTE page trackée.
  const applyGameEffects = (lat: number, lng: number) => {
    saveLastPosition(lat, lng)
    useFogStore().addPosition(lat, lng)
    useZoneCompletion().checkFogCoverage(lat, lng)
  }

  geolocation.registerCallbacks({
    onFirstPosition: applyGameEffects,
    onPositionUpdate: applyGameEffects,
  })

  // Synchronise le tracking avec la route courante. Async : la vérification de consentement l'est.
  // Une navigation survenue pendant l'await est absorbée par l'idempotence de start/stopTracking.
  const syncTracking = async (path: string) => {
    if (!isTrackedRoute(path)) {
      geolocation.stopTracking()
      return
    }
    if (geolocation.isTracking.value) return
    if (await hasGeolocationConsent()) {
      geolocation.startTracking()
    }
  }

  const router = useRouter()
  router.afterEach((to) => { syncTracking(to.path) })

  // Route d'entrée : `afterEach` ne se déclenche pas pour la navigation initiale.
  nuxtApp.hook('app:mounted', () => { syncTracking(router.currentRoute.value.path) })
})
