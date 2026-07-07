/**
 * bot.mjs — Bot Discord de suivi de l'import POI CulturiaQuests.
 *
 * Slash-command `/import-status` : combine DEUX sources pour un état non-ambigu :
 *   1. Les **totaux réels en base** (Strapi `/api/pois` + `/api/museums`) — la vérité qui
 *      **persiste à travers les redémarrages** du runner d'import.
 *   2. Le fichier `import-progress.json` (écrit en continu par comcom-import-auto.ts) pour la
 *      **passe en cours** (EPCI parcourues, vitesse, ETA, ventilation des rejets). ⚠️ Ces compteurs
 *      sont remis à 0 à chaque (re)démarrage du runner → toujours labellisés « passe » et jamais
 *      présentés comme la progression absolue (c'était la source de confusion de l'ancienne version).
 *
 * Choix non-évidents :
 * - `processedEpcis` inclut DÉJÀ les EPCI sautées (déjà peuplées) → position de passe = processedEpcis ;
 *   scannées réelles = processedEpcis - skippedEpcis. Ne pas re-additionner.
 * - On NE compte PAS les « comcoms couvertes » : le schéma comcom n'a pas de relation inverse `pois`
 *   (Strapi renvoie 400 « Invalid key pois ») et compter les distinctes coûterait ~94 requêtes/commande.
 * - Interaction : `deferReply()` puis `editReply()` car les appels Strapi dépassent la limite des 3 s.
 * - Les appels Strapi sont best-effort (timeout + try/catch) : Strapi injoignable → ligne « indisponible »,
 *   jamais de commande cassée.
 *
 * Config par variables d'env :
 * - DISCORD_BOT_TOKEN : token du bot (Developer Portal). Requis pour tourner (pas pour --print-status).
 * - PROGRESS_FILE     : chemin du fichier de progression (défaut : ../pois_importer/import-progress.json).
 * - DISCORD_GUILD_ID  : (optionnel) id du serveur → enregistrement instantané ; sinon global (~1 h).
 * - STRAPI_BASE_URL   : ex. http://backend:1337 (réseau compose) → totaux réels en base.
 * - STRAPI_API_TOKEN  : token Strapi (lecture suffit) ; sans lui, la ligne « en base » est masquée.
 *
 * CLI : `node bot.mjs --print-status` imprime le message et sort (aucune connexion Discord requise) —
 *       pratique pour tester/vérifier le rendu côté ops.
 *
 * Exécution (conteneur, même réseau que le backend pour résoudre `backend:1337`) :
 *   docker run -d --name cq-discord-bot --restart unless-stopped \
 *     --network culturiaquests_app-network -v /opt/culturiaquests:/repo \
 *     -w /repo/scripts/discord-bot \
 *     -e DISCORD_BOT_TOKEN=... \
 *     -e STRAPI_BASE_URL=http://backend:1337 -e STRAPI_API_TOKEN=... \
 *     -e PROGRESS_FILE=/repo/scripts/pois_importer/import-progress.json \
 *     node:22 bash -c "npm install --silent && node bot.mjs"
 */
import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const PROGRESS_FILE = process.env.PROGRESS_FILE || path.resolve(process.cwd(), '../pois_importer/import-progress.json');
const STRAPI_BASE_URL = (process.env.STRAPI_BASE_URL || '').replace(/\/$/, '');
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || '';

// --- Formatage ---
const fmtInt = (n) => (typeof n === 'number' ? n.toLocaleString('fr-FR') : '?'); // "9 346"

/** Durée lisible : "1 h 12 min" ou "12 min". */
function fmtDur(ms) {
  const totMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totMin / 60);
  const m = totMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/**
 * ETA lisible. `null` (indéterminé, ex. juste après un redémarrage tant que < 3 scans réels) →
 * « calcul en cours… » plutôt qu'un chiffre trompeur. Ajoute les jours au-delà de 48 h.
 */
function formatEta(h) {
  if (h == null) return 'calcul en cours… (quelques scans requis)';
  return h >= 48 ? `~${h} h (~${Math.round(h / 24)} j)` : `~${h} h`;
}

/**
 * Total d'une collection Strapi via `meta.pagination.total` (best-effort).
 * Crochets pré-encodés : undici tolère `[`/`]` mais on reste explicite. Retourne null si indispo.
 */
async function strapiTotal(collection) {
  if (!STRAPI_BASE_URL || !STRAPI_TOKEN) return null;
  const url = `${STRAPI_BASE_URL}/api/${collection}?pagination%5BpageSize%5D=1&pagination%5BwithCount%5D=true`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${STRAPI_TOKEN}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const t = j?.meta?.pagination?.total;
    return typeof t === 'number' ? t : null;
  } catch {
    return null;
  }
}

async function statusMessage() {
  let p = null;
  try { p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { /* pas de passe en cours */ }

  // Totaux réels EN BASE (survivent aux redémarrages du runner) — en parallèle.
  const [dbPois, dbMuseums] = await Promise.all([strapiTotal('pois'), strapiTotal('museums')]);
  const dbLine = (dbPois !== null || dbMuseums !== null)
    ? `📍 **En base (réel)** : ${fmtInt(dbPois)} POI · ${fmtInt(dbMuseums)} musées`
    : '📍 En base (réel) : _indisponible (Strapi injoignable)_';

  if (!p) {
    return [
      '**📦 Import POI** — ❓ aucune passe en cours (fichier de progression introuvable)',
      dbLine,
      '_Le runner `cq-import` est peut-être arrêté. Le total en base ci-dessus reste la vérité._',
    ].join('\n');
  }

  const total = p.totalEpcis || 0;
  const walked = p.processedEpcis || 0;        // inclut DÉJÀ les EPCI sautées
  const skipped = p.skippedEpcis || 0;
  const scanned = Math.max(0, walked - skipped);
  const remaining = Math.max(0, total - walked);
  const pct = total ? Math.round((walked / total) * 100) : 0;

  const ageMin = p.lastUpdate ? Math.round((Date.now() - Date.parse(p.lastUpdate)) / 60000) : null;
  let etat;
  if (p.finished) etat = '✅ terminé';
  else if (ageMin !== null && ageMin < 15) etat = '🟢 actif';
  else etat = `🟠 aucune MAJ depuis ${ageMin} min (bloqué / arrêté ?)`;

  const startMs = p.startedAt ? Date.parse(p.startedAt) : NaN;
  const elapsedMs = Number.isFinite(startMs) ? Math.max(0, Date.now() - startMs) : 0;
  const elapsedH = elapsedMs / 3_600_000;
  const epciPerH = elapsedH > 0.02 ? Math.round(walked / elapsedH) : null;
  const poiPerH = elapsedH > 0.02 ? Math.round((p.poisImported || 0) / elapsedH) : null;

  // Ventilation des rejets (nouveaux champs ; tolère leur absence sur une passe pré-MAJ).
  const rej = p.poisRejected || 0;
  const notPublic = p.poisRejectedNotPublic;
  const aiErr = p.poisRejectedAiError;
  const rejLine = (typeof notPublic === 'number' && typeof aiErr === 'number')
    ? `  rejetés ${rej} → ${notPublic} non accessible${notPublic > 1 ? 's' : ''} au public (IA) · ${aiErr} erreur${aiErr > 1 ? 's' : ''} IA`
    : `  rejetés ${rej} _(ventilation dispo à la prochaine passe)_`;

  const rateLine = (epciPerH !== null)
    ? `⏱️ passe démarrée il y a ${fmtDur(elapsedMs)} · ~${epciPerH} EPCI/h · ~${poiPerH} POI/h`
    : `⏱️ passe démarrée il y a ${fmtDur(elapsedMs)}`;

  return [
    `**📦 Import POI** — ${etat}${ageMin !== null ? ` · MAJ il y a ${ageMin} min` : ''}`,
    `${p.scope}${p.ollamaModel ? ` · modèle ${p.ollamaModel}` : ''}`,
    dbLine,
    '',
    `**Passe en cours : ${walked}/${total} EPCI parcourues (${pct} %)** · restantes ${remaining}`,
    `  scannées ${scanned} · déjà peuplées (sautées) ${skipped}`,
    `POI ajoutés (cette passe) : **+${p.poisImported || 0}** · déjà en base ${p.poisSkippedExisting || 0} · erreurs d'import ${p.errors || 0}`,
    rejLine,
    `En cours : ${p.currentEpci || '—'}`,
    '',
    rateLine,
    `🗓️ ETA fin de passe : ${formatEta(p.etaHours)}`,
    'ℹ️ « passe » = balayage courant, remis à 0 à chaque redémarrage du runner ; le **total en base** est la vérité qui persiste.',
  ].join('\n');
}

// --- Mode CLI : impression unique, sans Discord (test/ops) ---
if (process.argv.includes('--print-status')) {
  statusMessage()
    .then((m) => { console.log(m); process.exit(0); })
    .catch((e) => { console.error('print-status:', e?.message ?? e); process.exit(1); });
} else {
  if (!TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN manquant.');
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const commands = [
    new SlashCommandBuilder().setName('import-status').setDescription("Voir l'état d'avancement de l'import POI").toJSON(),
  ];

  client.once(Events.ClientReady, async (c) => {
    console.log(`✅ Bot connecté : ${c.user.tag}`);
    try {
      const rest = new REST().setToken(TOKEN);
      // Enregistrement INSTANTANÉ : on cible chaque serveur où le bot est présent (auto-détecté),
      // + l'éventuel DISCORD_GUILD_ID explicite. À défaut de serveur, repli sur la commande globale.
      const guildIds = new Set([...c.guilds.cache.keys()]);
      if (GUILD_ID) guildIds.add(GUILD_ID);
      if (guildIds.size) {
        for (const gid of guildIds) {
          await rest.put(Routes.applicationGuildCommands(c.user.id, gid), { body: commands });
        }
        console.log(`Slash-command /import-status enregistrée sur ${guildIds.size} serveur(s) (instantané).`);
      } else {
        await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
        console.log('Aucun serveur détecté → commande globale (~1 h de propagation).');
      }
    } catch (e) {
      console.error('Échec enregistrement de la commande :', e?.message);
    }
  });

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand() || i.commandName !== 'import-status') return;
    try {
      await i.deferReply(); // les appels Strapi peuvent dépasser les 3 s → on diffère
      const msg = await statusMessage();
      await i.editReply(msg.slice(0, 1990));
    } catch (e) {
      console.error('import-status:', e?.message ?? e);
      try { await i.editReply('❌ Erreur lors de la récupération du statut.'); } catch { /* ignore */ }
    }
  });

  client.login(TOKEN).catch((e) => {
    // Sans ce .catch, un token invalide provoque un unhandledRejection → crash + boucle de
    // restart du conteneur sans diagnostic. On échoue proprement avec un message explicite.
    console.error('Échec de connexion du bot Discord (token invalide ?) :', e?.message ?? e);
    process.exit(1);
  });
}
