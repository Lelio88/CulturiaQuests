/**
 * fix-orphan-comcoms.ts — Migration one-shot (#POI orphelins).
 *
 * Rattache leur `comcom` aux POI qui n'en ont aucune, par POINT-IN-POLYGON géographique
 * (et non par nom d'EPCI comme l'importer principal, dont le name-match exact laissait des
 * orphelins). Pour chaque POI sans comcom : on teste (lat,lng) contre l'anneau extérieur des
 * 1255 polygones de comcom (pré-filtre bbox puis ray-casting) et on rattache la comcom qui le
 * contient (la plus petite en aire si plusieurs, cas des frontières).
 *
 * Lecture seule par défaut (DRY-RUN). Ajouter `--apply` pour écrire en base.
 * Config lue depuis ../../.env.production (STRAPI_BASE_URL + STRAPI_API_TOKEN, jamais loggés).
 *
 * Usage :
 *   cd scripts/pois_importer && npx tsx fix-orphan-comcoms.ts           # dry-run
 *   cd scripts/pois_importer && npx tsx fix-orphan-comcoms.ts --apply   # écrit
 */
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { isPointInGeoJSON, computeGeoJSONBounds, computeGeoJSONArea } from './geo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.production') });

const BASE = process.env.STRAPI_BASE_URL;
const TOKEN = process.env.STRAPI_API_TOKEN || process.env.STRAPI_TOKEN;
const APPLY = process.argv.includes('--apply');

if (!BASE) { console.error('❌ STRAPI_BASE_URL manquant dans .env.production'); process.exit(1); }
if (APPLY && !TOKEN) { console.error('❌ --apply nécessite STRAPI_API_TOKEN (écriture)'); process.exit(1); }
console.log(`Cible : ${BASE}  |  mode : ${APPLY ? '⚠️  APPLY (écriture)' : 'DRY-RUN (lecture seule)'}`);

// Lectures = endpoints publics (pas de token requis). Écritures = token Full Access.
const publicApi = axios.create({ baseURL: BASE, headers: { 'Content-Type': 'application/json' } });
const authApi = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
});

// ===== GÉOMÉTRIE : importée du module partagé geo.ts (DRY, même logique que l'importer) =====

// ===== PAGINATION =====
async function fetchAll(pathStr: string, params: Record<string, string>): Promise<any[]> {
  const out: any[] = [];
  let page = 1, pageCount = 1;
  do {
    const res = await publicApi.get(pathStr, { params: { ...params, 'pagination[page]': String(page), 'pagination[pageSize]': '100' } });
    out.push(...(res.data.data || []));
    pageCount = res.data.meta?.pagination?.pageCount || 1;
    process.stdout.write(`\r  ${pathStr} : page ${page}/${pageCount} (${out.length})   `);
    page++;
  } while (page <= pageCount);
  process.stdout.write('\n');
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n1) POI orphelins (comcom null)…');
  const orphans = await fetchAll('/api/pois', {
    'filters[comcom][id][$null]': 'true', 'fields[0]': 'name', 'fields[1]': 'lat', 'fields[2]': 'lng',
  });

  console.log('2) Comcoms + géométrie (payload volumineux ~19 Mo)…');
  const comcomsRaw = await fetchAll('/api/comcoms', {}); // pas de fields → tous attributs (dont geometry), sans relations
  const comcoms = comcomsRaw
    .map((c) => ({ documentId: c.documentId, id: c.id, name: c.name, geometry: c.geometry, bbox: computeGeoJSONBounds(c.geometry), area: computeGeoJSONArea(c.geometry) }))
    .filter((c) => c.bbox);
  console.log(`   ${comcoms.length}/${comcomsRaw.length} comcoms avec géométrie exploitable.`);

  console.log('3) Rattachement point-in-polygon…');
  const matched: { poi: any; comcom: any; ambiguous: boolean }[] = [];
  const unmatched: { poi: any; reason: string }[] = [];
  for (const o of orphans) {
    if (typeof o.lat !== 'number' || typeof o.lng !== 'number') { unmatched.push({ poi: o, reason: 'coords manquantes' }); continue; }
    const cands = comcoms.filter((c) =>
      o.lat >= c.bbox!.minLat && o.lat <= c.bbox!.maxLat && o.lng >= c.bbox!.minLng && o.lng <= c.bbox!.maxLng &&
      isPointInGeoJSON(o.lat, o.lng, c.geometry));
    if (!cands.length) { unmatched.push({ poi: o, reason: 'hors de toute comcom' }); continue; }
    cands.sort((a, b) => a.area - b.area); // plus petite aire = plus spécifique (frontières)
    matched.push({ poi: o, comcom: cands[0], ambiguous: cands.length > 1 });
  }

  // Rapport
  const byComcom = new Map<string, number>();
  for (const m of matched) byComcom.set(m.comcom.name, (byComcom.get(m.comcom.name) || 0) + 1);
  console.log(`\n=== RÉSULTAT ===`);
  console.log(`Orphelins        : ${orphans.length}`);
  console.log(`Rattachables     : ${matched.length}  (dont ${matched.filter((m) => m.ambiguous).length} sur frontière multi-comcom)`);
  console.log(`Non rattachables : ${unmatched.length}`);
  console.log(`\nRépartition des rattachements (top) :`);
  [...byComcom.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([n, c]) => console.log(`  ${String(c).padStart(4)}  ${n}`));
  if (unmatched.length) {
    console.log(`\nNon rattachables (échantillon 10) :`);
    unmatched.slice(0, 10).forEach((u) => console.log(`  [${u.reason}] ${u.poi.name} (${u.poi.lat},${u.poi.lng})`));
  }

  const report = { generated: new Date().toISOString(), base: BASE, orphans: orphans.length, matched: matched.length, unmatched: unmatched.length,
    assignments: matched.map((m) => ({ poi: m.poi.documentId, name: m.poi.name, comcom: m.comcom.name, comcomDocId: m.comcom.documentId, ambiguous: m.ambiguous })),
    unmatchedList: unmatched.map((u) => ({ name: u.poi.name, lat: u.poi.lat, lng: u.poi.lng, reason: u.reason })) };
  const reportPath = path.join(__dirname, 'orphan-fix-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nRapport détaillé → ${reportPath}`);

  if (!APPLY) { console.log('\nDRY-RUN : aucune écriture. Relancer avec --apply pour appliquer.'); return; }

  console.log(`\n4) ⚠️  APPLY : mise à jour de ${matched.length} POI…`);
  let ok = 0, fail = 0;
  for (const m of matched) {
    try {
      await authApi.put(`/api/pois/${m.poi.documentId}`, { data: { comcom: m.comcom.documentId } });
      ok++;
      if (ok % 25 === 0 || ok === matched.length) process.stdout.write(`\r  ${ok}/${matched.length} rattachés   `);
      await sleep(40); // throttle léger anti-surcharge prod
    } catch (e: any) {
      fail++;
      console.error(`\n  ❌ ${m.poi.name} (${m.poi.documentId}) : ${e.response?.status || ''} ${e.message}`);
      if (fail === 1 && (e.response?.status === 401 || e.response?.status === 403)) {
        console.error('  Token invalide / sans droit d\'écriture → arrêt.'); break;
      }
    }
  }
  console.log(`\n=== APPLY TERMINÉ : ${ok} OK, ${fail} échecs ===`);
})().catch((e) => { console.error('\nERREUR FATALE :', e.response?.data || e.message); process.exit(1); });
