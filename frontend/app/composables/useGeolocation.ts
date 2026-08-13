import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { calculateDistance, calculateDistanceMeters } from '~/utils/geolocation'
import { DEFAULT_POSITION } from '~/utils/last-position'

/**
 * Options de configuration pour le tracking de géolocalisation
 */
interface GeolocationOptions {
  /** Latitude initiale avant le premier fix (default: 49.1167 - Saint-Lô) */
  defaultLat?: number
  /** Longitude initiale avant le premier fix (default: -1.0833 - Saint-Lô) */
  defaultLng?: number
  /** Seuil de distance en km pour déclencher un reload des données (default: 5) */
  reloadThresholdKm?: number
}

/**
 * Callbacks optionnels pour les événements de géolocalisation
 */
interface GeolocationCallbacks {
  /** Appelé quand la première position est obtenue */
  onFirstPosition?: (lat: number, lng: number) => void
  /** Appelé à chaque mise à jour de position */
  onPositionUpdate?: (lat: number, lng: number) => void
  /** Appelé quand le seuil de distance est dépassé */
  onDistanceThresholdReached?: (distance: number) => void
}

/**
 * Précision (en mètres) au-delà de laquelle un fix est jugé trop grossier.
 * Ordre de grandeur : GPS ≈ 5-20 m, WiFi ≈ 20-80 m, triangulation cellulaire ≈ 500-3000 m.
 * Le seuil est placé au-dessus du WiFi pour ne rejeter que les fixes réseau grossiers, qui sont
 * la cause des « téléportations » ressenties par le joueur.
 */
const ACCEPTABLE_ACCURACY_M = 100

/**
 * Vitesse (m/s) au-delà de laquelle un déplacement entre deux fixes est jugé impossible.
 * 30 m/s ≈ 108 km/h : laisse passer la marche, le vélo et la voiture ; rejette le saut instantané
 * de plusieurs centaines de mètres provoqué par une bascule GPS → réseau.
 */
const MAX_PLAUSIBLE_SPEED_MPS = 30

/**
 * Durée (ms) au bout de laquelle un fix est accepté même s'il échoue aux filtres.
 * Soupape indispensable : sans elle, un joueur durablement privé de GPS (intérieur, tunnel urbain)
 * verrait sa position figée pour toujours. Mieux vaut une position grossière qu'une position morte.
 */
const STALE_ACCEPT_MS = 30_000

// ---------------------------------------------------------------------------
// État PARTAGÉ (scope module) — cf. JSDoc de `useGeolocation` ci-dessous.
// ---------------------------------------------------------------------------

const userLat = ref<number>(DEFAULT_POSITION.lat)
const userLng = ref<number>(DEFAULT_POSITION.lng)
/** Précision du dernier fix accepté, en mètres (null tant qu'aucun fix n'est arrivé). */
const accuracy = ref<number | null>(null)
const geolocLoading = ref<boolean>(false)
const geolocError = ref<string | null>(null)
const watchId = ref<number | null>(null)
const isFirstPosition = ref<boolean>(true)
/** Vrai dès qu'au moins une position réelle a été reçue (≠ position par défaut). */
const hasFix = ref<boolean>(false)
const isTracking = ref<boolean>(false)

const lastFetchLat = ref<number | null>(null)
const lastFetchLng = ref<number | null>(null)
/** Horodatage du dernier fix ACCEPTÉ, pour la vitesse implicite et la soupape de staleness. */
let lastAcceptedAt = 0

// Options figées au premier appel de `useGeolocation` (l'état est un singleton : des options
// divergentes entre appelants créeraient un comportement dépendant de l'ordre de montage).
let reloadThresholdKm = 5

// Abonnés multiples : un Set (et non une ref écrasée) car plusieurs pages peuvent écouter en même
// temps. Avant la mise en commun de l'état, `registerCallbacks` écrasait silencieusement les
// callbacks du précédent appelant — invisible tant qu'une seule page (la carte) s'abonnait.
const positionSubscribers = new Set<GeolocationCallbacks>()

let appStateListener: PluginListenerHandle | null = null
// Promesse d'inscription en vol : conservée pour que teardown puisse l'attendre. Sans ça,
// un stop rapide pendant qu'App.addListener est en vol verrait appStateListener encore null
// (no-op), puis l'inscription se résoudrait → listener natif orphelin jusqu'au reload.
let appStateSetupPromise: Promise<void> | null = null

/**
 * Composable de géolocalisation temps réel, à **état partagé au niveau application**.
 *
 * Tous les appelants observent la MÊME position : l'état vit au scope module, pas dans la fonction.
 * Le cycle de vie (start/stop) est piloté par `plugins/geolocation.client.ts` en fonction de la
 * route, et non par le montage d'un composant — c'est ce qui permet au joueur de continuer à être
 * suivi pendant qu'il répond au quiz ou consulte ses quêtes. Un composant qui ne fait que LIRE la
 * position appelle simplement `useGeolocation()` sans jamais toucher à `startTracking`.
 *
 * Choix non-évidents :
 * - **Haute précision en continu** (`enableHighAccuracy: true` sur `watchPosition`, pas seulement
 *   sur le fix initial). En basse précision, Android sert des fixes WiFi/cellulaire à ±500 m et ne
 *   pousse que de rares mises à jour : le geofence de 50 m des coffres devient injouable. Le coût
 *   batterie est assumé et borné par la suspension en arrière-plan.
 * - **Filtrage des fixes aberrants** (`shouldAcceptFix`) : le navigateur livre indifféremment un
 *   point GPS à ±5 m et un point réseau à ±800 m. Les appliquer à égalité produisait les
 *   « téléportations » — position qui saute d'un bloc puis revient. On rejette donc les fixes trop
 *   imprécis et les déplacements physiquement impossibles, avec une soupape anti-blocage.
 * - **Pas de tracking en arrière-plan** : API web premier-plan uniquement, aucun foreground
 *   service. Le bandeau « Géolocalisation active » est masqué quand l'app passe en arrière-plan
 *   (où l'OS suspend de toute façon `watchPosition`) et réaffiché au retour.
 *
 * Invariants à préserver :
 * - **Aucun `onUnmounted → stopTracking` ici.** Le tracking est global : le couper au démontage
 *   d'un composant l'arrêterait pour toute l'application dès la première navigation.
 * - `startTracking` reste idempotent : le flux d'autorisation l'appelle deux fois (bouton
 *   « Autoriser » + listener `permissions.change`).
 * - Le premier fix n'est jamais filtré, sinon la position resterait bloquée sur le repli Saint-Lô.
 *
 * @param options - Options de configuration (prises en compte au PREMIER appel uniquement)
 * @returns État partagé et actions pour la géolocalisation
 *
 * @example
 * // Lecture seule, depuis n'importe quelle page :
 * const { userLat, userLng, accuracy } = useGeolocation()
 *
 * @example
 * // Réaction aux mises à jour (désabonnement automatique au démontage du composant) :
 * useGeolocation().registerCallbacks({
 *   onPositionUpdate: (lat, lng) => fogStore.addPosition(lat, lng)
 * })
 */
export function useGeolocation(options: GeolocationOptions = {}) {
  // Position initiale : ne s'applique que tant qu'aucun fix réel n'est arrivé. Après le premier
  // fix, un nouvel appelant (autre page) hérite de la position réelle du joueur — écraser avec un
  // défaut le ferait « revenir » à Saint-Lô à chaque navigation.
  if (!hasFix.value) {
    if (options.defaultLat !== undefined) userLat.value = options.defaultLat
    if (options.defaultLng !== undefined) userLng.value = options.defaultLng
  }
  if (options.reloadThresholdKm !== undefined) reloadThresholdKm = options.reloadThresholdKm

  // useNotifications() n'a aucune dépendance au contexte de composant (Capacitor uniquement) :
  // sûr à résoudre ici, y compris quand l'appelant est un plugin et non un setup.
  const { showGeoNotification, hideGeoNotification } = useNotifications()

  async function setupAppStateListener(): Promise<void> {
    if (!Capacitor.isNativePlatform() || appStateListener) return
    // L'assignation de appStateSetupPromise est synchrone (avant le premier await) → un teardown
    // appelé au même tick la voit et l'attend.
    appStateSetupPromise = (async () => {
      appStateListener = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isTracking.value) return
        if (isActive) {
          showGeoNotification()
        } else {
          hideGeoNotification()
        }
      })
    })()
    await appStateSetupPromise
  }

  async function teardownAppStateListener(): Promise<void> {
    if (appStateSetupPromise) {
      await appStateSetupPromise.catch(() => {})
    }
    if (appStateListener) {
      await appStateListener.remove()
      appStateListener = null
    }
    appStateSetupPromise = null
  }

  /**
   * Décide si un fix entrant est exploitable.
   *
   * Trois portes, dans cet ordre : premier fix (toujours accepté), soupape de staleness
   * (évite le gel de la position), puis les filtres de qualité (précision, vitesse implicite).
   */
  function shouldAcceptFix(lat: number, lng: number, acc: number, timestamp: number): boolean {
    // Premier fix : rien à comparer, et le refuser laisserait le joueur sur la position par défaut.
    if (!hasFix.value) return true

    // Soupape : après STALE_ACCEPT_MS sans aucun fix accepté, on prend ce qu'on a. Un joueur en
    // intérieur ne reçoit que des fixes réseau grossiers ; les rejeter indéfiniment figerait sa
    // position à l'endroit où il a perdu le GPS.
    if (timestamp - lastAcceptedAt > STALE_ACCEPT_MS) return true

    // Filtre 1 — précision. Un fix grossier n'est retenu que s'il améliore la précision courante
    // (cas d'une dégradation progressive : 20 m → 150 m → 120 m reste informatif).
    if (acc > ACCEPTABLE_ACCURACY_M && acc > (accuracy.value ?? Number.POSITIVE_INFINITY)) {
      return false
    }

    // Filtre 2 — vitesse implicite. Un déplacement plus rapide que MAX_PLAUSIBLE_SPEED_MPS entre
    // deux fixes n'est pas un déplacement : c'est un changement de source de localisation.
    const elapsedSec = Math.max((timestamp - lastAcceptedAt) / 1000, 1)
    const meters = calculateDistanceMeters(userLat.value, userLng.value, lat, lng)
    if (meters / elapsedSec > MAX_PLAUSIBLE_SPEED_MPS) return false

    return true
  }

  /**
   * Démarre le tracking de position en temps réel.
   * Idempotent. Piloté par `plugins/geolocation.client.ts`, pas par les composants.
   */
  function startTracking() {
    // Guard SSR : navigator n'existe pas côté serveur (accès non gardé → crash au rendu). #81
    if (!import.meta.client || !navigator.geolocation) {
      console.warn('Geolocation not supported, using default position')
      return
    }

    // Idempotence : le flux d'autorisation déclenche startTracking() deux fois (bouton
    // « Autoriser » + listener permissions.change) ; sans cette garde, le premier watchPosition
    // est orphelin (jamais clearWatch) → double fetch réseau + drain batterie jusqu'au reload.
    if (isTracking.value || watchId.value !== null) return

    geolocLoading.value = true
    geolocError.value = null

    // Traite une position reçue, quelle que soit sa source (fix initial getCurrentPosition OU tick
    // watchPosition). Le 1er appel (isFirstPosition) déclenche onFirstPosition ; les suivants
    // mettent à jour la position et déclenchent le reload au-delà du seuil de distance.
    // JS étant mono-thread, le 1er appel bascule isFirstPosition à false de façon synchrone : aucun
    // risque de double-déclenchement même si les deux sources résolvent quasi simultanément.
    const applyPosition = (position: GeolocationPosition) => {
      const newLat = position.coords.latitude
      const newLng = position.coords.longitude
      const acc = position.coords.accuracy
      const timestamp = position.timestamp || Date.now()

      if (!shouldAcceptFix(newLat, newLng, acc, timestamp)) return

      lastAcceptedAt = timestamp
      accuracy.value = acc

      if (isFirstPosition.value) {
        userLat.value = newLat
        userLng.value = newLng
        geolocLoading.value = false
        isFirstPosition.value = false
        hasFix.value = true
        lastFetchLat.value = newLat
        lastFetchLng.value = newLng
        for (const sub of positionSubscribers) sub.onFirstPosition?.(newLat, newLng)
      } else {
        userLat.value = newLat
        userLng.value = newLng
        for (const sub of positionSubscribers) sub.onPositionUpdate?.(newLat, newLng)

        // Vérifier si besoin de reload (threshold dépassé)
        if (lastFetchLat.value !== null && lastFetchLng.value !== null) {
          const distance = calculateDistance(lastFetchLat.value, lastFetchLng.value, newLat, newLng)
          if (distance > reloadThresholdKm) {
            lastFetchLat.value = newLat
            lastFetchLng.value = newLng
            for (const sub of positionSubscribers) sub.onDistanceThresholdReached?.(distance)
          }
        }
      }
    }

    // Fix initial RAPIDE et fiable : sans lui, le recentrage dépend uniquement du 1er tick de
    // watchPosition, qui peut expirer (signal faible, desktop, timeout court) → la carte reste
    // bloquée sur la position par défaut (Saint-Lô) sans jamais recentrer. getCurrentPosition en
    // haute précision avec un timeout large fournit ce premier fix ; watchPosition prend le suivi.
    navigator.geolocation.getCurrentPosition(
      applyPosition,
      (error: GeolocationPositionError) => {
        // Échec du fix initial : on log seulement — watchPosition reste en lice pour recentrer.
        console.warn('Initial geolocation fix failed:', error.message)
      },
      {
        enableHighAccuracy: true,   // GPS : premier point précis dès que possible
        timeout: 15000,             // laisse le temps au GPS de fixer (vs 5 s trop court)
        maximumAge: 60000           // accepte un point récent en cache pour un recentrage immédiat
      }
    )

    watchId.value = navigator.geolocation.watchPosition(
      applyPosition,
      (error: GeolocationPositionError) => {
        console.warn('Geolocation tracking failed:', error.message)
        geolocError.value = error.message
        geolocLoading.value = false
      },
      {
        // Haute précision AUSSI pour le suivi : en basse précision l'OS sert des fixes réseau
        // (±500 m) et espace fortement les mises à jour — incompatible avec un geofence de 50 m.
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0               // pas de resservage de cache : on veut la position courante
      }
    )

    isTracking.value = true
    showGeoNotification()
    setupAppStateListener()
  }

  /**
   * Arrête le tracking de position.
   * Conserve la dernière position connue (les lecteurs continuent d'afficher un point cohérent).
   */
  function stopTracking() {
    if (import.meta.client && watchId.value !== null) {
      navigator.geolocation.clearWatch(watchId.value)
      watchId.value = null
      isTracking.value = false
      geolocLoading.value = false
      hideGeoNotification()
      teardownAppStateListener()
    }
  }

  /**
   * Abonne des callbacks aux événements de position.
   *
   * Appelé depuis un composant, le désabonnement est automatique au démontage. Appelé hors
   * composant (plugin), utiliser la fonction retournée.
   *
   * @param callbacks - Callbacks à enregistrer
   * @returns Fonction de désabonnement
   */
  function registerCallbacks(callbacks: GeolocationCallbacks): () => void {
    positionSubscribers.add(callbacks)
    const unsubscribe = () => { positionSubscribers.delete(callbacks) }

    // getCurrentInstance() : hors setup (plugin), onScopeDispose/onUnmounted n'a pas de scope
    // auquel s'accrocher et émettrait un warning Vue.
    if (getCurrentInstance()) onUnmounted(unsubscribe)

    return unsubscribe
  }

  return {
    // State (readonly pour external usage)
    userLat: readonly(userLat),
    userLng: readonly(userLng),
    accuracy: readonly(accuracy),
    geolocLoading: readonly(geolocLoading),
    geolocError: readonly(geolocError),
    isFirstPosition: readonly(isFirstPosition),
    hasFix: readonly(hasFix),
    isTracking: readonly(isTracking),

    // Actions
    startTracking,
    stopTracking,
    registerCallbacks
  }
}
