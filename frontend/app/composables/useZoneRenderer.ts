import type * as Leaflet from 'leaflet'
import { toRaw } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { GeoZone } from '~/stores/zone'
import { useProgressionStore } from '~/stores/progression'

/**
 * Rendu des zones administratives (régions/départements/comcoms) et de leurs labels sur la carte
 * Leaflet, extrait de `map.vue` (#46) où la logique (~150 lignes) était inline.
 *
 * Choix non-évidents (préservés tels quels) :
 * - Renderer Canvas PERSISTANT : on réutilise le même `L.canvas()` tant que le TYPE de zone ne
 *   change pas (pan dans les comcoms → on remplace juste le layer GeoJSON). On ne détruit/recrée le
 *   renderer qu'au changement de type (comcoms→départements) — évite le bug SVG removeLayer/_renderer.
 * - Les labels sont des markers `divIcon` mémorisés dans `labelMarkersMap` (clé = documentId||id) :
 *   on ne touche au DOM que pour les entrées qui apparaissent/disparaissent (pas de churn au pan).
 * - `updateMapLayers` coalesce les appels multiples en UN rendu par frame via requestAnimationFrame.
 * - `renderer` est une option Leaflet valide au runtime mais absente de `GeoJSONOptions` (@types
 *   incomplet) → cast `as any` ciblé sur les options (comme `geoJsonData as any`).
 *
 * Invariant : `cleanup()` DOIT être appelé dans `onBeforeUnmount` de la page AVANT que vue-leaflet
 * détruise la carte (annule le rAF en attente, retire le layer/renderer et tous les markers de label).
 *
 * @example
 * const zoneLayers = useZoneRenderer({
 *   getMap: () => mapRef.value?.leafletObject, getL: () => L,
 *   isMapReady, currentZoom, visibleZones,
 * })
 * watch([visibleZones, isMapReady], () => zoneLayers.updateMapLayers())
 * onBeforeUnmount(() => zoneLayers.cleanup())
 */
interface ZoneRendererDeps {
  /** Accès paresseux à l'instance Leaflet.Map (non disponible en SSR / avant onMapReady). */
  getMap: () => Leaflet.Map | null | undefined
  /** Accès paresseux à la lib Leaflet (chargée dynamiquement en onMounted). */
  getL: () => typeof Leaflet | null
  isMapReady: Ref<boolean>
  currentZoom: Ref<number>
  visibleZones: ComputedRef<GeoZone[]>
}

const ZONE_STYLE = {
  color: '#ffffff',
  weight: 3,
  opacity: 0.8,
  fill: false,
  lineCap: 'round' as const,
  lineJoin: 'round' as const
} as const

export function useZoneRenderer(deps: ZoneRendererDeps) {
  const progressionStore = useProgressionStore()

  // Renderer Canvas persistant (évite le bug SVG removeLayer/_renderer)
  let zoneRenderer: Leaflet.Canvas | null = null
  let currentZoneLayer: Leaflet.GeoJSON | null = null
  const labelMarkersMap = new Map<string | number, Leaflet.Marker>()
  let lastZoneType: 'regions' | 'departments' | 'comcoms' | null = null
  let rafId: number | null = null

  const getZoneCenter = (zone: GeoZone): [number, number] | null => {
    if (zone.centerLat && zone.centerLng) return [zone.centerLat, zone.centerLng]
    try {
      const geo = toRaw(zone.geometry) as any
      if (!geo) return null
      let coords: any[] = []
      if (geo.type === 'Polygon') coords = geo.coordinates[0]
      else if (geo.type === 'MultiPolygon') coords = geo.coordinates[0][0]
      if (!coords || coords.length === 0) return null
      let sumLat = 0, sumLng = 0
      const len = coords.length
      for (let i = 0; i < len; i++) {
        sumLng += coords[i][0]
        sumLat += coords[i][1]
      }
      return [sumLat / len, sumLng / len]
    } catch (e) { return null }
  }

  const shouldHideZoneLabel = (zone: GeoZone): boolean => {
    if (deps.currentZoom.value < 8) {
      const id = zone.documentId || zone.id
      return progressionStore.isRegionCompleted(String(id))
    }
    return false
  }

  const getCurrentZoneType = (): 'regions' | 'departments' | 'comcoms' => {
    if (deps.currentZoom.value >= 11) return 'comcoms'
    if (deps.currentZoom.value >= 8) return 'departments'
    return 'regions'
  }

  const destroyZoneRenderer = () => {
    if (currentZoneLayer) {
      try { currentZoneLayer.remove() } catch (_) { /* ignore */ }
      currentZoneLayer = null
    }
    if (zoneRenderer) {
      try {
        const c = (zoneRenderer as any)._container
        if (c?.parentNode) c.parentNode.removeChild(c)
      } catch (_) { /* ignore */ }
      zoneRenderer = null
    }
  }

  const renderZones = () => {
    const map = deps.getMap()
    const L = deps.getL()
    if (!map || !deps.isMapReady.value || !L) return

    const zoneType = getCurrentZoneType()
    const typeChanged = zoneType !== lastZoneType
    lastZoneType = zoneType

    // Changement de type (comcoms→départements) : recréer le renderer
    // Même type (pan dans les comcoms) : réutiliser le renderer, juste remplacer le layer
    if (typeChanged) {
      destroyZoneRenderer()
    } else if (currentZoneLayer) {
      try { currentZoneLayer.remove() } catch (_) { /* ignore */ }
      currentZoneLayer = null
    }

    const zones = deps.visibleZones.value.filter(z => z.geometry)
    if (zones.length === 0) return

    const geoJsonData = {
      type: "FeatureCollection",
      features: zones.map(z => ({
        type: "Feature",
        geometry: toRaw(z.geometry),
        properties: {}
      }))
    }

    try {
      if (!zoneRenderer) zoneRenderer = L.canvas()
      currentZoneLayer = L.geoJSON(geoJsonData as any, {
        style: () => ZONE_STYLE,
        interactive: false,
        // `renderer` est valide au runtime mais hors du type GeoJSONOptions (@types incomplet)
        renderer: zoneRenderer
      } as any).addTo(map)
    } catch (e) {
      console.error("GeoJSON render error", e)
    }
  }

  const renderLabels = () => {
    const map = deps.getMap()
    const L = deps.getL()
    if (!map || !deps.isMapReady.value || !L) return

    const zones = deps.visibleZones.value
    const nextIds = new Set<string | number>()

    zones.forEach(zone => {
      if (shouldHideZoneLabel(zone)) return
      const center = getZoneCenter(zone)
      if (!center) return

      const key = zone.documentId || zone.id
      nextIds.add(key)

      // Le marker existe déjà → pas de DOM churn
      if (labelMarkersMap.has(key)) return

      const html = `<div class="text-center font-pixel text-white text-shadow-outline text-xs whitespace-nowrap overflow-visible pointer-events-none">${zone.name}</div>`

      const icon = L.divIcon({
        className: 'zone-label-icon',
        html: html,
        iconSize: [100, 20],
        iconAnchor: [50, 10]
      })

      const marker = L.marker(center, {
        icon: icon,
        interactive: false,
        zIndexOffset: 1000
      }).addTo(map)
      labelMarkersMap.set(key, marker)
    })

    // Retirer les markers qui ne sont plus visibles
    for (const [key, marker] of labelMarkersMap) {
      if (!nextIds.has(key)) {
        try { marker.remove() } catch (_) { /* ignore */ }
        labelMarkersMap.delete(key)
      }
    }
  }

  /** Coalesce les appels multiples en un seul rendu par frame (zones + labels). */
  const updateMapLayers = () => {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      renderZones()
      renderLabels()
    })
  }

  /** À appeler dans onBeforeUnmount AVANT la destruction de la carte par vue-leaflet. */
  const cleanup = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    destroyZoneRenderer()
    for (const marker of labelMarkersMap.values()) {
      try { marker.remove() } catch (_) { /* ignore */ }
    }
    labelMarkersMap.clear()
  }

  return { updateMapLayers, cleanup }
}
