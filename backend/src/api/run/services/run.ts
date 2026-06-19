/**
 * run service
 *
 * Outre les helpers de calcul (DPS, tier, récompenses), ce service porte désormais les flux
 * ORCHESTRATEURS d'expédition `startExpedition` / `endExpedition` (extraits du controller, #40).
 * Le controller ne fait plus que : `ctx.state.user`, appel service, mapping d'erreurs.
 *
 * Contrat d'erreurs : les deux flux lèvent `RunServiceError(status, message, details?)` pour chaque
 * cas d'échec (le controller mappe vers ctx.badRequest/notFound/forbidden en préservant message+details).
 *
 * Invariants à PRÉSERVER (durcissements EPIC-BUGS #62) :
 * - `endExpedition` termine la run via un CLAIM ATOMIQUE (`updateMany WHERE date_end IS NULL`) :
 *   si 0 ligne affectée → 'Run already finished' (anti double-loot/crédit en concurrence).
 * - Le crédit gold/exp de la guilde est un UPDATE ATOMIQUE (`SET x = x + delta`), jamais un
 *   read-modify-write (anti perte/duplication de récompenses).
 */

import { factories } from '@strapi/strapi';
import { getUserGuild } from '../../../utils/guild-helpers';

const RARITY_MULTIPLIERS: Record<string, number> = {
  basic: 1,
  common: 1.5,
  rare: 2,
  epic: 3,
  legendary: 5
};

/** Erreur métier d'expédition → mappée vers le bon code HTTP par le controller (#40). */
export class RunServiceError extends Error {
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RunServiceError';
    this.status = status;
    this.details = details;
  }
}

function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
  var R = 6371e3; // Radius of the earth in m
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in m
  return d;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export default factories.createCoreService('api::run.run', ({ strapi }) => ({
  async calculateGuildDPS(guildDocumentId: string): Promise<number> {
    const guild = await strapi.documents('api::guild.guild').findOne({
      documentId: guildDocumentId,
      populate: {
        characters: {
          populate: {
            items: {
              populate: ['rarity']
            }
          }
        }
      }
    });

    if (!guild || !guild.characters) return 0;

    let totalDPS = 0;
    for (const char of guild.characters) {
      if (char.items) {
        for (const item of char.items) {
           const base = Number(item.index_damage) || 0;
           const level = Number(item.level) || 1;
           // Handle populated rarity (can be null or object)
           const rarityName = item.rarity?.name?.toLowerCase() || 'common';
           const multiplier = RARITY_MULTIPLIERS[rarityName] || 1;
           
           totalDPS += Math.floor(base * level * multiplier);
        }
      }
    }
    return totalDPS;
  },

  calculateTierFromDamage(totalDamage: number): number {
    if (totalDamage <= 0) return 1;
    // Formula: floor(log(totalDamage/100) / log(1.5)) + 2
    // If totalDamage < 100, we clamp to min tier 1
    if (totalDamage < 100) return 1;
    
    const val = totalDamage / 100;
    const tier = Math.floor(Math.log(val) / Math.log(1.5)) + 2;
    return Math.max(1, tier);
  },

  calculateRewards(tier: number, totalDamage: number, elapsedSeconds: number) {
    // Gold calculation (based on tier and damage)
    const gold = Math.floor(tier * 250 + totalDamage / 100);

    // XP calculation with Gaussian curve on time
    // Optimal time: 5 minutes (300s), rewards decrease after that
    const OPTIMAL_TIME = 300; // 5 minutes in seconds
    const VARIANCE = 180; // Controls the width of the curve (3 minutes variance)
    const BASE_XP_PER_TIER = 200; // Base XP multiplied by tier

    // Gaussian function: exp(-((t - optimal)^2) / (2 * variance^2))
    const timeDiff = elapsedSeconds - OPTIMAL_TIME;
    const gaussianMultiplier = Math.exp(-(timeDiff * timeDiff) / (2 * VARIANCE * VARIANCE));

    // XP = base_xp * tier * gaussian_multiplier
    // Add a minimum multiplier to ensure some XP is always earned
    const finalMultiplier = Math.max(0.1, gaussianMultiplier); // Minimum 10% of XP
    const xp = Math.floor(BASE_XP_PER_TIER * tier * finalMultiplier);

    // Item count (based on tier)
    const itemCount = Math.min(4 + Math.floor(tier / 2), 12);

    return { gold, xp, itemCount };
  },

  rollQuestChance() {
    // 1/5 chance => 20%
    const rolled = Math.random() < 0.2;
    // target_threshold 5-15
    const targetThreshold = rolled ? Math.floor(Math.random() * 11) + 5 : null;
    return { rolled, targetThreshold };
  },

  /**
   * Démarre une expédition : validations (coordonnées, guilde, distance, run active, cooldown),
   * calcul du DPS, tirage NPC (1/5, 0% si cooldown), création de la run. Retourne la run + l'éventuel
   * dialogue/NPC tiré. Lève `RunServiceError` sur tout échec.
   */
  async startExpedition(
    userId: number,
    params: { museumDocumentId?: string; userLat?: number; userLng?: number }
  ) {
    const { museumDocumentId, userLat, userLng } = params;
    if (!museumDocumentId) {
      throw new RunServiceError(400, 'Missing parameters');
    }
    // Number.isFinite accepte 0 (coordonnée valide, ex. équateur/Greenwich) et rejette
    // NaN/Infinity/undefined ; on rejette aussi les coordonnées hors bornes. #6
    if (typeof userLat !== 'number' || !Number.isFinite(userLat) || userLat < -90 || userLat > 90 ||
        typeof userLng !== 'number' || !Number.isFinite(userLng) || userLng < -180 || userLng > 180) {
      throw new RunServiceError(400, 'Invalid coordinates');
    }

    // 1. Get Guild
    const guild = await getUserGuild(strapi, userId, {
      select: ['documentId', 'debug_mode']
    });
    if (!guild) throw new RunServiceError(400, 'User has no guild');

    // Debug log
    strapi.log.info(`[DEBUG] Starting expedition - Guild debug_mode: ${guild.debug_mode}`);

    // 2. Fetch Museum (removed NPC check/populate)
    const museum = await strapi.documents('api::museum.museum').findOne({
      documentId: museumDocumentId
    });

    if (!museum) throw new RunServiceError(404, 'Museum not found');

    // 3. Validate Distance (bypass if debug mode enabled)
    if (!guild.debug_mode) {
      const dist = getDistanceFromLatLonInM(userLat, userLng, museum.lat, museum.lng);
      strapi.log.info(`[DEBUG] Distance check - distance: ${dist}m, radius: ${museum.radius || 50}m`);
      if (dist > (museum.radius || 50)) { // default radius 50m if null
        throw new RunServiceError(400, 'Too far from museum', { distance: dist, radius: museum.radius });
      }
    } else {
      strapi.log.info('[DEBUG] Distance check bypassed (debug mode enabled)');
    }

    // 4. Check active run
    const activeRuns = await strapi.documents('api::run.run').findMany({
      filters: {
        guild: { documentId: guild.documentId },
        date_end: { $null: true }
      },
      limit: 1
    });

    if (activeRuns.length > 0) throw new RunServiceError(400, 'An expedition is already active');

    // 4b. Check cooldown (10 minutes entre chaque expédition)
    const COOLDOWN_MINUTES = 10;
    const lastRun = await strapi.documents('api::run.run').findMany({
      filters: {
        guild: { documentId: guild.documentId },
        date_end: { $notNull: true }
      },
      sort: { date_end: 'desc' },
      limit: 1
    });

    let isOnCooldown = false;
    if (lastRun.length > 0 && lastRun[0].date_end) {
      const lastEndTime = new Date(lastRun[0].date_end).getTime();
      const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
      isOnCooldown = (Date.now() - lastEndTime) < cooldownMs;
    }

    // 5. Calculate DPS
    const dps = await strapi.service('api::run.run').calculateGuildDPS(guild.documentId);

    // 6. Roll NPC Chance (1/5)
    const roll = Math.floor(Math.random() * 5) + 1; // 1 to 5
    const hasNpc = !isOnCooldown && roll === 1; // 1/5 chance, 0% si cooldown actif

    let assignedNpc: any = null;
    let targetThreshold: number | null = null;
    let dialogLines: string[] = [];

    if (hasNpc) {
        // Seul le dialogue expedition_appear est utilisé → on filtre le populate au lieu de
        // charger TOUS les dialogues de TOUS les NPCs. (.find() ci-dessous reste correct.)
        const allNpcs = await strapi.documents('api::npc.npc').findMany({
            populate: { dialogs: { filters: { text_type: { $eq: 'expedition_appear' } } } }
        });

        if (allNpcs && allNpcs.length > 0) {
            const randomIndex = Math.floor(Math.random() * allNpcs.length);
            assignedNpc = allNpcs[randomIndex];

            // Set target threshold (Quest logic linked to NPC appearance)
            targetThreshold = Math.floor(Math.random() * 11) + 5; // 5 to 15

            // Get Dialog
            const dialogObj = assignedNpc.dialogs?.find((d: any) => d.text_type === 'expedition_appear');
            dialogLines = dialogObj ? dialogObj.dialogues : ["Un aventurier approche..."];
        }
    }

    // 7. Create Run
    const run = await strapi.documents('api::run.run').create({
      data: {
        date_start: new Date(),
        dps: dps,
        museum: museumDocumentId,
        npc: assignedNpc ? assignedNpc.documentId : null,
        guild: guild.documentId,
        target_threshold: targetThreshold,
        threshold_reached: 0,
        gold_earned: 0,
        xp_earned: 0,
        entry_unlocked: false
      }
    });

    return {
      run,
      questRolled: hasNpc,
      dialog: dialogLines,
      npc: assignedNpc ? { firstname: assignedNpc.firstname, lastname: assignedNpc.lastname, nickname: assignedNpc.nickname } : null
    };
  },

  /**
   * Termine une expédition : claim atomique du `date_end` (anti double-traitement), calcul des
   * stats/récompenses, génération du loot, logique de quête/friendship NPC, crédit ATOMIQUE de la
   * guilde. Retourne la run mise à jour + les récompenses. Lève `RunServiceError` sur tout échec.
   */
  async endExpedition(userId: number, runDocumentId: string) {
    if (!runDocumentId) throw new RunServiceError(400, 'Missing runDocumentId');

    // 1. Fetch Run & Validate
    const run = await strapi.documents('api::run.run').findOne({
      documentId: runDocumentId,
      populate: ['guild', 'npc']
    });

    if (!run) throw new RunServiceError(404, 'Run not found');

    const guild = await getUserGuild(strapi, userId, {
      select: ['documentId']
    });
    if (!guild || (run.guild as any).documentId !== guild.documentId) {
      throw new RunServiceError(403, 'You do not own this run');
    }

    // Claim atomique : termine la run UNIQUEMENT si elle ne l'est pas déjà. Empêche le
    // double-traitement (double loot/crédit) en cas de double-soumission concurrente.
    const now = new Date();
    const claim = await strapi.db.query('api::run.run').updateMany({
      where: { documentId: runDocumentId, date_end: { $null: true } },
      data: { date_end: now },
    });
    if (!claim || claim.count === 0) {
      throw new RunServiceError(400, 'Run already finished');
    }

    // 2. Calculate Stats
    const start = new Date(run.date_start as string);
    const elapsedSeconds = (now.getTime() - start.getTime()) / 1000;
    const totalDamage = Math.floor(elapsedSeconds * run.dps);

    const runService = strapi.service('api::run.run');
    const tier = runService.calculateTierFromDamage(totalDamage);
    const { gold, xp, itemCount } = runService.calculateRewards(tier, totalDamage, elapsedSeconds);

    // 3. Generate Loot
    const itemService = strapi.service('api::item.item');
    const items = [];
    for (let i = 0; i < itemCount; i++) {
      // Assuming maxFloor 1 for now
      const item = await itemService.generateRandomItem(guild.documentId, 1);
      items.push(item);
    }

    const itemIds = items.map(i => i.documentId);

    // 4. Quest Logic
    let entryUnlocked = false;
    if (run.target_threshold && tier >= run.target_threshold && run.npc) {
      // Vérifier si on peut encore débloquer des entrées pour ce NPC
      const npcData = run.npc as any;
      const npcDocumentId: string = typeof npcData === 'string' ? npcData : npcData.documentId;

      const npc = await strapi.documents('api::npc.npc').findOne({
        documentId: npcDocumentId,
      });

      if (npc) {
        // Chercher ou créer la relation friendship
        let friendship = await strapi.db.query('api::friendship.friendship').findOne({
          where: {
            guild: { documentId: guild.documentId },
            npc: { documentId: npcDocumentId },
          },
        });

        const currentUnlocked = friendship?.expedition_entry_unlocked || 0;
        const maxAvailable = npc.expedition_entry_available || 0;

        if (currentUnlocked < maxAvailable) {
          entryUnlocked = true;

          if (friendship) {
            // Mettre à jour la friendship existante via le Document Service (cohérent avec le
            // create ci-dessous ; documentId déjà disponible, le findOne n'a pas de select). #42
            await strapi.documents('api::friendship.friendship').update({
              documentId: friendship.documentId,
              data: { expedition_entry_unlocked: currentUnlocked + 1 },
            });
          } else {
            // Créer une nouvelle friendship
            await strapi.documents('api::friendship.friendship').create({
              data: {
                guild: guild.documentId,
                npc: npcDocumentId,
                expedition_entry_unlocked: 1,
                quests_entry_unlocked: 0,
              },
            });
          }
        }
      }
    }

    // 5. Update Run
    const updatedRun = await strapi.documents('api::run.run').update({
      documentId: runDocumentId,
      data: {
        // date_end déjà posé par le claim atomique ci-dessus
        threshold_reached: tier,
        gold_earned: gold,
        xp_earned: xp,
        entry_unlocked: entryUnlocked,
        items: itemIds
      }
    });

    // 6. Crédit ATOMIQUE du gold/exp de la guilde (UPDATE ... SET x = x + delta) : évite la
    // perte/duplication de récompenses en concurrence (double-tap, retry) — plus de
    // read-modify-write. guild draftAndPublish=false → document_id unique. #12
    await strapi.db.connection.raw(
      'UPDATE guilds SET gold = gold + ?, exp = exp + ? WHERE document_id = ?',
      [gold, xp, guild.documentId]
    );

    return {
      run: updatedRun,
      rewards: { gold, xp, items },
      questSuccess: entryUnlocked
    };
  }
}));
