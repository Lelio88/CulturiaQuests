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
} from './utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROGRESS_FILE = path.join(__dirname, 'import-progress.json');
const DATA_FILE = path.join(__dirname, 'comcoms-data.json');
const IN_PROGRESS_FILE = path.join(__dirname, '.import-inprogress');

const ONLY_DEPTS = (process.env.IMPORT_DEPARTMENTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT_EPCI = process.env.IMPORT_LIMIT_EPCI ? parseInt(process.env.IMPORT_LIMIT_EPCI, 10) : Infinity;
const OLLAMA_DELAY_MS = 500;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
const HEARTBEAT_EVERY = 25; // message d'avancement toutes les N EPCI traitées

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

/** Poste un message Discord via webhook (no-op si non configuré ; n'interrompt JAMAIS l'import). */
async function postDiscord(content: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    });
  } catch { /* Discord indisponible → on ignore, l'import continue */ }
}

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
  poisRejectedNotPublic: number; // sous-total : rejetés car jugés non accessibles au public (IA)
  poisRejectedAiError: number;   // sous-total : rejetés car l'IA a échoué (timeout / parse invalide)
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

  // Comptes pour les notifications Discord : total EPCI par dépt / région, et compteur « fait » vivant
  // → on en déduit le nombre restant dans le dépt, la région et la France à chaque EPCI.
  const totalByDept = new Map<string, number>();
  const totalByRegion = new Map<string, number>();
  for (const { dept } of selected) {
    totalByDept.set(dept.code, (totalByDept.get(dept.code) || 0) + 1);
    totalByRegion.set(dept.region, (totalByRegion.get(dept.region) || 0) + 1);
  }
  const doneByDept = new Map<string, number>();
  const doneByRegion = new Map<string, number>();
  let doneTotal = 0;
  const markDone = (dept: { code: string; region: string }) => {
    doneByDept.set(dept.code, (doneByDept.get(dept.code) || 0) + 1);
    doneByRegion.set(dept.region, (doneByRegion.get(dept.region) || 0) + 1);
    doneTotal++;
  };

  // Ligne « Restant » (dépt / région / France) recalculée à la volée APRÈS markDone. DRY : réutilisée
  // par chaque notification d'EPCI (POI ajoutés, 0 POI, erreur). `remFrance = selected.length - doneTotal`
  // décrémente de 1 par EPCI PARCOURUE ; auparavant le message n'était posté que si `imported > 0`,
  // donc les EPCI silencieuses (sautées / 0 POI) décrémentaient sans jamais s'afficher → sauts
  // inexpliqués du compteur (ex. 1150 → 1148, le 1149 « manquant » était une itération muette).
  const remainingLine = (d: { code: string; region: string }): string => {
    const remDept = (totalByDept.get(d.code) || 0) - (doneByDept.get(d.code) || 0);
    const remRegion = (totalByRegion.get(d.region) || 0) - (doneByRegion.get(d.region) || 0);
    const remFrance = selected.length - doneTotal;
    return `⏳ Restant : **${remDept}** EPCI dans le dépt · **${remRegion}** dans la région · **${remFrance}** en France`;
  };

  // EPCI déjà peuplées (sautées SANS scan) : on ne poste PAS un message par EPCI — une reprise
  // re-parcourt des centaines d'EPCI déjà faites en quelques secondes (429 Discord garanti). On
  // accumule (nom + nb de POI déjà en base) et on FLUSH un digest par lots AVANT le prochain
  // message réel : transparence (quelle EPCI, combien de POI) sans flood. Plafonné à MAX_DIGEST_LOTS
  // lots détaillés + 1 ligne de résumé pour le reste → borne le nombre de messages sur une grosse reprise.
  const pendingSkipped: { nom: string; count: number }[] = [];
  const SKIP_DIGEST_CHUNK = 20;   // EPCI listées par message (marge sous la limite 2000 car. Discord)
  const MAX_DIGEST_LOTS = 10;     // lots détaillés max → au plus 11 messages, même pour 1000 sauts
  const flushSkippedDigest = async (): Promise<void> => {
    if (pendingSkipped.length === 0) return;
    const items = pendingSkipped.splice(0); // vide la file d'un coup
    const detailed = items.slice(0, MAX_DIGEST_LOTS * SKIP_DIGEST_CHUNK);
    const rest = items.slice(MAX_DIGEST_LOTS * SKIP_DIGEST_CHUNK);
    const nbLots = Math.ceil(detailed.length / SKIP_DIGEST_CHUNK);
    for (let i = 0; i < nbLots; i++) {
      const chunk = detailed.slice(i * SKIP_DIGEST_CHUNK, (i + 1) * SKIP_DIGEST_CHUNK);
      const sumPoi = chunk.reduce((s, e) => s + e.count, 0);
      const lignes = chunk.map((e) => `• ${e.nom} — ${e.count} POI`).join('\n');
      const isLast = i === nbLots - 1 && rest.length === 0;
      const footer = isLast ? `\n⏳ Restant : **${selected.length - doneTotal}** EPCI en France` : '';
      await postDiscord(`⏭️ **Déjà en base, sautées** (lot ${i + 1}/${nbLots}) — ${sumPoi} POI :\n${lignes}${footer}`);
      await sleep(400); // respire entre les lots
    }
    if (rest.length > 0) {
      const restPoi = rest.reduce((s, e) => s + e.count, 0);
      await postDiscord(
        `⏭️ **+ ${rest.length} autres EPCI** déjà en base (${restPoi} POI, non listées)\n` +
        `⏳ Restant : **${selected.length - doneTotal}** EPCI en France`,
      );
    }
  };

  console.log(`🌍 Import auto — ${selected.length} EPCI${ONLY_DEPTS.length ? ` (dépts ${ONLY_DEPTS.join(',')})` : ' (France entière)'} — modèle ${OLLAMA_MODEL}`);

  if (!(await testOllamaConnection())) {
    console.error('❌ Ollama inaccessible. Abandon.');
    process.exit(1);
  }

  await postDiscord(`🚀 **Import CulturiaQuests démarré** — ${selected.length} EPCI (${ONLY_DEPTS.length ? `dépts ${ONLY_DEPTS.join(',')}` : 'France entière'}) · modèle ${OLLAMA_MODEL}.`);

  const strapi = new StrapiClient(STRAPI_BASE_URL, STRAPI_API_TOKEN);
  // Reprise mid-EPCI : l'EPCI marquée .in-progress au dernier crash est re-traitée (sa fin est
  // complétée grâce à la dédup par POI) au lieu d'être sautée par epciHasPois.
  let forceEpciCode = '';
  try { forceEpciCode = fs.readFileSync(IN_PROGRESS_FILE, 'utf8').trim(); } catch { /* pas de reprise en cours */ }

  const progress: Progress = {
    startedAt: nowIso(), lastUpdate: nowIso(), ollamaModel: OLLAMA_MODEL,
    scope: ONLY_DEPTS.length ? `dépts ${ONLY_DEPTS.join(',')}` : 'France entière',
    totalEpcis: selected.length, processedEpcis: 0, skippedEpcis: 0, currentEpci: '',
    poisImported: 0, poisRejected: 0, poisRejectedNotPublic: 0, poisRejectedAiError: 0,
    poisSkippedExisting: 0, errors: 0, etaHours: null, finished: false,
  };
  writeProgress(progress);

  for (const { epci, dept } of selected) {
    progress.currentEpci = `${epci.nom} (${dept.nom})`;
    writeProgress(progress);

    try {
      // Saut si la comcom (matchée par code EPCI-xxxxx) a déjà des POI — SAUF l'EPCI interrompue au
      // dernier crash (forceEpciCode), qu'on re-traite pour compléter sa fin.
      const existingCount = epci.code === forceEpciCode ? 0 : await strapi.epciPoiCount(epci.code);
      if (existingCount > 0) {
        progress.skippedEpcis++;
        progress.processedEpcis++;
        markDone(dept);
        pendingSkipped.push({ nom: epci.nom, count: existingCount }); // digest groupé (anti-flood)
        console.log(`⏭️  ${epci.nom} — déjà peuplée (${existingCount} POI), saut`);
        writeProgress(progress);
        continue;
      }
      fs.writeFileSync(IN_PROGRESS_FILE, epci.code); // marqueur de reprise (nettoyé en fin d'EPCI)

      const places = await scanEpci(epci, dept.nom, dept.region);
      let imported = 0;
      // Compteurs LOCAUX à l'EPCI, pour expliquer un « 0 POI » sur Discord (voir le bloc de
      // notification plus bas). Les compteurs globaux progress.* restent cumulés séparément.
      const scanned = places.length;
      let epciDedup = 0;      // lieux déjà présents en base (~100 m)
      let epciNotPublic = 0;  // rejetés par l'IA : jugés non accessibles au public
      let epciAiError = 0;    // l'IA (Ollama) a échoué / renvoyé une réponse invalide
      let epciErrors = 0;     // exception d'import dans la boucle

      for (const place of places) {
        try {
          const lat = place.lat as number;
          const lng = place.lng as number;
          const tags = (place.tags || {}) as Record<string, string>;
          const isMuseum = tags.tourism === 'museum' || tags.tourism === 'gallery';

          // Dédup AVANT Ollama (reprise efficace).
          if (await strapi.poiExists(lat, lng, isMuseum ? 'museum' : 'poi')) {
            progress.poisSkippedExisting++;
            epciDedup++;
            continue;
          }

          const details = extractPlaceDetails(place);
          const ai = await categorizeWithAI(place, details);
          // Distinguer les deux causes de rejet pour le rapport Discord : échec technique de l'IA
          // (timeout / parse) vs décision « lieu non accessible au public ». Les deux comptent comme
          // rejet global (progress.poisRejected) mais sont rapportés séparément par EPCI.
          if (ai._error) {
            progress.poisRejected++;
            progress.poisRejectedAiError++;
            epciAiError++;
            continue;
          }
          if (!ai.isPubliclyAccessible) {
            progress.poisRejected++;
            progress.poisRejectedNotPublic++;
            epciNotPublic++;
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
          epciErrors++;
          // Log explicite : sur un run détaché de plusieurs jours, un compteur d'erreurs muet
          // est indiagnostiquable (cf. le catch EPCI qui loggue déjà).
          console.error(`  ⚠️ échec import POI « ${(place as { name?: string })?.name ?? '?'} » :`, (e as Error)?.message ?? e);
        }
        writeProgress(progress);
      }

      try { fs.unlinkSync(IN_PROGRESS_FILE); } catch { /* déjà absent */ }
      progress.processedEpcis++;
      markDone(dept);
      console.log(`✅ ${epci.nom} — ${imported} POI importés (total ${progress.poisImported})`);

      // Notification par EPCI SCANNÉE — qu'elle ajoute des POI ou non. Sortir ce message du garde
      // « imported > 0 » supprime les sauts inexpliqués du compteur, et le cas « 0 POI » explique
      // désormais POURQUOI rien n'a été retenu (dédup, IA non-public, erreur IA, erreur d'import).
      if (imported > 0) {
        await flushSkippedDigest();
        await postDiscord(
          `✅ **${epci.nom}** — ${imported} POI ajoutés\n` +
          `📍 ${dept.nom} · ${dept.region}\n` +
          remainingLine(dept),
        );
      } else {
        const reasons: string[] = [];
        if (epciDedup > 0) reasons.push(`${epciDedup} déjà en base`);
        if (epciNotPublic > 0) reasons.push(`${epciNotPublic} jugé${epciNotPublic > 1 ? 's' : ''} non accessible${epciNotPublic > 1 ? 's' : ''} au public (IA)`);
        if (epciAiError > 0) reasons.push(`${epciAiError} erreur${epciAiError > 1 ? 's' : ''} IA`);
        if (epciErrors > 0) reasons.push(`${epciErrors} erreur${epciErrors > 1 ? 's' : ''} d'import`);
        const detail = scanned === 0
          ? '🔎 Aucun lieu trouvé par Overpass sur ce périmètre'
          : `🔎 ${scanned} lieu${scanned > 1 ? 'x' : ''} analysé${scanned > 1 ? 's' : ''} : ${reasons.join(' · ') || 'aucun retenu'}`;
        await flushSkippedDigest();
        await postDiscord(
          `⏭️ **${epci.nom}** — 0 POI ajouté\n` +
          `📍 ${dept.nom} · ${dept.region}\n` +
          `${detail}\n` +
          remainingLine(dept),
        );
      }

      if (doneTotal % HEARTBEAT_EVERY === 0) {
        await postDiscord(`⏳ En cours — ${doneTotal}/${selected.length} EPCI traitées · ${selected.length - doneTotal} restantes en France · ${progress.poisImported} POI · ETA ~${progress.etaHours ?? '?'} h`);
      }
    } catch (e: any) {
      progress.errors++;
      progress.processedEpcis++; // évite une boucle infinie sur une EPCI qui plante systématiquement
      markDone(dept);
      console.error(`⚠️  ${epci.nom} — erreur EPCI: ${e?.message?.substring(0, 80)}`);
      // On notifie aussi les échecs de scan : sans ça, une EPCI qui plante décrémentait le compteur
      // en silence (autre source de « saut »).
      await flushSkippedDigest();
      await postDiscord(
        `⚠️ **${epci.nom}** — échec du scan (0 POI)\n` +
        `📍 ${dept.nom} · ${dept.region}\n` +
        `🔎 Erreur : ${String(e?.message ?? e).slice(0, 120)}\n` +
        remainingLine(dept),
      );
    }
    writeProgress(progress);
  }

  await flushSkippedDigest(); // vide un éventuel reliquat de sauts en fin de run
  progress.currentEpci = 'TERMINÉ';
  progress.finished = true;
  writeProgress(progress);
  await postDiscord(`🎉 **Import terminé** — ${progress.poisImported} POI importés · ${progress.skippedEpcis} EPCI déjà peuplées · ${progress.errors} erreurs.`);
  console.log(`\n🎉 Import terminé : ${progress.poisImported} POI importés, ${progress.skippedEpcis} EPCI sautées, ${progress.errors} erreurs.`);
}

main().catch((e) => { console.error('💥 FATAL', e); process.exit(1); });
