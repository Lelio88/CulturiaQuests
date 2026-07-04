/**
 * geo.ts — Utilitaires géométriques partagés pour l'importer POI (rattachement géographique).
 *
 * Fournit le point-in-polygon GeoJSON (ray-casting, anneau extérieur) + un `ZoneResolver` qui,
 * à partir des géométries de comcoms, résout (lat, lng) → { comcomId, departmentId, regionId }.
 *
 * Motivation : l'ancien rattachement se faisait PAR NOM (`findZoneId` en `$eq` exact sur le nom
 * d'EPCI issu du scan), ce qui laissait des POI orphelins (nom EPCI ≠ comcom.name en base) et de
 * FAUSSES assignations (le scan Overpass par BBox capte des POI d'EPCI voisines, tous nommés à
 * l'EPCI scannée). Le rattachement géographique supprime les deux à la source.
 *
 * Choix non-évidents :
 * - On ne teste que l'anneau EXTÉRIEUR (les trous/enclaves sont négligés — acceptable pour un
 *   rattachement de commune) ; identique à `frontend/app/utils/geometry.ts`.
 * - Pré-filtre BBox (rectangle englobant, sur-ensemble du polygone → zéro faux négatif) avant le
 *   ray-casting coûteux.
 * - `resolve` privilégie la comcom dont le POLYGONE contient le point (la plus petite en aire si
 *   plusieurs, cas des frontières internes) ; à défaut (point hors de tout polygone : littoral
 *   au-delà du tracé, frontière, décalage OSM) il retombe sur la comcom dont le polygone est le
 *   plus PROCHE (distance point→arête, `exact:false`) — jamais de rattachement par nom ici.
 *
 * @example
 * const resolver = ZoneResolver.fromComcomApi(rows); // rows = /api/comcoms?populate[department][populate][region]
 * const zone = resolver.resolve(49.1167, -1.0833);    // { comcomId, departmentId, regionId, exact }
 */

export interface BBox { minLat: number; maxLat: number; minLng: number; maxLng: number }
export type Ring = [number, number][]; // [lng, lat] (ordre GeoJSON)

/** Ray-casting sur un anneau GeoJSON ([lng,lat]). point = (lat, lng). */
export function isPointInRing(lat: number, lng: number, vs: Ring): boolean {
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1], xj = vs[j][0], yj = vs[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Point (lat,lng) à l'intérieur d'une géométrie GeoJSON (Polygon/MultiPolygon, anneau extérieur). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPointInGeoJSON(lat: number, lng: number, geometry: any): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return isPointInRing(lat, lng, geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) if (isPointInRing(lat, lng, poly[0])) return true;
  }
  return false;
}

/** Boîte englobante (lat/lng min/max) de l'anneau extérieur. Sur-ensemble exact → pré-filtre sûr. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeGeoJSONBounds(geometry: any): BBox | null {
  if (!geometry) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const scan = (ring: Ring) => { for (const [lng, lat] of ring) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  } };
  if (geometry.type === 'Polygon') scan(geometry.coordinates[0]);
  else if (geometry.type === 'MultiPolygon') for (const poly of geometry.coordinates) scan(poly[0]);
  else return null;
  return Number.isFinite(minLat) ? { minLat, maxLat, minLng, maxLng } : null;
}

function ringArea(coords: Ring): number {
  const n = coords.length; if (n < 3) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += coords[i][0] * coords[j][1] - coords[j][0] * coords[i][1]; }
  return Math.abs(s) / 2;
}

/** Aire (degrés²) de l'anneau extérieur — sert de départage « plus petite = plus spécifique ». */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeGeoJSONArea(geometry: any): number {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') return ringArea(geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((t: number, p: Ring[]) => t + ringArea(p[0]), 0);
  return 0;
}

/** Distance² (planaire, lng mis à l'échelle par cos(lat)) d'un point à un segment [a,b]. */
function pointToSegmentDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

/**
 * Distance² approx. (planaire, lng × cos(lat)) d'un point (lat,lng) à l'arête la plus proche des
 * anneaux extérieurs d'une géométrie. Sert de départage « comcom la plus proche » quand le point
 * est HORS de tout polygone (littoral au-delà du tracé, bord) — meilleur que la bbox.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function distanceToGeoJSON(lat: number, lng: number, geometry: any): number {
  if (!geometry) return Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const px = lng * cosLat, py = lat;
  const rings: Ring[] =
    geometry.type === 'Polygon' ? [geometry.coordinates[0]]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates.map((p: Ring[]) => p[0])
    : [];
  let min = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const d = pointToSegmentDist2(px, py, ring[i][0] * cosLat, ring[i][1], ring[i + 1][0] * cosLat, ring[i + 1][1]);
      if (d < min) min = d;
    }
  }
  return min;
}

export interface ZoneEntry {
  comcomId: number;
  departmentId: number | null;
  regionId: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geometry: any;
  bbox: BBox;
  area: number;
}

export interface ResolvedZone {
  comcomId: number;
  departmentId: number | null;
  regionId: number | null;
  /** true si le point est réellement DANS le polygone ; false = fallback bbox (littoral/bord). */
  exact: boolean;
}

/** Index spatial des comcoms → résolution géographique (lat,lng) → zone. */
export class ZoneResolver {
  constructor(private readonly entries: ZoneEntry[]) {}

  get size(): number { return this.entries.length; }

  resolve(lat: number, lng: number): ResolvedZone | null {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    // 1. Cas exact : le point est DANS un polygone → la plus petite en aire (cas frontières internes).
    const inBbox = this.entries.filter((e) => lat >= e.bbox.minLat && lat <= e.bbox.maxLat && lng >= e.bbox.minLng && lng <= e.bbox.maxLng);
    const inPoly = inBbox.filter((e) => isPointInGeoJSON(lat, lng, e.geometry));
    if (inPoly.length) {
      const pick = inPoly.sort((a, b) => a.area - b.area)[0];
      return { comcomId: pick.comcomId, departmentId: pick.departmentId, regionId: pick.regionId, exact: true };
    }

    // 2. Hors de tout polygone (littoral au-delà du tracé, frontière, léger décalage OSM) :
    //    la comcom dont le POLYGONE est le plus PROCHE (distance point→arête). C'est ce qui
    //    rattache correctement une plage / pointe à SA comcom et non à une voisine dont la bbox
    //    déborde. Recherche bornée à une fenêtre ~15 km (élargie à tout si rien) pour rester rapide.
    const M = 0.15;
    const near = this.entries.filter((e) => lat >= e.bbox.minLat - M && lat <= e.bbox.maxLat + M && lng >= e.bbox.minLng - M && lng <= e.bbox.maxLng + M);
    const pool = near.length ? near : this.entries;
    let best: ZoneEntry | null = null;
    let bestD = Infinity;
    for (const e of pool) {
      const d = distanceToGeoJSON(lat, lng, e.geometry);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best ? { comcomId: best.comcomId, departmentId: best.departmentId, regionId: best.regionId, exact: false } : null;
  }

  /**
   * Construit le résolveur depuis les lignes de `/api/comcoms?populate[department][populate][region]`.
   * Chaque ligne : `{ id, geometry, department: { id, region: { id } } }`. Les comcoms sans géométrie
   * exploitable sont ignorées.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static fromComcomApi(rows: any[]): ZoneResolver {
    const entries: ZoneEntry[] = [];
    for (const c of rows) {
      const bbox = computeGeoJSONBounds(c.geometry);
      if (!bbox) continue;
      entries.push({
        comcomId: c.id,
        departmentId: c.department?.id ?? null,
        regionId: c.department?.region?.id ?? null,
        geometry: c.geometry,
        bbox,
        area: computeGeoJSONArea(c.geometry),
      });
    }
    return new ZoneResolver(entries);
  }
}
