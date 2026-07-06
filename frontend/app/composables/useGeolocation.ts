import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { calculateDistance } from '~/utils/geolocation'

/**
 * Options de configuration pour le tracking de géolocalisation
 */
interface GeolocationOptions {
  /** Latitude par défaut si la géolocalisation est refusée (default: 49.1167 - Saint-Lô) */
  defaultLat?: number
  /** Longitude par défaut si la géolocalisation est refusée (default: -1.0833 - Saint-Lô) */
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
 * Composable pour gérer la géolocalisation en temps réel.
 * Gère le tracking continu, le throttling des reloads, et l'état de la permission.
 *
 * Le bandeau de notification « Géolocalisation active » est affiché pendant le tracking et masqué
 * automatiquement quand l'app passe en arrière-plan (le watchPosition web y est de toute façon
 * suspendu par l'OS), puis réaffiché au retour au premier plan si le tracking est toujours actif.
 * Aucun tracking en arrière-plan : API web premier-plan uniquement, pas de foreground service.
 *
 * @param options - Options de configuration
 * @returns État et actions pour la géolocalisation
 *
 * @example
 * const geolocation = useGeolocation({
 *   defaultLat: 49.1167,
 *   defaultLng: -1.0833,
 *   reloadThresholdKm: 5
 * })
 *
 * geolocation.registerCallbacks({
 *   onFirstPosition: (lat, lng) => {
 *     console.log('First position:', lat, lng)
 *     fetchNearbyData()
 *   },
 *   onDistanceThresholdReached: (distance) => {
 *     console.log(`Moved ${distance}km, reloading...`)
 *     fetchNearbyData()
 *   }
 * })
 *
 * geolocation.startTracking()
 */
export function useGeolocation(options: GeolocationOptions = {}) {
  const {
    defaultLat = 49.1167,  // Saint-Lô
    defaultLng = -1.0833,
    reloadThresholdKm = 5
  } = options

  // State
  const userLat = ref<number>(defaultLat)
  const userLng = ref<number>(defaultLng)
  const geolocLoading = ref<boolean>(false)
  const geolocError = ref<string | null>(null)
  const watchId = ref<number | null>(null)
  const isFirstPosition = ref<boolean>(true)
  const lastFetchLat = ref<number | null>(null)
  const lastFetchLng = ref<number | null>(null)
  const isTracking = ref<boolean>(false)

  // Callbacks externes (pour refresh des POIs par exemple)
  const onPositionUpdate = ref<((lat: number, lng: number) => void) | null>(null)
  const onFirstPosition = ref<((lat: number, lng: number) => void) | null>(null)
  const onDistanceThresholdReached = ref<((distance: number) => void) | null>(null)

  // useNotifications() doit être résolu dans le scope du composable (pendant le setup),
  // pas dans startTracking/stopTracking qui s'exécutent plus tard, hors setup → risque de
  // fuite/avertissement si rappelés plusieurs fois. #34
  const { showGeoNotification, hideGeoNotification } = useNotifications()

  // Masquage automatique du bandeau géo en arrière-plan : quand l'app passe en background, le
  // watchPosition web est suspendu par l'OS (aucune position lue) → laisser la notif afficherait
  // « position active » à tort. On la masque au passage en arrière-plan et on la réaffiche au retour
  // au premier plan tant que le tracking est actif. Listener natif via @capacitor/app.
  let appStateListener: PluginListenerHandle | null = null
  // Promesse d'inscription en vol : conservée pour que teardown puisse l'attendre. Sans ça,
  // un stop rapide pendant qu'App.addListener est en vol verrait appStateListener encore null
  // (no-op), puis l'inscription se résoudrait → listener natif orphelin jusqu'au reload.
  let appStateSetupPromise: Promise<void> | null = null

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
   * Démarre le tracking de position en temps réel.
   * Utilise navigator.geolocation.watchPosition() pour un suivi continu.
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
    // watchPosition). Le 1er appel (isFirstPosition) recentre la carte + déclenche onFirstPosition ;
    // les suivants mettent à jour la position et déclenchent le reload au-delà du seuil de distance.
    // JS étant mono-thread, le 1er appel bascule isFirstPosition à false de façon synchrone : aucun
    // risque de double-déclenchement même si les deux sources résolvent quasi simultanément.
    const applyPosition = (position: GeolocationPosition) => {
      const newLat = position.coords.latitude
      const newLng = position.coords.longitude

      if (isFirstPosition.value) {
        userLat.value = newLat
        userLng.value = newLng
        geolocLoading.value = false
        isFirstPosition.value = false
        lastFetchLat.value = newLat
        lastFetchLng.value = newLng
        if (onFirstPosition.value) onFirstPosition.value(newLat, newLng)
      } else {
        userLat.value = newLat
        userLng.value = newLng
        if (onPositionUpdate.value) onPositionUpdate.value(newLat, newLng)

        // Vérifier si besoin de reload (threshold dépassé)
        if (lastFetchLat.value !== null && lastFetchLng.value !== null) {
          const distance = calculateDistance(lastFetchLat.value, lastFetchLng.value, newLat, newLng)
          if (distance > reloadThresholdKm) {
            lastFetchLat.value = newLat
            lastFetchLng.value = newLng
            if (onDistanceThresholdReached.value) onDistanceThresholdReached.value(distance)
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
        enableHighAccuracy: false,  // Suivi : plus rapide/économe, WiFi/réseau au lieu de GPS
        timeout: 10000,             // tolérant (le fix précis est déjà assuré par getCurrentPosition)
        maximumAge: 10000           // Accepte une position de moins de 10 secondes
      }
    )

    isTracking.value = true
    showGeoNotification()
    setupAppStateListener()
  }

  /**
   * Arrête le tracking de position.
   * Nettoie le watchPosition et réinitialise l'état.
   */
  function stopTracking() {
    if (import.meta.client && watchId.value !== null) {
      navigator.geolocation.clearWatch(watchId.value)
      watchId.value = null
      isTracking.value = false
      hideGeoNotification()
      teardownAppStateListener()
    }
  }

  /**
   * Enregistre les callbacks pour les événements de géolocalisation.
   *
   * @param callbacks - Objet contenant les callbacks à enregistrer
   */
  function registerCallbacks(callbacks: GeolocationCallbacks) {
    if (callbacks.onPositionUpdate) {
      onPositionUpdate.value = callbacks.onPositionUpdate
    }
    if (callbacks.onFirstPosition) {
      onFirstPosition.value = callbacks.onFirstPosition
    }
    if (callbacks.onDistanceThresholdReached) {
      onDistanceThresholdReached.value = callbacks.onDistanceThresholdReached
    }
  }

  // Cleanup au unmount
  onUnmounted(() => {
    stopTracking()
  })

  return {
    // State (readonly pour external usage)
    userLat: readonly(userLat),
    userLng: readonly(userLng),
    geolocLoading: readonly(geolocLoading),
    geolocError: readonly(geolocError),
    isFirstPosition: readonly(isFirstPosition),
    isTracking: readonly(isTracking),

    // Actions
    startTracking,
    stopTracking,
    registerCallbacks
  }
}
