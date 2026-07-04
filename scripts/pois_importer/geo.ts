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
 *   plusieurs, cas des frontières) ; à défaut (point hors de tout polygone : littoral au-delà du
 *   tracé, offshore) il retombe sur la plus petite comcom dont la BBox contient le point
 *   (`exact:false`) — jamais de rattachement par nom ici.
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
    const inBbox = this.entries.filter((e) => lat >= e.bbox.minLat && lat <= e.bbox.maxLat && lng >= e.bbox.minLng && lng <= e.bbox.maxLng);
    if (!inBbox.length) return null;
    const inPoly = inBbox.filter((e) => isPointInGeoJSON(lat, lng, e.geometry));
    const exact = inPoly.length > 0;
    const pick = (exact ? inPoly : inBbox).sort((a, b) => a.area - b.area)[0];
    return { comcomId: pick.comcomId, departmentId: pick.departmentId, regionId: pick.regionId, exact };
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
