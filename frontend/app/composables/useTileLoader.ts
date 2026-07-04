import { ref, type Ref } from 'vue'

/**
 * Chargeur d'entités géolocalisées PAR TUILES (déport bbox) — remplace le téléchargement intégral
 * du catalogue (inviable dès qu'on peuple la France entière : dizaines de milliers d'entités →
 * download + mémoire mobile explosifs). On ne charge que les tuiles ~`tileDeg`° recouvrant la zone
 * visible/demandée.
 *
 * Passe par le **BFF authentifié** (`/api/strapi/<resource>`, cookie httpOnly → Bearer injecté côté
 * serveur) : `poi.find`/`museum.find` ne sont accordés qu'au rôle `authenticated` dans le bootstrap
 * (backend/src/index.ts) ; un fetch direct non authentifié casserait sur un déploiement neuf. La
 * carte et les quêtes sont réservées aux connectés, donc la session est toujours présente.
 *
 * Robustesse (revue adversariale) :
 * - **Fetch PAR TUILE** (pas par rectangle englobant) : le plafond `MAX_PAGES` s'applique à une aire
 *   bornée, un pan ne re-télécharge que les tuiles réellement nouvelles, et une tuile n'est marquée
 *   « chargée » qu'après SUCCÈS COMPLET.
 * - **Commit ATOMIQUE par tuile** : les `id` de dédup et les entités ne sont ajoutés qu'à la fin,
 *   ensemble. Une coupure réseau en cours de pagination ne « perd » donc jamais des entités déjà
 *   lues (sinon un `ids.has` orphelin les filtrerait à jamais).
 * - **Tuiles demi-ouvertes** (`$gte` sud/ouest, `$lt` nord/est) : chaque entité est dans EXACTEMENT
 *   une tuile → pas de recouvrement, éviction propre.
 * - **Éviction LRU** (`maxTiles`) : borne la mémoire sur une longue session d'exploration (on retire
 *   les plus anciennes tuiles ET leurs entités).
 * - **Garde `inFlight`** : deux `loadBounds` concurrents (pans rapprochés) ne re-fetchent pas la même
 *   tuile.
 *
 * Invariants : `tileDeg` constant sur la durée de vie ; `clear()` remet TOUT à zéro ensemble.
 *
 * @example
 * const loader = useTileLoader<Poi>({ resource: 'pois', normalize: normalizePoi })
 * await loader.loadBounds({ south, north, west, east })
 * await loader.loadAround(lat, lng, 25)
 */

export interface Bounds { south: number; north: number; west: number; east: number }

export interface TileLoaderItem {
  id: number | string
  lat?: number
  lng?: number
}

interface TileLoaderOptions<T> {
  /** Ressource Strapi, ex. 'pois' → GET /api/strapi/pois (via BFF authentifié). */
  resource: string
  /** Normalisation d'une ligne brute Strapi vers l'entité T. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  normalize: (raw: any) => T
  /** Query additionnelle (ex. `{ populate: 'tags' }` pour les musées). */
  extraQuery?: Record<string, string | number>
  /** Taille de tuile en degrés (défaut 0.1° ≈ 11 km de latitude). */
  tileDeg?: number
  /** Nombre max de tuiles gardées en mémoire avant éviction LRU (défaut 400). */
  maxTiles?: number
}

export function useTileLoader<T extends TileLoaderItem>(opts: TileLoaderOptions<T>) {
  const items = ref<T[]>([]) as Ref<T[]>
  const loading = ref(false)
  const error = ref<string | null>(null)

  const TILE = opts.tileDeg ?? 0.1
  const MAX_PAGES = 50
  const MAX_TILES = opts.maxTiles ?? 400
  const CONCURRENCY = 4

  const loadedTiles = new Set<string>()          // tuiles récupérées avec succès
  const inFlight = new Set<string>()             // tuiles en cours de fetch
  const tileOrder: string[] = []                 // ordre d'insertion (LRU)
  const tileItems = new Map<string, T[]>()       // entités par tuile (pour éviction)
  const ids = new Set<T['id']>()                 // dédup global

  const tileIdx = (v: number) => Math.floor(v / TILE)
  const key = (la: number, lo: number) => `${la}:${lo}`

  function missingTiles(b: Bounds): Array<[number, number]> {
    const out: Array<[number, number]> = []
    for (let la = tileIdx(b.south); la <= tileIdx(b.north); la++) {
      for (let lo = tileIdx(b.west); lo <= tileIdx(b.east); lo++) {
        const k = key(la, lo)
        if (!loadedTiles.has(k) && !inFlight.has(k)) out.push([la, lo])
      }
    }
    return out
  }

  function evictIfNeeded(): void {
    while (tileOrder.length > MAX_TILES) {
      const old = tileOrder.shift()
      if (!old) break
      loadedTiles.delete(old)
      const removed = tileItems.get(old)
      tileItems.delete(old)
      if (removed && removed.length) {
        const rm = new Set(removed.map((it) => it.id))
        for (const id of rm) ids.delete(id)
        items.value = items.value.filter((it) => !rm.has(it.id))
      }
    }
  }

  /** Récupère UNE tuile (demi-ouverte), commit atomique en cas de succès complet. */
  async function fetchTile(la: number, lo: number): Promise<void> {
    const k = key(la, lo)
    inFlight.add(k)
    try {
      const south = la * TILE, north = (la + 1) * TILE
      const west = lo * TILE, east = (lo + 1) * TILE
      const collected: T[] = []
      let page = 1
      let hasMore = true
      let truncated = false
      while (hasMore) {
        if (page > MAX_PAGES) { truncated = true; break }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp: any = await $fetch(`/api/strapi/${opts.resource}`, {
          query: {
            'filters[lat][$gte]': south, 'filters[lat][$lt]': north,
            'filters[lng][$gte]': west, 'filters[lng][$lt]': east,
            'pagination[page]': page, 'pagination[pageSize]': 100,
            ...opts.extraQuery,
          },
        })
        for (const raw of (resp.data || [])) collected.push(opts.normalize(raw))
        if (resp.meta?.pagination && page < resp.meta.pagination.pageCount) page++
        else hasMore = false
      }
      // Commit atomique : ids + items + marquage, seulement après pagination réussie.
      const fresh = collected.filter((it) => it.id != null && !ids.has(it.id))
      for (const it of fresh) ids.add(it.id)
      if (fresh.length) items.value = items.value.concat(fresh)
      tileItems.set(k, fresh)
      loadedTiles.add(k)
      tileOrder.push(k)
      if (truncated) console.warn(`[useTileLoader] ${opts.resource}: tuile ${k} tronquée à ${MAX_PAGES * 100} entités.`)
      evictIfNeeded()
    } finally {
      inFlight.delete(k) // libéré succès OU échec → une tuile échouée reste « manquante » (retry propre)
    }
  }

  async function loadBounds(b: Bounds): Promise<void> {
    if (!import.meta.client) return
    const missing = missingTiles(b)
    if (!missing.length) return
    loading.value = true
    error.value = null
    try {
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        await Promise.all(
          missing.slice(i, i + CONCURRENCY).map(([la, lo]) =>
            fetchTile(la, lo).catch((e) => { error.value = e instanceof Error ? e.message : 'load error' }),
          ),
        )
      }
    } finally {
      loading.value = false
    }
  }

  /** Charge un rayon approximatif (km) autour d'un point (ex. quêtes du jour, hors carte). */
  async function loadAround(lat: number, lng: number, radiusKm: number): Promise<void> {
    const dLat = radiusKm / 111
    const dLng = radiusKm / (111 * Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 1e-6))
    await loadBounds({ south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng })
  }

  function clear(): void {
    items.value = []
    loadedTiles.clear()
    inFlight.clear()
    tileOrder.length = 0
    tileItems.clear()
    ids.clear()
    error.value = null
  }

  return { items, loading, error, loadBounds, loadAround, clear }
}
