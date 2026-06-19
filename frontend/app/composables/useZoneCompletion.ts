import { useZoneStore, type Comcom } from '~/stores/zone'
import { useFogStore, GRID_LAT_STEP, GRID_LNG_STEP } from '~/stores/fog'
import { useProgressionStore } from '~/stores/progression'
import { useGuildStore } from '~/stores/guild'
import { useMuseumStore } from '~/stores/museum'
import { usePOIStore } from '~/stores/poi'
import { useVisitStore } from '~/stores/visit'
import { useRunStore } from '~/stores/run'
import { isPointInGeoJSON, computeGeoJSONArea, computeGeoJSONBounds } from '~/utils/geometry'

const COMPLETION_THRESHOLD = 0.5 // 50%

function getComcomDocId(comcom: Comcom): string {
  return comcom.documentId || comcom.id.toString()
}

/**
 * Détecte la complétion d'une communauté de communes (comcom) et la persiste côté API
 * pour dissiper définitivement le brouillard (fog-of-war) de la zone.
 *
 * Deux chemins de complétion indépendants, qui aboutissent au même seuil de 50 %
 * (COMPLETION_THRESHOLD = 0.5) :
 * - CHEMIN A (`checkFogCoverage`) : couverture géographique. À chaque position GPS, on ajoute
 *   une cellule de grille au fog store ; la zone est complétée quand le ratio
 *   cellules explorées / cellules totales atteint le seuil. Le total de cellules est dérivé
 *   de l'aire du polygone (formule du Shoelace, O(n sommets)) plutôt que d'un balayage de
 *   grille, puis mis en cache dans le fog store.
 * - CHEMIN B (`checkVisitCoverage`) : couverture des visites. Après chaque coffre ou fin
 *   d'expédition, on calcule le ratio de POI + musées visités parmi ceux contenus dans la zone.
 *
 * Choix non-évidents :
 * - `findComcomForPoint` pré-filtre par distance au centroïde (~11 km) avant le ray-casting
 *   `isPointInGeoJSON`, coûteux.
 * - `checkVisitCoverage` applique un pré-filtre bounding-box (exact, zéro faux négatif) avant
 *   le ray-casting pour éviter de tester les ~5000 POI à chaque coffre (#34).
 *
 * Invariants à préserver :
 * - Seuil de complétion = 50 % (COMPLETION_THRESHOLD), partagé par les deux chemins.
 * - `completeComcom` est protégé par un lock `pendingCompletions` (Set) pour empêcher les POST
 *   `/progressions` concurrents sur une même zone.
 * - On ne tente jamais de re-compléter une zone déjà marquée complétée
 *   (`progressionStore.isComcomCompleted`).
 * - La progression écrite est rattachée à la guilde courante (`guild`) : pas de guilde, pas
 *   d'appel API (isolation par utilisateur, cf. CLAUDE.md §IV).
 */
export function useZoneCompletion() {
  const zoneStore = useZoneStore()
  const fogStore = useFogStore()
  const progressionStore = useProgressionStore()
  const guildStore = useGuildStore()
  const museumStore = useMuseumStore()
  const poiStore = usePOIStore()
  const visitStore = useVisitStore()
  const runStore = useRunStore()

  // Lock pour éviter les appels API concurrents
  const pendingCompletions = new Set<string>()

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
   * Appelle l'API pour marquer une comcom comme complétée.
   * Puis refresh les progressions côté frontend.
   */
  async function completeComcom(comcomDocId: string) {
    if (pendingCompletions.has(comcomDocId)) return
    pendingCompletions.add(comcomDocId)

    try {
      const client = useApi()
      const guildDocId = guildStore.guild?.documentId
      if (!guildDocId) return

      await client<any>('/progressions', {
        method: 'POST',
        body: {
          data: {
            is_completed: true,
            comcom: comcomDocId,
            guild: guildDocId
          }
        }
      })

      // Refresh CIBLÉ des progressions (au lieu du fetchAll() profond) pour le FogLayer
      await guildStore.fetchProgressions()

      // Nettoyer les points GPS et les données de grille de la comcom
      const comcom = zoneStore.comcoms.find(
        c => getComcomDocId(c) === comcomDocId
      )
      if (comcom) {
        fogStore.removePointsInZones([comcom])
      }
      fogStore.clearGridForComcom(comcomDocId)

    } catch (e: any) {
      console.error('Failed to complete comcom:', e)
    } finally {
      pendingCompletions.delete(comcomDocId)
    }
  }

  /**
   * CHEMIN A — Vérifie la couverture du brouillard pour un point GPS.
   * Appelé à chaque addPosition.
   */
  function checkFogCoverage(lat: number, lng: number) {
    if (!zoneStore.isInitialized) return

    const comcom = findComcomForPoint(lat, lng)
    if (!comcom) return

    const docId = getComcomDocId(comcom)

    if (progressionStore.isComcomCompleted(docId)) return

    const isNew = fogStore.addGridCell(docId, lat, lng)
    if (!isNew) return

    computeTotalGridCells(comcom)

    const ratio = fogStore.getCoverageRatio(docId)
    if (ratio >= COMPLETION_THRESHOLD) {
      completeComcom(docId)
    }
  }

  /**
   * CHEMIN B — Vérifie la couverture des visites POI + musées.
   * Appelé après chaque openChest ou fin d'expédition.
   */
  function checkVisitCoverage(poiLat: number, poiLng: number) {
    if (!zoneStore.isInitialized) return

    const comcom = findComcomForPoint(poiLat, poiLng)
    if (!comcom) return

    const docId = getComcomDocId(comcom)

    if (progressionStore.isComcomCompleted(docId)) return

    // Pré-filtre bbox (exact, zéro faux négatif) AVANT le ray-casting coûteux : on évite
    // de tester isPointInGeoJSON sur les ~5000 POI à chaque coffre/fin d'expédition. #34
    const b = computeGeoJSONBounds(comcom.geometry)
    const inBounds = (lat: number, lng: number) =>
      !b || (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng)

    // POI dans cette comcom
    const poisInComcom = poiStore.pois.filter(p =>
      p.lat !== undefined && p.lng !== undefined && inBounds(p.lat, p.lng) &&
      isPointInGeoJSON([p.lat, p.lng], comcom.geometry)
    )

    // Musées dans cette comcom
    const museumsInComcom = museumStore.museums.filter(m =>
      m.lat !== undefined && m.lng !== undefined && inBounds(m.lat, m.lng) &&
      isPointInGeoJSON([m.lat, m.lng], comcom.geometry)
    )

    const totalLocations = poisInComcom.length + museumsInComcom.length
    if (totalLocations === 0) return

    // Compter les POI visités (au moins 1 visite via le système de visit)
    let visitedCount = 0
    for (const poi of poisInComcom) {
      if (visitStore.getVisitForPOI(poi.id)) {
        visitedCount++
      }
    }

    // Compter les musées visités (au moins 1 run via le système de run)
    for (const museum of museumsInComcom) {
      if (runStore.hasVisitedMuseum(museum.id)) {
        visitedCount++
      }
    }

    const ratio = visitedCount / totalLocations
    if (ratio >= COMPLETION_THRESHOLD) {
      completeComcom(docId)
    }
  }

  return {
    checkFogCoverage,
    checkVisitCoverage
  }
}
