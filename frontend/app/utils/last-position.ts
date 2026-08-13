/**
 * Mémorisation de la dernière position GPS connue du joueur (localStorage).
 *
 * Sert à ouvrir la carte LÀ où le joueur était plutôt que sur Saint-Lô en dur : évite le flash
 * « Saint-Lô » au démarrage le temps du premier fix GPS.
 *
 * Choix non-évident : `localStorage` et non le store Pinia persisté. La position est écrite à
 * chaque tick GPS (~1 Hz en haute précision) ; passer par Pinia déclencherait une sérialisation
 * du store entier à cette fréquence. Ici on n'écrit que deux nombres, hors du graphe réactif.
 *
 * Invariants :
 * - Toujours gardé par `import.meta.client` : pas de `localStorage` en SSR.
 * - Toute erreur (quota, navigation privée, JSON corrompu) est absorbée en silence et repliée sur
 *   Saint-Lô : la mémorisation d'un confort d'affichage ne doit jamais casser le rendu de la carte.
 *
 * @example
 * const { lat, lng } = readLastPosition()
 * saveLastPosition(49.1167, -1.0833)
 */

const LAST_POSITION_KEY = 'cq_last_position'

/** Position de repli au tout premier lancement : Saint-Lô. */
export const DEFAULT_POSITION = { lat: 49.1167, lng: -1.0833 } as const

/**
 * Lit la dernière position mémorisée.
 *
 * @returns La position mémorisée, ou Saint-Lô si aucune n'est disponible/valide
 */
export function readLastPosition(): { lat: number; lng: number } {
  if (import.meta.client) {
    try {
      const raw = localStorage.getItem(LAST_POSITION_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        if (Number.isFinite(p?.lat) && Number.isFinite(p?.lng)) return { lat: p.lat, lng: p.lng }
      }
    } catch { /* JSON invalide / storage indisponible → repli défaut */ }
  }
  return { ...DEFAULT_POSITION }
}

/**
 * Mémorise une position. No-op en SSR ou si le storage est indisponible.
 */
export function saveLastPosition(lat: number, lng: number): void {
  if (import.meta.client) {
    try { localStorage.setItem(LAST_POSITION_KEY, JSON.stringify({ lat, lng })) } catch { /* quota / private */ }
  }
}
