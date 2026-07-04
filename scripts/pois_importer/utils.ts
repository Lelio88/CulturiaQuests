import axios, { AxiosInstance } from 'axios';
import * as path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { ZoneResolver } from './geo';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chargement des variables d'environnement
const localEnvPath = path.resolve(__dirname, '.env');
const rootEnvPath = path.resolve(__dirname, '../../.env');

if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  console.warn(`⚠️  Aucun fichier .env trouvé.`);
}

if (!process.env.STRAPI_API_TOKEN && !process.env.STRAPI_TOKEN) {
  const backendEnvPath = path.resolve(__dirname, '../../backend/.env');
  if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath });
  }
}

// ===== CONFIGURATION =====
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b';
export const STRAPI_BASE_URL = process.env.STRAPI_BASE_URL || 'http://localhost:1337';
export const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || process.env.STRAPI_TOKEN;

export const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';

// Rayons par défaut selon le type OSM (en mètres)
const DEFAULT_RADIUS_BY_TYPE: Record<string, number> = {
  museum: 50,
  gallery: 50,
  castle: 150,
  fort: 120,
  ruins: 100,
  archaeological_site: 150,
  battlefield: 200,
  park: 200,
  garden: 100,
  nature_reserve: 300,
  place_of_worship: 40,
  monument: 30,
  memorial: 30,
  artwork: 20,
  attraction: 60,
  default: 50,
};

export const GAME_CATEGORIES = ['Art', 'Nature', 'Science', 'Histoire', 'Savoir-faire', 'Société'];

// ===== INTERFACES =====
export interface CommuneEntry {
  code: string;
  nom: string;
  lat: number;
  lng: number;
  surface?: number;
}

export interface EpciEntry {
  code: string;
  nom: string;
  communesCount: number;
  communes: CommuneEntry[];
}

export interface DepartmentEntry {
  code: string;
  nom: string;
  region: string;
  epci: EpciEntry[];
}

export interface ComcomsData {
  generated: string;
  departments: DepartmentEntry[];
}

export interface PlaceDetails {
  openingHours: string[] | null;
  baseRadiusMeters: number | null;
}

export interface AIResult {
  categories: string[];
  reasoning: string;
  isPubliclyAccessible: boolean;
  accessType: 'payant' | 'gratuit' | 'inconnu';
  radiusMeters: number;
  _error?: boolean;
}

export interface POIOutput {
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  type: 'museum' | 'poi';
  categories: string[];
  accessType: 'payant' | 'gratuit' | 'inconnu';
  radiusMeters: number;
  rating: number | null;
  epci: string;
  department: string;
  region: string;
}

// ===== STATE MANAGEMENT =====

export interface ImportState {
  last_updated: string;
  departments: Record<string, {
    code: string;
    nom: string;
    status: 'partial' | 'done';
    epci: Record<string, {
      nom: string;
      status: 'done';
      last_scan: string;
      pois_found: number;
    }>;
  }>;
}

export function loadImportState(): ImportState {
  const statePath = path.join(__dirname, 'import-state.json');
  if (fs.existsSync(statePath)) {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  }
  return { last_updated: new Date().toISOString(), departments: {} };
}

export function saveImportState(state: ImportState) {
  const statePath = path.join(__dirname, 'import-state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function updateEpciState(dept: DepartmentEntry, epci: EpciEntry, poisCount: number) {
  const state = loadImportState();
  if (!state.departments[dept.code]) {
    state.departments[dept.code] = { code: dept.code, nom: dept.nom, status: 'partial', epci: {} };
  }
  state.departments[dept.code].epci[epci.code] = {
    nom: epci.nom, status: 'done', last_scan: new Date().toISOString(), pois_found: poisCount
  };
  const doneCount = Object.keys(state.departments[dept.code].epci).length;
  if (doneCount === dept.epci.length) state.departments[dept.code].status = 'done';
  state.last_updated = new Date().toISOString();
  saveImportState(state);
}

// ===== UTILITAIRES GÉOGRAPHIQUES =====

export function computeAreaKm2(communes: CommuneEntry[]): number {
  if (!communes || communes.length === 0) return 0;
  let totalHectares = 0;
  for (const c of communes) if (c.surface) totalHectares += c.surface;
  return Math.round(totalHectares / 100);
}

function calculateCommuneRadius(surfaceHectares?: number): number {
  if (!surfaceHectares) return 2000;
  const surfaceM2 = surfaceHectares * 10000;
  const radius = Math.sqrt(surfaceM2 / Math.PI);
  return Math.max(1500, Math.min(Math.round(radius), 6000));
}

// ===== CLIENT STRAPI =====

export class StrapiClient {
  private client: AxiosInstance;
  private tagCache = new Map<string, number>();
  private zoneCache = new Map<string, number>();
  // Résolveur géographique (point-in-polygon) chargé paresseusement au 1er import.
  private zoneResolver: ZoneResolver | null = null;

  constructor(baseURL: string, token: string) {
    this.client = axios.create({
      baseURL,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
  }

  private async findOne(collection: string, params: Record<string, string>) {
    try {
      const res = await this.client.get(`/api/${collection}`, { params });
      return res.data.data[0] || null;
    } catch { return null; }
  }

  private async create(collection: string, data: Record<string, unknown>) {
    const res = await this.client.post(`/api/${collection}`, { data });
    return res.data.data;
  }

  private async getOrCreateTag(tagName: string): Promise<number | null> {
    if (this.tagCache.has(tagName)) return this.tagCache.get(tagName)!;
    const existing = await this.findOne('tags', { 'filters[name][$eq]': tagName });
    if (existing) { this.tagCache.set(tagName, existing.id); return existing.id; }
    try {
      const created = await this.create('tags', { name: tagName, publishedAt: new Date().toISOString() });
      this.tagCache.set(tagName, created.id);
      return created.id;
    } catch { return null; }
  }

  async findZoneId(collection: string, name: string): Promise<number | null> {
    if (!name) return null;
    const cacheKey = `${collection}:${name}`;
    if (this.zoneCache.has(cacheKey)) return this.zoneCache.get(cacheKey)!;
    const existing = await this.findOne(collection, { 'filters[name][$eq]': name });
    if (existing) { this.zoneCache.set(cacheKey, existing.id); return existing.id; }
    return null;
  }

  /**
   * Charge (une seule fois) le résolveur géographique : toutes les comcoms avec leur géométrie +
   * la chaîne department→region, pour rattacher un POI par POINT-IN-POLYGON plutôt que par nom.
   */
  async ensureZoneResolver(): Promise<ZoneResolver> {
    if (this.zoneResolver) return this.zoneResolver;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = [];
    let page = 1;
    let pageCount = 1;
    do {
      const res = await this.client.get('/api/comcoms', {
        params: {
          // On NE restreint PAS les champs de la comcom → sa `geometry` (json) est renvoyée.
          'populate[department][fields][0]': 'name',
          'populate[department][populate][region][fields][0]': 'name',
          'pagination[page]': page,
          'pagination[pageSize]': 100,
        },
      });
      rows.push(...(res.data.data || []));
      pageCount = res.data.meta?.pagination?.pageCount || 1;
      page++;
    } while (page <= pageCount);
    this.zoneResolver = ZoneResolver.fromComcomApi(rows);
    console.log(`  🗺️  Résolveur de zones : ${this.zoneResolver.size} comcoms chargées (rattachement géographique).`);
    return this.zoneResolver;
  }

  /**
   * Une EPCI est-elle DÉJÀ importée ? Match la comcom par son `code` (EPCI-xxxxx, unique et
   * identique côté geo.api.gouv.fr et Strapi — fiable, contrairement au nom), puis compte ses POI.
   * Permet à un run automatique de sauter les territoires déjà peuplés SANS payer Overpass ni Ollama.
   */
  async epciHasPois(epciCode: string): Promise<boolean> {
    try {
      // Les comcoms Strapi ont un code PRÉFIXÉ "EPCI-<siren>", alors que geo.api.gouv.fr
      // (comcoms-data.json) fournit le SIREN BRUT (ex. "200071751"). On normalise pour que le
      // match fonctionne — sinon aucune EPCI n'est jamais reconnue comme déjà faite.
      const code = epciCode.startsWith('EPCI-') ? epciCode : `EPCI-${epciCode}`;
      const comcom = await this.findOne('comcoms', { 'filters[code][$eq]': code });
      if (!comcom) return false;
      const res = await this.client.get('/api/pois', {
        params: { 'filters[comcom][id][$eq]': comcom.id, 'pagination[pageSize]': 1, 'pagination[withCount]': true },
      });
      return (res.data?.meta?.pagination?.total || 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Un POI/musée existe-t-il déjà à ~100 m de ces coordonnées ? Même contrôle que la dédup interne
   * d'`importPOI`, exposé pour sauter la catégorisation Ollama (coûteuse) d'un lieu déjà en base —
   * crucial pour la reprise efficace après un crash en cours d'EPCI.
   */
  async poiExists(lat: number, lng: number, type: 'museum' | 'poi'): Promise<boolean> {
    const collection = type === 'museum' ? 'museums' : 'pois';
    try {
      const res = await this.client.get(`/api/${collection}`, {
        params: {
          'filters[lat][$gte]': lat - 0.001, 'filters[lat][$lte]': lat + 0.001,
          'filters[lng][$gte]': lng - 0.001, 'filters[lng][$lte]': lng + 0.001,
          'fields[0]': 'lat',
        },
      });
      return (res.data?.data?.length || 0) > 0;
    } catch {
      return false;
    }
  }

  async importPOI(poi: POIOutput): Promise<boolean> {
    const collection = poi.type === 'museum' ? 'museums' : 'pois';
    let duplicate = null;
    try {
      // Chercher tous les POIs proches (~100m) par proximité géographique
      const latMin = poi.latitude - 0.001;
      const latMax = poi.latitude + 0.001;
      const lngMin = poi.longitude - 0.001;
      const lngMax = poi.longitude + 0.001;

      const res = await this.client.get(`/api/${collection}`, {
        params: {
          'filters[lat][$gte]': latMin,
          'filters[lat][$lte]': latMax,
          'filters[lng][$gte]': lngMin,
          'filters[lng][$lte]': lngMax,
          'fields[0]': 'lat', 'fields[1]': 'lng',
        }
      });
      duplicate = res.data.data.length > 0 ? res.data.data[0] : null;
    } catch { /* proceed */ }

    if (duplicate) return false;

    const tagIds: number[] = [];
    for (const cat of poi.categories) {
      const id = await this.getOrCreateTag(cat);
      if (id) tagIds.push(id);
    }

    // Rattachement GÉOGRAPHIQUE (point-in-polygon) : la comcom qui contient réellement le POI, d'où
    // l'on dérive département + région via les relations. Remplace l'ancien rattachement PAR NOM
    // (findZoneId $eq), qui laissait des orphelins (nom EPCI ≠ comcom.name) et de fausses
    // assignations (le scan Overpass par BBox capte des POI d'EPCI voisines). Fallback nom
    // uniquement si le point tombe hors de TOUTE bbox de comcom (offshore/coordonnées aberrantes).
    const zone = (await this.ensureZoneResolver()).resolve(poi.latitude, poi.longitude);
    let regionId: number | null;
    let deptId: number | null;
    let comcomId: number | null;
    if (zone) {
      comcomId = zone.comcomId;
      deptId = zone.departmentId;
      regionId = zone.regionId;
    } else {
      regionId = await this.findZoneId('regions', poi.region);
      deptId = await this.findZoneId('departments', poi.department);
      comcomId = await this.findZoneId('comcoms', poi.epci);
    }

    const payload: Record<string, unknown> = {
      name: poi.name,
      lat: poi.latitude,
      lng: poi.longitude,
    };

    if (regionId) payload.region = regionId;
    if (deptId) payload.department = deptId;
    if (comcomId) payload.comcom = comcomId;

    if (poi.type === 'museum') {
      payload.radius = poi.radiusMeters;
      if (tagIds.length) payload.tags = { connect: tagIds };
    }

    await this.create(collection, payload);
    return true;
  }
}

// ===== OVERPASS (OPENSTREETMAP) SERVICES =====

/** Construit la requête Overpass pour une commune (rayon autour du centre) */
function buildOverpassQuery(lat: number, lng: number, radiusM: number): string {
  return `[out:json][timeout:30];
(
  nwr["tourism"~"museum|attraction|gallery|artwork"](around:${radiusM},${lat},${lng});
  nwr["historic"](around:${radiusM},${lat},${lng});
  nwr["leisure"~"park|garden|nature_reserve"](around:${radiusM},${lat},${lng});
  nwr["amenity"="place_of_worship"](around:${radiusM},${lat},${lng});
);
out center bb;`;
}

/** Détermine le type principal OSM d'un élément pour le rayon par défaut */
function getOsmMainType(tags: Record<string, string>): string {
  if (tags.tourism) return tags.tourism;
  if (tags.historic) return tags.historic;
  if (tags.leisure) return tags.leisure;
  if (tags.amenity) return tags.amenity;
  return 'default';
}

/** Calcule le rayon à partir de la géométrie OSM (bounds) ou utilise le rayon par défaut */
function calculateRadiusFromOsm(element: Record<string, unknown>): number {
  const tags = (element.tags || {}) as Record<string, string>;
  const defaultRadius = DEFAULT_RADIUS_BY_TYPE[getOsmMainType(tags)] || DEFAULT_RADIUS_BY_TYPE.default;

  // Pour les ways/relations, Overpass retourne bounds si disponible
  const bounds = element.bounds as { minlat: number; maxlat: number; minlon: number; maxlon: number } | undefined;
  if (bounds) {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(bounds.maxlat - bounds.minlat);
    const dLng = toRad(bounds.maxlon - bounds.minlon);
    const midLat = toRad((bounds.maxlat + bounds.minlat) / 2);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(midLat) * Math.cos(midLat) * Math.sin(dLng / 2) ** 2;
    const diameter = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const radius = Math.round(diameter / 2);
    if (radius > 10) return Math.max(20, Math.min(radius, 500));
  }

  return defaultRadius;
}

/** Extrait les détails d'un lieu directement depuis les tags OSM (pas d'appel réseau) */
export function extractPlaceDetails(place: Record<string, unknown>): PlaceDetails {
  const tags = (place.tags || {}) as Record<string, string>;
  const openingHours = tags.opening_hours ? [tags.opening_hours] : null;
  const baseRadiusMeters = calculateRadiusFromOsm(place);
  return { openingHours, baseRadiusMeters };
}

/** Génère une description lisible des tags OSM pour le prompt IA */
function formatOsmTags(tags: Record<string, string>): string {
  const relevant = ['tourism', 'historic', 'leisure', 'amenity', 'heritage', 'wikipedia', 'wikidata', 'denomination', 'religion', 'building'];
  return relevant
    .filter(k => tags[k])
    .map(k => `${k}=${tags[k]}`)
    .join(', ') || 'N/A';
}

/** Construit une requête Overpass avec un filtre BBox couvrant toutes les communes de l'EPCI */
function buildOverpassBBoxQuery(communes: CommuneEntry[]): string {
  const margin = 0.02; // ~2km de marge pour couvrir les POIs en périphérie
  const lats = communes.map(c => c.lat);
  const lngs = communes.map(c => c.lng);
  const minLat = Math.min(...lats) - margin;
  const maxLat = Math.max(...lats) + margin;
  const minLng = Math.min(...lngs) - margin;
  const maxLng = Math.max(...lngs) + margin;

  return `[out:json][timeout:60][bbox:${minLat},${minLng},${maxLat},${maxLng}];
(
  nwr["tourism"~"museum|attraction|gallery|artwork"];
  nwr["historic"];
  nwr["leisure"~"park|garden|nature_reserve"];
  nwr["amenity"="place_of_worship"];
);
out center bb;`;
}

export async function scanEpci(epci: EpciEntry, deptNom: string, regionNom: string): Promise<Record<string, unknown>[]> {
  const seen = new Map<string, Record<string, unknown>>();

  console.log(`  📍 Scan BBox unique pour ${epci.communes.length} communes…`);
  const query = buildOverpassBBoxQuery(epci.communes);

  // Overpass rate-limite de façon INTERMITTENTE (429, mais aussi 406/403 selon l'instance/charge) ;
  // on retente donc sur tous ces statuts + erreurs réseau, avec un backoff croissant, et on envoie
  // un User-Agent descriptif (étiquette Overpass, réduit les blocages sur un run long de 1255 EPCI).
  const RETRY_STATUSES = new Set([403, 406, 429, 502, 503, 504]);
  const BACKOFF = [15000, 30000, 60000, 90000, 120000];
  const MAX_ATTEMPTS = BACKOFF.length + 1;
  let attempts = 0;
  let res = null;
  while (attempts < MAX_ATTEMPTS) {
    try {
      res = await axios.post(OVERPASS_API_URL, `data=${encodeURIComponent(query)}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'CulturiaQuests-POI-Importer/1.0 (+https://culturiaquests.app)',
        },
        timeout: 120000,
      });
      break;
    } catch (e: any) {
      attempts++;
      const status = e.response?.status;
      const retryable = RETRY_STATUSES.has(status) || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED';
      if (retryable && attempts < MAX_ATTEMPTS) {
        const wait = BACKOFF[attempts - 1] || 120000;
        console.warn(`  ⏳ Overpass ${status || e.code}, retry ${attempts}/${MAX_ATTEMPTS - 1} dans ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      console.warn(`  ⚠️ Overpass erreur (${epci.nom}): ${e.message?.substring(0, 80)}`);
      break;
    }
  }

  // Échec Overpass après tous les retries : on LÈVE (au lieu de retourner []) pour que l'appelant
  // NE marque PAS l'EPCI comme faite — sinon un échec transitoire la retirerait à jamais du run.
  if (!res) {
    throw new Error(`Overpass indisponible pour ${epci.nom} (échec après retries)`);
  }

  if (res?.data?.elements) {
    for (const el of res.data.elements as Record<string, unknown>[]) {
      const osmId = `${el.type}/${el.id}`;
      if (seen.has(osmId)) continue;

      const tags = (el.tags || {}) as Record<string, string>;
      if (!tags.name) continue; // Ignorer les éléments sans nom

      // Coordonnées : directes pour les nodes, center pour les ways/relations.
      // `??` et `Number.isFinite` (pas `||`/`!lng`) : le méridien de Greenwich (lng=0) traverse
      // la France → `0 || center.lon` basculait à tort sur center (undefined pour un node) et
      // `!lng` rejetait les POI à lng=0. On garde donc explicitement la valeur 0.
      const lat = (el.lat as number) ?? (el.center as { lat: number })?.lat;
      const lng = (el.lon as number) ?? (el.center as { lon: number })?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      seen.set(osmId, {
        osm_id: osmId,
        name: tags.name,
        tags,
        lat,
        lng,
        bounds: el.bounds,
        _sourceEpci: epci.nom,
        _sourceDept: deptNom,
        _sourceRegion: regionNom,
      });
    }
  }

  console.log(`  ✅ ${seen.size} POIs trouvés pour ${epci.nom}`);
  return [...seen.values()];
}

// ===== OLLAMA SERVICES =====

/** Test rapide de la connectivité Ollama — à appeler avant de lancer l'analyse en masse */
export async function testOllamaConnection(): Promise<boolean> {
  try {
    const res = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    const models = res.data.models || [];
    const modelNames = models.map((m: { name: string }) => m.name);
    const hasModel = modelNames.some((n: string) => n === OLLAMA_MODEL || n.startsWith(OLLAMA_MODEL.split(':')[0]));

    if (!hasModel) {
      console.error(`❌ Modèle "${OLLAMA_MODEL}" non trouvé dans Ollama.`);
      console.error(`   Modèles disponibles: ${modelNames.join(', ') || '(aucun)'}`);
      console.error(`   Lancez: docker exec -it ollama ollama pull ${OLLAMA_MODEL}`);
      return false;
    }

    console.log(`✅ Ollama connecté (modèle: ${OLLAMA_MODEL})`);
    return true;
  } catch (e: any) {
    console.error(`❌ Ollama inaccessible: ${e.message}`);
    console.error(`   Vérifiez que le service Ollama tourne sur ${OLLAMA_BASE_URL}`);
    return false;
  }
}

/**
 * Neutralise une chaîne issue d'OSM (texte libre, éditable publiquement) avant interpolation
 * dans un prompt LLM : retire sauts de ligne et chevrons (pour ne pas casser le wrapping
 * <lieu>...</lieu> ni injecter d'instructions), compacte les espaces, tronque. #19
 */
function sanitizeForPrompt(value: unknown, maxLen = 200): string {
  if (value == null) return '';
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

const ACCESS_TYPES: AIResult['accessType'][] = ['gratuit', 'payant', 'inconnu'];
const DEFAULT_RADIUS_METERS = 50;
const MIN_RADIUS_METERS = 10;
const MAX_RADIUS_METERS = 2000;

/**
 * Valide et normalise la sortie JSON du LLM (non fiable) contre le contrat AIResult AVANT import. #70
 *
 * Le modèle peut renvoyer des catégories hors-liste, un radiusMeters non numérique/aberrant, un
 * accessType inattendu ou des champs manquants. On filtre/contraint chaque champ pour ne jamais
 * propager de données invalides dans la base (tags fantaisistes, rayon corrompu) :
 * - categories : uniquement les valeurs de GAME_CATEGORIES (1-2 max) ;
 * - accessType : enum {gratuit, payant, inconnu}, défaut 'inconnu' ;
 * - radiusMeters : entier fini borné [MIN, MAX], défaut 50 ;
 * - isPubliclyAccessible : true strict (toute autre valeur → rejet, côté sûr).
 */
export function normalizeAIResult(raw: unknown, placeName = ''): AIResult {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};

  const rawCategories = Array.isArray(obj.categories) ? obj.categories : [];
  const categories = rawCategories
    .filter((c): c is string => typeof c === 'string' && GAME_CATEGORIES.includes(c))
    .slice(0, 2);
  if (categories.length === 0 && rawCategories.length > 0) {
    console.warn(`  ⚠️ Catégories LLM hors-liste ignorées [${placeName}]: ${JSON.stringify(rawCategories).slice(0, 80)}`);
  }

  const accessType = ACCESS_TYPES.includes(obj.accessType as AIResult['accessType'])
    ? (obj.accessType as AIResult['accessType'])
    : 'inconnu';

  const r = Number(obj.radiusMeters);
  const radiusMeters = Number.isFinite(r)
    ? Math.min(MAX_RADIUS_METERS, Math.max(MIN_RADIUS_METERS, Math.round(r)))
    : DEFAULT_RADIUS_METERS;

  return {
    categories,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
    isPubliclyAccessible: obj.isPubliclyAccessible === true,
    accessType,
    radiusMeters,
  };
}

export async function categorizeWithAI(place: Record<string, unknown>, details: PlaceDetails): Promise<AIResult> {
  const tags = (place.tags || {}) as Record<string, string>;

  // Sanitisation anti prompt-injection des champs OSM (texte libre, éditable publiquement). #19
  const safeName = sanitizeForPrompt(place.name);
  const safeTags = sanitizeForPrompt(formatOsmTags(tags));
  const rawAddress = tags['addr:street']
    ? `${tags['addr:housenumber'] || ''} ${tags['addr:street']}, ${tags['addr:city'] || ''}`.trim()
    : 'N/A';
  const safeAddress = sanitizeForPrompt(rawAddress);
  const safeHours = details.openingHours ? sanitizeForPrompt(details.openingHours.join(' | ')) : 'Non spécifiés';

  const prompt = `Analyse ce lieu pour un jeu RPG culturel géolocalisé.

Lieu: <lieu>${safeName}</lieu> (${safeTags})
Adresse: ${safeAddress}
Département: ${place._sourceDept}
Horaires: ${safeHours}
Rayon estimé: ${details.baseRadiusMeters || 'N/A'} m

Tes missions :
1. Catégories: Choisis 1-2 parmi [${GAME_CATEGORIES.join(', ')}].
   - Art: musées d'art, galeries, street art
   - Nature: jardins, parcs remarquables, aquariums
   - Science: musées, observatoires
   - Histoire: monuments, châteaux, sites historiques, mémoriaux
   - Savoir-faire: musées artisanat, industrie
   - Société: lieux de culte historiques, bibliothèques, centres culturels

2. Accessible: Est-ce un lieu d'intérêt public qui mérite d'être visité ? (true/false)
   - OUI pour : Tout ce qui est culturel, historique, naturel ou touristique.
   - OUI même si : C'est une église, un petit parc, un point de vue ou si c'est frontalier.
   - NON pour : Écoles, Hôpitaux, Bureaux, Zones industrielles, Parkings, Hôtels/Restaurants sans intérêt historique majeur.

3. Accès: "gratuit" | "payant" | "inconnu"

4. Rayon: Rayon d'interaction en mètres.

Réponds UNIQUEMENT avec du JSON valide:
{
  "categories": ["string"],
  "reasoning": "courte explication du choix",
  "isPubliclyAccessible": boolean,
  "accessType": "gratuit"|"payant"|"inconnu",
  "radiusMeters": number
}`;

  let attempts = 0;
  let delay = 1000;

  while (attempts < 5) {
    try {
      const res = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
        model: OLLAMA_MODEL,
        prompt,
        format: 'json',
        stream: false,
        options: { temperature: 0.3 },
      });

      // La réponse du LLM est non fiable : on valide/normalise contre AIResult avant tout usage. #70
      const data = normalizeAIResult(JSON.parse(res.data.response), place.name as string);

      if (!data.isPubliclyAccessible) {
        console.error(`❌ REJET [${place.name}]: ${data.reasoning}`);
      }
      return data;
    } catch (e: any) {
      attempts++;

      if (attempts < 5) {
        console.warn(`  ⚠️ Ollama retry ${attempts}/5 [${(place.name as string)?.substring(0, 30)}]: ${e.message?.substring(0, 60)}`);
      } else {
        console.error(`\n💥 ERREUR FATALE OLLAMA sur [${place.name}]:`);
        console.error(`   Message: ${e.message}`);
        if (e.response) console.error(`   Status: ${e.response.status}`);
      }

      const httpStatus = e.response?.status;
      const isRetryable =
        httpStatus === 500 ||
        httpStatus === 502 ||
        httpStatus === 503 ||
        e.message?.includes('ECONNRESET') ||
        e.message?.includes('ETIMEDOUT') ||
        e.message?.includes('ECONNREFUSED') ||
        e.message?.includes('network') ||
        e.code === 'ECONNRESET' ||
        e.code === 'ETIMEDOUT' ||
        e instanceof SyntaxError;
      if (isRetryable && attempts < 5) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      break;
    }
  }

  return { categories: [], reasoning: 'Erreur technique Ollama (voir logs)', isPubliclyAccessible: false, accessType: 'inconnu' as const, radiusMeters: 50, _error: true };
}
