import { calculateDistanceMeters } from './geolocation'

/**
 * Règle de précision adaptative du suivi GPS : décide, à chaque position, si le téléphone doit
 * suivre le joueur finement (« precise ») ou économiser la batterie (« economy »).
 *
 * Fonction pure, sans état caché : l'appelant (`plugins/geolocation.client.ts`) conserve
 * l'état et le repasse à chaque position ; `useGeolocation().setPrecisionMode` applique le mode.
 *
 * Choix non-évidents :
 * - **La précision ne sert qu'à l'approche.** Les interactions (coffres, expéditions) sont
 *   géo-clôturées à 50 m : le GPS fin n'est utile qu'à proximité d'un lieu. Loin de tout,
 *   une position à quelques dizaines de mètres suffit au brouillard (points espacés de 20 m,
 *   grille de couverture de 200 m).
 * - **Hystérésis** (entrée à 250 m, sortie à 400 m) : un seuil unique ferait basculer le
 *   mode en boucle pour un joueur qui marche le long de la frontière, et chaque bascule
 *   relance la surveillance native.
 * - **Escalade sur imprécision** : là où le Wi-Fi manque (campagne, intérieur), le mode
 *   économie ne livre que des positions à plusieurs centaines de mètres et le brouillard
 *   ne se révèle plus. On repasse alors en précis, maintenu cinq minutes pour ne pas
 *   osciller entre les deux.
 *
 * Invariant : sans lieu chargé à proximité (`nearestTargetM === null`), le mode est
 * « economy » — sauf escalade en cours.
 *
 * @example
 * let state = INITIAL_PRECISION_STATE
 * state = nextPrecision(state, { nearestTargetM: 120, accuracyM: 15, now: Date.now() })
 * state.mode // 'precise'
 */

export type PrecisionMode = 'precise' | 'economy'

/** Distance (m) à un lieu en deçà de laquelle le suivi passe en précis. */
export const PRECISE_ENTER_M = 250
/** Distance (m) au-delà de laquelle le suivi repasse en économie. */
export const PRECISE_EXIT_M = 400
/** Précision (m) au-delà de laquelle le mode économie est jugé inexploitable. */
export const POOR_ACCURACY_M = 100
/** Durée (ms) pendant laquelle le mode précis est maintenu après une escalade. */
export const ESCALATION_HOLD_MS = 5 * 60_000

export interface PrecisionState {
  mode: PrecisionMode
  /** Horodatage (ms) jusqu'auquel le mode précis est imposé ; 0 = aucune escalade. */
  holdPreciseUntil: number
}

export interface PrecisionInput {
  /** Distance au lieu le plus proche, en mètres ; null si aucun lieu n'est chargé. */
  nearestTargetM: number | null
  /** Précision du dernier point accepté, en mètres ; null si inconnue. */
  accuracyM: number | null
  now: number
}

/** État de départ : précis, comme le suivi avant la première décision. */
export const INITIAL_PRECISION_STATE: PrecisionState = { mode: 'precise', holdPreciseUntil: 0 }

/**
 * Calcule le mode de précision suivant.
 *
 * @param state - État courant (jamais modifié)
 * @param input - Distance au lieu le plus proche, précision du dernier point, horloge
 * @returns Nouvel état
 */
export function nextPrecision(state: PrecisionState, input: PrecisionInput): PrecisionState {
  const isPoorEconomy = state.mode === 'economy'
    && input.accuracyM !== null
    && input.accuracyM > POOR_ACCURACY_M
  if (isPoorEconomy) {
    return { mode: 'precise', holdPreciseUntil: input.now + ESCALATION_HOLD_MS }
  }

  if (input.now < state.holdPreciseUntil) {
    return { ...state, mode: 'precise' }
  }

  const distance = input.nearestTargetM
  if (distance !== null && distance <= PRECISE_ENTER_M) {
    return { ...state, mode: 'precise' }
  }
  if (distance === null || distance >= PRECISE_EXIT_M) {
    return { ...state, mode: 'economy' }
  }
  return state
}

interface LatLng {
  lat?: number | null
  lng?: number | null
}

/**
 * Distance, en mètres, du point au lieu le plus proche parmi plusieurs listes.
 * Les lieux sans coordonnées exploitables sont ignorés.
 *
 * @returns Distance minimale, ou null si aucune liste ne contient de lieu localisé
 */
export function nearestDistanceM(
  lat: number,
  lng: number,
  ...lists: ReadonlyArray<ReadonlyArray<LatLng>>
): number | null {
  let nearest: number | null = null
  for (const list of lists) {
    for (const place of list) {
      if (typeof place.lat !== 'number' || typeof place.lng !== 'number') continue
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) continue
      const distance = calculateDistanceMeters(lat, lng, place.lat, place.lng)
      if (nearest === null || distance < nearest) nearest = distance
    }
  }
  return nearest
}
