<template>
  <div style="display: none;"></div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref } from 'vue'
import { useFogStore } from '~/stores/fog'
import { useZoneStore } from '~/stores/zone'
import { useProgressionStore } from '~/stores/progression'
import type { Map } from 'leaflet'
import L from 'leaflet'

const props = defineProps<{
  map: any // Instance L.Map
}>()

const fogStore = useFogStore()
const zoneStore = useZoneStore()
const progressionStore = useProgressionStore()

const canvas = ref<HTMLCanvasElement | null>(null)
let fogPane: HTMLElement | null = null

// --- CONFIGURATION ---
const CONFIG = {
  RADIUS_METERS: 100,
  OPACITY: 0.95,
  COLOR: '210, 215, 220',
  BG_COLOR: 'rgba(190, 195, 200, 0.3)',
  /**
   * Marge du canvas autour de l'écran, en fraction de sa taille (0.5 = une demi-largeur de chaque
   * côté). Pendant un glissement, Leaflet translate le calque en CSS : tant que l'écran reste dans
   * la zone dessinée, aucun redessin n'est nécessaire. Même principe que le `padding` des
   * renderers Leaflet.
   */
  PAD: 0.5,
}

// --- ÉTAT INTERNE ---
let cloudPattern: CanvasPattern | null = null
let brushCanvas: HTMLCanvasElement | null = null
let lastZoomForBrush = -1
let fogRafId: number | null = null
// Zone effectivement dessinée, en coordonnées « layer » Leaflet (stables pendant un glissement).
let drawnOrigin: L.Point | null = null
let drawnSize: L.Point | null = null

// --- GÉNÉRATEURS ---

const createCloudPattern = (ctx: CanvasRenderingContext2D): CanvasPattern | null => {
  const size = 512
  const cvs = document.createElement('canvas')
  cvs.width = size
  cvs.height = size
  const pCtx = cvs.getContext('2d', { alpha: true })
  if (!pCtx) return null

  pCtx.fillStyle = CONFIG.BG_COLOR
  pCtx.fillRect(0, 0, size, size)

  const puffCount = 400
  for (let i = 0; i < puffCount; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 30 + Math.random() * 50
    const op = 0.3 + Math.random() * 0.4

    const g = pCtx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${CONFIG.COLOR}, ${op})`)
    g.addColorStop(1, `rgba(${CONFIG.COLOR}, 0)`)
    
    pCtx.fillStyle = g
    pCtx.beginPath()
    pCtx.arc(x, y, r, 0, Math.PI * 2)
    pCtx.fill()

    const offset = (ox: number, oy: number) => {
      pCtx.fillStyle = g
      pCtx.beginPath()
      pCtx.arc(x + ox, y + oy, r, 0, Math.PI * 2)
      pCtx.fill()
    }
    
    if (x - r < 0) offset(size, 0)
    if (x + r > size) offset(-size, 0)
    if (y - r < 0) offset(0, size)
    if (y + r > size) offset(0, -size)
  }

  return ctx.createPattern(cvs, 'repeat')
}

const updateBrush = (zoom: number, centerLat: number): HTMLCanvasElement => {
  const metersPerPixel = 40075016.686 * Math.abs(Math.cos(centerLat * Math.PI / 180)) / Math.pow(2, zoom + 8)
  const radiusPx = Math.ceil(CONFIG.RADIUS_METERS / metersPerPixel)
  const diameter = radiusPx * 2
  
  const cvs = document.createElement('canvas')
  cvs.width = diameter
  cvs.height = diameter
  const ctx = cvs.getContext('2d')
  if (!ctx) return cvs

  const g = ctx.createRadialGradient(radiusPx, radiusPx, radiusPx * 0.5, radiusPx, radiusPx, radiusPx)
  g.addColorStop(0, 'rgba(0,0,0,1)')
  g.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.fillStyle = g
  ctx.fillRect(0, 0, diameter, diameter)
  return cvs
}

// --- GEOMETRY HELPERS ---

// `offset` : décalage du coin du canvas par rapport au coin de l'écran (la marge PAD).
const projectRing = (ctx: CanvasRenderingContext2D, coords: any[], map: Map, offset: L.Point) => {
  if (coords.length === 0) return
  const start = map.latLngToContainerPoint([coords[0][1], coords[0][0]]) // [lng, lat] -> [lat, lng]
  ctx.moveTo(start.x + offset.x, start.y + offset.y)
  
  for (let i = 1; i < coords.length; i++) {
    const p = map.latLngToContainerPoint([coords[i][1], coords[i][0]])
    ctx.lineTo(p.x + offset.x, p.y + offset.y)
  }
}

const drawGeometry = (ctx: CanvasRenderingContext2D, geometry: any, map: Map, offset: L.Point) => {
  if (!geometry) return

  ctx.beginPath() // Un seul path pour toute la géométrie
  if (geometry.type === 'Polygon') {
    // Outer ring
    projectRing(ctx, geometry.coordinates[0], map, offset)
    ctx.closePath()
    // Holes (Leaflet/Canvas gère les trous avec la règle evenodd/nonzero si on trace tout dans le même path)
    for (let i = 1; i < geometry.coordinates.length; i++) {
      projectRing(ctx, geometry.coordinates[i], map, offset)
      ctx.closePath()
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      projectRing(ctx, poly[0], map, offset)
      ctx.closePath()
      for (let i = 1; i < poly.length; i++) {
        projectRing(ctx, poly[i], map, offset)
        ctx.closePath()
      }
    }
  }
  ctx.fill() // Remplir (Gommer)
}

// --- RENDU ---

const drawFog = () => {
  if (!props.map || !canvas.value || !fogPane) return
  
  const map = props.map as Map
  const ctx = canvas.value.getContext('2d', { desynchronized: true })
  if (!ctx) return

  if (!cloudPattern) cloudPattern = createCloudPattern(ctx)

  // Canvas plus grand que l'écran (marge PAD de chaque côté) : cf. CONFIG.PAD.
  const viewSize = map.getSize()
  const offset = L.point(Math.round(viewSize.x * CONFIG.PAD), Math.round(viewSize.y * CONFIG.PAD))
  const size = viewSize.add(offset.multiplyBy(2))
  const topLeft = map.containerPointToLayerPoint([-offset.x, -offset.y])
  L.DomUtil.setPosition(canvas.value, topLeft)
  drawnOrigin = topLeft
  drawnSize = size
  
  if (canvas.value.width !== size.x || canvas.value.height !== size.y) {
    canvas.value.width = size.x
    canvas.value.height = size.y
  }

  // 1. Fond complet (Brouillard partout)
  ctx.clearRect(0, 0, size.x, size.y)
  ctx.globalCompositeOperation = 'source-over'
  
  if (cloudPattern) {
    const mat = new DOMMatrix().translate(-topLeft.x, -topLeft.y).scale(0.5)
    cloudPattern.setTransform(mat)
    ctx.fillStyle = cloudPattern
    ctx.globalAlpha = CONFIG.OPACITY
    ctx.fillRect(0, 0, size.x, size.y)
  }

  // 2. Mode Gomme
  ctx.globalCompositeOperation = 'destination-out'
  ctx.globalAlpha = 1.0
  ctx.fillStyle = 'rgba(0,0,0,1)' // Couleur de gomme pleine

  // 3. Gommage des Zones Complétées (viewport culling)
  const zoom = map.getZoom()
  const allZones = zoneStore.getZonesForZoom(zoom)
  const viewBounds = map.getBounds().pad(CONFIG.PAD + 0.3)
  // Bornes numériques extraites une fois : évite un `new L.LatLng` par zone (bounds.contains([...]))
  // à chaque frame — le redraw tourne désormais sur 'move' (suivi du doigt), pas seulement 'moveend'.
  const vS = viewBounds.getSouth(), vN = viewBounds.getNorth(), vW = viewBounds.getWest(), vE = viewBounds.getEast()

  const isCompleted = (zone: any) => {
    const id = zone.documentId || zone.id
    if (zoom >= 11) return progressionStore.isComcomCompleted(id)
    if (zoom >= 8) return progressionStore.isDepartmentCompleted(id)
    return progressionStore.isRegionCompleted(id)
  }

  for (const zone of allZones) {
    // Skip les zones hors viewport (évite des milliers de latLngToContainerPoint inutiles)
    // `!= null` et non un test de véracité : une coordonnée à 0 est valide, et un test falsy
    // empêcherait le skip → la zone serait redessinée même hors viewport (#174).
    if (zone.centerLat != null && zone.centerLng != null &&
        (zone.centerLat < vS || zone.centerLat > vN || zone.centerLng < vW || zone.centerLng > vE)) continue
    if (isCompleted(zone)) {
      drawGeometry(ctx, zone.geometry, map, offset)
    }
  }

  // 4. Gommage des Points GPS (Classique)
  if (!brushCanvas || zoom !== lastZoomForBrush) {
    brushCanvas = updateBrush(zoom, map.getCenter().lat)
    lastZoomForBrush = zoom
  }

  if (brushCanvas) {
    const bounds = map.getBounds().pad(CONFIG.PAD + 0.2)
    // Bornes numériques extraites une fois : le culling évite un `new L.LatLng` par point
    // (jusqu'à ~5000) à chaque frame — critique maintenant que le redraw tourne sur 'move'.
    const pS = bounds.getSouth(), pN = bounds.getNorth(), pW = bounds.getWest(), pE = bounds.getEast()
    const points = fogStore.discoveredPoints
    const radiusOffset = brushCanvas.width / 2
    const dx = offset.x - radiusOffset
    const dy = offset.y - radiusOffset

    for (let i = 0; i < points.length; i++) {
      const pt = points[i]!
      if (pt.lat < pS || pt.lat > pN || pt.lng < pW || pt.lng > pE) continue

      const p = map.latLngToContainerPoint([pt.lat, pt.lng])
      ctx.drawImage(brushCanvas, p.x + dx, p.y + dy)
    }
  }
}

// --- RÉACTIVITÉ (rAF-coalescing) ---

// Coalesce tous les déclencheurs de redraw (events carte + watchers) en AU PLUS un dessin par
// frame : plusieurs 'move'/'zoomend'/mutations de points au même tick ne produisent qu'un seul
// drawFog. C'est ce qui rend le suivi du doigt fluide pendant le drag sans exploser le CPU.
const scheduleFogRedraw = () => {
  if (fogRafId !== null) return
  fogRafId = requestAnimationFrame(() => {
    fogRafId = null
    drawFog()
  })
}

/**
 * Pendant un glissement : redessine seulement si l'écran sort de la zone déjà dessinée. Le reste
 * du temps, la translation CSS de Leaflet suffit et aucun pixel n'est recalculé.
 */
const onMapMove = () => {
  if (!props.map || !drawnOrigin || !drawnSize) {
    scheduleFogRedraw()
    return
  }
  const map = props.map as Map
  const view = map.getSize()
  const viewTopLeft = map.containerPointToLayerPoint([0, 0])
  const isOutside = viewTopLeft.x < drawnOrigin.x
    || viewTopLeft.y < drawnOrigin.y
    || viewTopLeft.x + view.x > drawnOrigin.x + drawnSize.x
    || viewTopLeft.y + view.y > drawnOrigin.y + drawnSize.y
  if (isOutside) scheduleFogRedraw()
}

// --- LIFECYCLE ---

onMounted(() => {
  if (!props.map) return
  const map = props.map as Map

  if (!map.getPane('fogPane')) {
    fogPane = map.createPane('fogPane')
    fogPane.style.zIndex = '300'
    fogPane.style.pointerEvents = 'none'
  } else {
    fogPane = map.getPane('fogPane') ?? null
  }

  const cvs = document.createElement('canvas')
  cvs.className = 'leaflet-zoom-animated'
  fogPane?.appendChild(cvs)
  canvas.value = cvs

  // Pendant le glissement ('move'), le canvas suit la carte par translation CSS et sa marge
  // (CONFIG.PAD) couvre les bords : on ne redessine que si l'écran sort de la zone dessinée
  // (onMapMove), puis une fois en fin de geste ('moveend') pour recentrer la marge. Tous les
  // redraws passent par le rAF-coalescing (au plus 1 dessin/frame). 'zoom' (continu) est
  // volontairement EXCLU : le canvas porte la classe `leaflet-zoom-animated`, un redraw en plein
  // zoom entrerait en conflit avec l'animation (on recale au 'zoomend').
  map.on('move', onMapMove)
  map.on('moveend zoomend resize', scheduleFogRedraw)
  drawFog() // premier rendu immédiat (pas différé au prochain frame)
})

function cleanup() {
  if (fogRafId !== null) {
    cancelAnimationFrame(fogRafId)
    fogRafId = null
  }
  if (props.map) {
    try {
      const map = props.map as Map
      map.off('move', onMapMove)
      map.off('moveend zoomend resize', scheduleFogRedraw)
    } catch (_) { /* ignore */ }
  }
  if (canvas.value && fogPane) {
    try { fogPane.removeChild(canvas.value) } catch (_) { /* ignore */ }
  }
  canvas.value = null
  fogPane = null
  drawnOrigin = null
  drawnSize = null
}

defineExpose({ cleanup })

onBeforeUnmount(() => {
  cleanup()
})

// Réactivité — le watcher passe par le même rAF-coalescing (scheduleFogRedraw défini plus haut,
// partagé avec les events carte).
watch(
  () => [fogStore.discoveredPoints.length, zoneStore.isInitialized, progressionStore.progressions.length],
  scheduleFogRedraw
)
</script>
