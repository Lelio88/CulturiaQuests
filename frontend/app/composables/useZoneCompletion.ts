import { useZoneStore, type Comcom } from '~/stores/zone'
import { useFogStore, GRID_LAT_STEP, GRID_LNG_STEP } from '~/stores/fog'
import { useProgressionStore } from '~/stores/progression'
import { isPointInGeoJSON, computeGeoJSONArea } from '~/utils/geometry'

const COMPLETION_THRESHOLD = 0.5 // 50% — conservé comme seuil de complétion (côté SERVEUR désormais)

function getComcomDocId(comcom: Comcom): string {
  return comcom.documentId || comcom.id.toString()
}

/**
 * Suivi de la COUVERTURE D'EXPLORATION (fog) d'une comcom, à des fins d'AFFICHAGE uniquement.
 *
 * ⚠️ La COMPLÉTION d'une zone est désormais SERVEUR-AUTORITATIVE (#54, anti-triche niveau 2) :
 * c'est le backend qui marque `is_completed` à partir des VISITES VÉRIFIÉES (geofence) —
 * cf. `backend/src/utils/comcom-completion.ts`, déclenché par `openChest` / `endExpedition`.
 * Le client ne déclenche plus AUCUNE complétion (l'ancien POST `/progressions { is_completed }`
 * est désormais ignoré côté serveur — la voie « fog », invérifiable, ne débloque donc plus rien).
 *
 * Ce composable ne fait plus QUE tracer la couverture de grille de fog, qui alimente le PALIER (%)
 * affiché pour les zones encore NON complétées (`stores/badge.ts` utilise `getCoverageRatio` en
 * repli quand `isComcomCompleted` est faux). Le brouillard VISUEL (FogLayer) est géré séparément
 * via `fogStore.discoveredPoints` / `addPosition` et se dissipe pour une zone dès que
 * `progressionStore.isComcomCompleted` passe à vrai (donnée serveur, rafraîchie via
 * `guildStore.fetchProgressions()` après chaque visite).
 *
 * Invariant : ne JAMAIS réintroduire d'écriture de complétion côté client (falsifiable).
 */
export function useZoneCompletion() {
  const zoneStore = useZoneStore()
  const fogStore = useFogStore()
  const progressionStore = useProgressionStore()

  /**
   * Trouve la comcom dans laquelle se situe un point GPS.
   * Optimisé : check d'abord par distance au centroïde avant le ray-casting.
   */
  function findComcomForPoint(lat: number, lng: number): Comcom | null {
    const comcoms = zoneStore.comcoms
    if (!comcoms || comcoms.length === 0) return null

    // Pré-filtre par distance au centroïde (~11km de rayon)
    const candidates = comcoms.filter(c => {
      if (c.centerLat == null || c.centerLng == null) return false
      const dLat = Math.abs(c.centerLat - lat)
      const dLng = Math.abs(c.centerLng - lng)
      return dLat < 0.1 && dLng < 0.15
    })

    for (const comcom of candidates) {
      if (isPointInGeoJSON([lat, lng], comcom.geometry)) {
        return comcom
      }
    }
    return null
  }

  /**
   * Calcule le nombre total de cellules de grille dans une comcom.
   * Fait une seule fois par comcom, puis stocké dans le fog store.
   */
  function computeTotalGridCells(comcom: Comcom): number {
    const docId = getComcomDocId(comcom)
    if (fogStore.hasTotalGridCells(docId)) {
      return fogStore.totalGridCells[docId] ?? 0
    }

    const geometry = comcom.geometry
    if (!geometry) return 0

    // Calcul via la formule du Shoelace : aire du polygone / aire d'une cellule
    // O(n vertices) au lieu de O(n cells × n vertices)
    const areaDeg2 = computeGeoJSONArea(geometry)
    const cellArea = GRID_LAT_STEP * GRID_LNG_STEP
    const count = Math.max(Math.round(areaDeg2 / cellArea), 1)

    fogStore.setTotalGridCells(docId, count)
    return count
  }

  /**
   * À chaque position GPS : marque la cellule de grille visitée pour la comcom courante.
   * Sert UNIQUEMENT au calcul du palier d'affichage (`badge.ts`) — ne déclenche AUCUNE complétion
   * (celle-ci est décidée par le serveur à partir des visites vérifiées).
   */
  function checkFogCoverage(lat: number, lng: number) {
    if (!zoneStore.isInitialized) return

    const comcom = findComcomForPoint(lat, lng)
    if (!comcom) return

    const docId = getComcomDocId(comcom)

    // Zone déjà complétée (serveur) : plus rien à tracer (badge.ts affiche 100%).
    if (progressionStore.isComcomCompleted(docId)) return

    const isNew = fogStore.addGridCell(docId, lat, lng)
    if (!isNew) return

    computeTotalGridCells(comcom)
  }

  return {
    checkFogCoverage
  }
}
