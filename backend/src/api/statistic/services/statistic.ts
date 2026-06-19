import { getUserGuild } from '../../../utils/guild-helpers';

/**
 * Service de statistiques joueur : agrège en une passe les chiffres-clés d'un utilisateur
 * (expéditions, temps de jeu, dégâts cumulés, étage max, visites de POI, économie d'objets,
 * or/xp totaux, ancienneté du compte) via `getSummary(userId)`.
 *
 * Choix non-évidents :
 * - La guilde du joueur est résolue par `getUserGuild` ; si l'utilisateur n'a pas de guilde,
 *   un objet de stats à zéro est renvoyé (jamais d'erreur ni de fuite cross-utilisateur).
 * - Les six lectures (runs, visites, items, quêtes, user, POI le plus visité) sont parallélisées
 *   avec `Promise.all` et des `select` ciblés pour limiter le coût en BDD.
 * - Le temps total et les dégâts sont reconstitués par run : `duration = date_end - date_start`,
 *   puis `dégâts += dps * (duration / 1000)` (dps est par seconde) ; seuls les runs avec une
 *   durée strictement positive comptent.
 * - L'or total agrège trois sources : runs (`gold_earned`), visites (`total_gold_earned`) et
 *   quêtes (`gold_earned`). L'xp total provient en revanche du champ `exp` de la guilde.
 * - Le scrap accumulé des objets démantelés suit la formule `floor(level * multiplicateurRareté
 *   + index_damage / 2)`, avec un barème de rareté (basic=1 … legendary=20) appliqué en minuscules.
 * - L'ancienneté (`accountDays`) est arrondie au jour supérieur depuis `user.createdAt`.
 *
 * Invariants à préserver :
 * - Toujours scoper les lectures à `guild.id` du `userId` passé : aucune statistique ne doit
 *   agréger des données d'une autre guilde (isolation utilisateur).
 *
 * @example
 *   const stats = await strapi.service('api::statistic.statistic').getSummary(userId);
 *   // stats.totalExpeditions, stats.totalTime (ms), stats.totalGold, stats.mostVisitedPoiName, ...
 */
export default ({ strapi }) => ({
  async getSummary(userId) {
    // 1. Get Guild ID
    const guild = await getUserGuild(strapi, userId, {
      select: ['id', 'exp']
    });

    if (!guild) {
      return {
        totalExpeditions: 0,
        totalTime: 0,
        maxFloor: 0,
        totalDamage: 0,
        totalPoiVisits: 0,
        totalDistinctPois: 0,
        totalItemsCollected: 0,
        totalItemsScrapped: 0,
        totalScrapAccumulated: 0,
        totalExp: 0,
        totalGold: 0,
        accountDays: 0,
      };
    }

    const guildId = guild.id;

    // --- Parallel Data Fetching (Optimized Selects) ---
    const [runs, visits, items, quests, user, mostVisitedPoi] = await Promise.all([
      // Runs: Need dates for time, dps for damage, threshold, gold
      strapi.db.query('api::run.run').findMany({
        where: { guild: guildId },
        select: ['date_start', 'date_end', 'dps', 'threshold_reached', 'gold_earned'],
      }),
      // Visits: Need open_count, gold
      strapi.db.query('api::visit.visit').findMany({
        where: { guild: guildId },
        select: ['open_count', 'total_gold_earned'],
      }),
      // Items: Need stats for scrap calculation
      strapi.db.query('api::item.item').findMany({
        where: { guild: guildId },
        select: ['isScrapped', 'level', 'index_damage'],
        populate: {
          rarity: {
            select: ['name']
          }
        }
      }),
      // Quests: Need gold
      strapi.db.query('api::quest.quest').findMany({
        where: { guild: guildId },
        select: ['gold_earned'],
      }),
      // User info for account age
      strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: userId },
        select: ['createdAt']
      }),
      // Most Visited POI
      strapi.db.query('api::visit.visit').findMany({
        where: { guild: guildId },
        orderBy: { open_count: 'desc' },
        limit: 1,
        populate: { poi: { select: ['name'] } }
      })
    ]);

    // --- Aggregation Logic ---

    // 1. Account Days
    let accountDays = 0;
    if (user && user.createdAt) {
      const created = new Date(user.createdAt);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - created.getTime());
      accountDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // 2. Runs Stats
    let totalTime = 0;
    let totalDamage = 0;
    let maxFloor = 0;
    let totalGold = 0;

    for (const run of runs) {
      // Time & Damage
      if (run.date_start && run.date_end) {
        const start = new Date(run.date_start).getTime();
        const end = new Date(run.date_end).getTime();
        const duration = end - start;
        if (duration > 0) {
          totalTime += duration;
          if (run.dps) {
            totalDamage += run.dps * (duration / 1000);
          }
        }
      }

      // Floor
      if (run.threshold_reached && run.threshold_reached > maxFloor) {
        maxFloor = run.threshold_reached;
      }

      // Gold
      if (run.gold_earned) {
        totalGold += run.gold_earned;
      }
    }

    // 3. Visits Stats
    let totalPoiVisits = 0;
    for (const visit of visits) {
      if (visit.open_count) totalPoiVisits += visit.open_count;
      if (visit.total_gold_earned) totalGold += visit.total_gold_earned;
    }

    // 4. Quests Stats
    for (const quest of quests) {
      if (quest.gold_earned) totalGold += quest.gold_earned;
    }

    // 5. Items Stats
    let totalItemsScrapped = 0;
    let totalScrapAccumulated = 0;

    const rarityMultipliers: Record<string, number> = {
      basic: 1, common: 2, rare: 5, epic: 10, legendary: 20
    };

    for (const item of items) {
      if (item.isScrapped) {
        totalItemsScrapped++;
        
        const level = item.level || 1;
        const damage = item.index_damage || 0;
        const rarityName = (item.rarity?.name || 'basic').toLowerCase();
        const rarityMult = rarityMultipliers[rarityName] || 1;
        
        totalScrapAccumulated += Math.floor((level * rarityMult) + (damage / 2));
      }
    }

    // 6. Most Visited POI
    const mostVisitedPoiName = mostVisitedPoi[0]?.poi?.name || null;

    return {
      totalExpeditions: runs.length,
      totalTime,
      maxFloor,
      totalDamage,
      totalPoiVisits,
      totalDistinctPois: visits.length,
      mostVisitedPoiName,
      totalItemsCollected: items.length,
      totalItemsScrapped,
      totalScrapAccumulated,
      totalExp: guild.exp || 0,
      totalGold,
      accountDays
    };
  }
});
