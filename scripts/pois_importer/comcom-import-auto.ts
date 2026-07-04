/**
 * comcom-import-auto.ts — Import NON-INTERACTIF de POIs (run automatique, ex. France entière).
 *
 * Version headless de `comcom-import.ts` (pas d'inquirer) : boucle sur toutes les EPCI de
 * `comcoms-data.json`, scanne Overpass, catégorise via Ollama, importe avec rattachement
 * GÉOGRAPHIQUE (point-in-polygon, cf. utils.importPOI). Conçu pour tourner des jours en détaché
 * sur le serveur, avec reprise sur checkpoint et journal de progression pour le suivi distant.
 *
 * Config par variables d'env :
 * - `STRAPI_BASE_URL`, `STRAPI_API_TOKEN` (Full Access, écriture).
 * - `OLLAMA_BASE_URL` (ex. http://ollama:11434 dans le réseau compose), `OLLAMA_MODEL`.
 * - `IMPORT_DEPARTMENTS` (optionnel) : codes dépt séparés par virgule (ex. "14,50") ; vide = toute la France.
 * - `IMPORT_LIMIT_EPCI` (optionnel) : nombre max d'EPCI à traiter (pour un TEST à petite échelle).
 *
 * Reprise (idempotent) :
 * - Saute une EPCI dont la comcom (matchée par `code` EPCI-xxxxx) a déjà des POI, OU marquée `done`
 *   dans `import-state.json` → pas de re-scan Overpass ni de re-catégorisation Ollama.
 * - Au sein d'une EPCI, saute un lieu déjà présent à ~100 m AVANT de payer Ollama.
 * - `importPOI` dédup en dernier recours (filet de sécurité).
 *
 * Suivi : écrit `import-progress.json` en continu (voir la commande de suivi distant fournie).
 *
 * Usage : STRAPI_API_TOKEN=... OLLAMA_BASE_URL=http://ollama:11434 npx tsx comcom-import-auto.ts
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import {
  OLLAMA_MODEL, STRAPI_BASE_URL, STRAPI_API_TOKEN,
  ComcomsData, POIOutput,
  StrapiClient, extractPlaceDetails, scanEpci, categorizeWithAI, testOllamaConnection,
  loadImportState, updateEpciState,
} from './utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = path.join(__dirname, 'import-progress.json');
const DATA_FILE = path.join(__dirname, 'comcoms-data.json');

const ONLY_DEPTS = (process.env.IMPORT_DEPARTMENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT_EPCI = process.env.IMPORT_LIMIT_EPCI ? parseInt(process.env.IMPORT_LIMIT_EPCI, 10) : Infinity;
const OLLAMA_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

interface Progress {
  startedAt: string;
  lastUpdate: string;
  ollamaModel: string;
  scope: string;
  totalEpcis: number;
  processedEpcis: number;
  skippedEpcis: number;
  currentEpci: string;
  poisImported: number;
  poisRejected: number;
  poisSkippedExisting: number;
  errors: number;
  etaHours: number | null;
  finished: boolean;
}

function writeProgress(p: Progress) {
  p.lastUpdate = nowIso();
  const startMs = Date.parse(p.startedAt);
  const elapsedH = (Date.now() - startMs) / 3_600_000;
  const frac = p.totalEpcis ? p.processedEpcis / p.totalEpcis : 0;
  p.etaHours = frac > 0.001 ? Math.max(0, Math.round((elapsedH / frac - elapsedH) * 10) / 10) : null;
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); } catch { /* disque plein ? on continue */ }
}

async function main() {
  if (!STRAPI_API_TOKEN) {
    console.error('❌ STRAPI_API_TOKEN manquant (écriture requise).');
    process.exit(1);
  }
  if (!fs.existsSync(DATA_FILE)) {
    console.error('❌ comcoms-data.json introuvable. Lancer generate-comcoms-data.ts d\'abord.');
    process.exit(1);
  }

  const data: ComcomsData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const epcis: { epci: ComcomsData['departments'][0]['epci'][0]; dept: ComcomsData['departments'][0] }[] = [];
  for (const dept of data.departments) {
    if (ONLY_DEPTS.length && !ONLY_DEPTS.includes(dept.code)) continue;
    for (const epci of dept.epci) epcis.push({ epci, dept });
  }
  const selected = epcis.slice(0, LIMIT_EPCI);

  console.log(`🌍 Import auto — ${selected.length} EPCI${ONLY_DEPTS.length ? ` (dépts ${ONLY_DEPTS.join(',')})` : ' (France entière)'} — modèle ${OLLAMA_MODEL}`);

  if (!(await testOllamaConnection())) {
    console.error('❌ Ollama inaccessible. Abandon.');
    process.exit(1);
  }

  const strapi = new StrapiClient(STRAPI_BASE_URL, STRAPI_API_TOKEN);
  const state = loadImportState();

  const progress: Progress = {
    startedAt: nowIso(), lastUpdate: nowIso(), ollamaModel: OLLAMA_MODEL,
    scope: ONLY_DEPTS.length ? `dépts ${ONLY_DEPTS.join(',')}` : 'France entière',
    totalEpcis: selected.length, processedEpcis: 0, skippedEpcis: 0, currentEpci: '',
    poisImported: 0, poisRejected: 0, poisSkippedExisting: 0, errors: 0, etaHours: null, finished: false,
  };
  writeProgress(progress);

  for (const { epci, dept } of selected) {
    progress.currentEpci = `${epci.nom} (${dept.nom})`;
    writeProgress(progress);

    try {
      const doneInState = state.departments[dept.code]?.epci?.[epci.code]?.status === 'done';
      if (doneInState || (await strapi.epciHasPois(epci.code))) {
        progress.skippedEpcis++;
        progress.processedEpcis++;
        console.log(`⏭️  ${epci.nom} — déjà peuplée, saut`);
        writeProgress(progress);
        continue;
      }

      const places = await scanEpci(epci, dept.nom, dept.region);
      let imported = 0;

      for (const place of places) {
        try {
          const lat = place.lat as number;
          const lng = place.lng as number;
          const tags = (place.tags || {}) as Record<string, string>;
          const isMuseum = tags.tourism === 'museum' || tags.tourism === 'gallery';

          // Dédup AVANT Ollama (reprise efficace).
          if (await strapi.poiExists(lat, lng, isMuseum ? 'museum' : 'poi')) {
            progress.poisSkippedExisting++;
            continue;
          }

          const details = extractPlaceDetails(place);
          const ai = await categorizeWithAI(place, details);
          if (ai._error || !ai.isPubliclyAccessible) {
            progress.poisRejected++;
            continue;
          }

          const poi: POIOutput = {
            name: place.name as string,
            description: ai.reasoning,
            latitude: lat,
            longitude: lng,
            type: isMuseum ? 'museum' : 'poi',
            categories: ai.categories,
            accessType: ai.accessType,
            radiusMeters: ai.radiusMeters,
            rating: null,
            epci: place._sourceEpci as string,
            department: place._sourceDept as string,
            region: place._sourceRegion as string,
          };
          if (await strapi.importPOI(poi)) {
            imported++;
            progress.poisImported++;
          }
          await sleep(OLLAMA_DELAY_MS);
        } catch (e) {
          progress.errors++;
        }
        writeProgress(progress);
      }

      updateEpciState(dept, epci, imported);
      progress.processedEpcis++;
      console.log(`✅ ${epci.nom} — ${imported} POI importés (total ${progress.poisImported})`);
    } catch (e: any) {
      progress.errors++;
      progress.processedEpcis++; // évite une boucle infinie sur une EPCI qui plante systématiquement
      console.error(`⚠️  ${epci.nom} — erreur EPCI: ${e?.message?.substring(0, 80)}`);
    }
    writeProgress(progress);
  }

  progress.currentEpci = 'TERMINÉ';
  progress.finished = true;
  writeProgress(progress);
  console.log(`\n🎉 Import terminé : ${progress.poisImported} POI importés, ${progress.skippedEpcis} EPCI sautées, ${progress.errors} erreurs.`);
}

main().catch((e) => { console.error('💥 FATAL', e); process.exit(1); });
