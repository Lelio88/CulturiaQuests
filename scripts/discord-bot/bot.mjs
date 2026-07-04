/**
 * bot.mjs — Bot Discord de suivi de l'import POI CulturiaQuests.
 *
 * Slash-command `/import-status` : lit `import-progress.json` (écrit en continu par le runner
 * comcom-import-auto.ts) et répond avec l'état d'avancement (EPCI traitées, POI, ETA, dernière MAJ
 * → permet de confirmer que ça tourne encore). Slash-command = aucun intent privilégié requis.
 *
 * Config par variables d'env :
 * - DISCORD_BOT_TOKEN : token du bot (Developer Portal).
 * - PROGRESS_FILE     : chemin du fichier de progression (défaut : ../pois_importer/import-progress.json).
 * - DISCORD_GUILD_ID  : (optionnel) id du serveur → enregistrement instantané de la commande ;
 *                       sinon enregistrement global (propagation ~1 h).
 *
 * Exécution (conteneur, monte le repo pour lire le fichier de progression) :
 *   docker run -d --name cq-discord-bot --restart unless-stopped -v /opt/culturiaquests:/repo \
 *     -w /repo/scripts/discord-bot -e DISCORD_BOT_TOKEN=... \
 *     -e PROGRESS_FILE=/repo/scripts/pois_importer/import-progress.json \
 *     node:22 bash -c "npm install --silent && node bot.mjs"
 */
import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import path from 'path';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const PROGRESS_FILE = process.env.PROGRESS_FILE || path.resolve(process.cwd(), '../pois_importer/import-progress.json');

if (!TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN manquant.');
  process.exit(1);
}

function statusMessage() {
  let p;
  try {
    p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return '❓ Aucun import en cours (fichier de progression introuvable).';
  }
  const pct = p.totalEpcis ? Math.round((p.processedEpcis / p.totalEpcis) * 100) : 0;
  const ageMin = p.lastUpdate ? Math.round((Date.now() - Date.parse(p.lastUpdate)) / 60000) : null;
  let etat;
  if (p.finished) etat = '✅ terminé';
  else if (ageMin !== null && ageMin < 15) etat = '🟢 actif';
  else etat = `🟠 pas de mise à jour depuis ${ageMin} min (bloqué / arrêté ?)`;
  return [
    `**État de l'import POI** — ${etat}`,
    `Périmètre : ${p.scope}`,
    `EPCI : **${p.processedEpcis}/${p.totalEpcis}** (${pct} %) · déjà peuplées : ${p.skippedEpcis}`,
    `POI importés : **${p.poisImported}** · rejetés : ${p.poisRejected} · déjà existants : ${p.poisSkippedExisting}`,
    `Erreurs : ${p.errors} · ETA ~ **${p.etaHours ?? '?'} h**`,
    `En cours : ${p.currentEpci}`,
    `Dernière MAJ : ${p.lastUpdate}`,
  ].join('\n');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName('import-status').setDescription("Voir l'état d'avancement de l'import POI").toJSON(),
];

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot connecté : ${c.user.tag}`);
  try {
    const rest = new REST().setToken(TOKEN);
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(c.user.id, GUILD_ID), { body: commands });
      console.log('Slash-command /import-status enregistrée (serveur, instantané).');
    } else {
      await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
      console.log('Slash-command /import-status enregistrée (globale, ~1 h de propagation).');
    }
  } catch (e) {
    console.error('Échec enregistrement de la commande :', e?.message);
  }
});

client.on(Events.InteractionCreate, async (i) => {
  if (i.isChatInputCommand() && i.commandName === 'import-status') {
    try { await i.reply(statusMessage()); } catch { /* ignore */ }
  }
});

client.login(TOKEN);
