/**
 * admin-dashboard service
 * Aggregates data for the admin dashboard
 */

export default ({ strapi }) => ({
  /**
   * Get global KPIs for the dashboard home page
   */
  async getOverview() {
    const [
      totalUsers,
      totalGuilds,
      totalCharacters,
      totalItems,
      totalRuns,
      totalVisits,
      totalQuests,
      totalQuizAttempts,
      recentUsers,
      recentGuilds,
    ] = await Promise.all([
      strapi.db.query('plugin::users-permissions.user').count(),
      strapi.db.query('api::guild.guild').count(),
      strapi.db.query('api::character.character').count(),
      strapi.db.query('api::item.item').count(),
      strapi.db.query('api::run.run').count(),
      strapi.db.query('api::visit.visit').count(),
      strapi.db.query('api::quest.quest').count(),
      strapi.db.query('api::quiz-attempt.quiz-attempt').count(),
      strapi.db.query('plugin::users-permissions.user').count({
        where: { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      strapi.db.query('api::guild.guild').count({
        where: { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    const now = Date.now();
    const periods = {
      last24h: new Date(now - 24 * 60 * 60 * 1000),
      last7d: new Date(now - 7 * 24 * 60 * 60 * 1000),
      last30d: new Date(now - 30 * 24 * 60 * 60 * 1000),
    };

    const [
      runs24h, runs7d, runs30d,
      visits24h, visits7d, visits30d,
      quizAttempts24h, quizAttempts7d, quizAttempts30d,
    ] = await Promise.all([
      strapi.db.query('api::run.run').count({ where: { createdAt: { $gte: periods.last24h } } }),
      strapi.db.query('api::run.run').count({ where: { createdAt: { $gte: periods.last7d } } }),
      strapi.db.query('api::run.run').count({ where: { createdAt: { $gte: periods.last30d } } }),
      strapi.db.query('api::visit.visit').count({ where: { createdAt: { $gte: periods.last24h } } }),
      strapi.db.query('api::visit.visit').count({ where: { createdAt: { $gte: periods.last7d } } }),
      strapi.db.query('api::visit.visit').count({ where: { createdAt: { $gte: periods.last30d } } }),
      strapi.db.query('api::quiz-attempt.quiz-attempt').count({ where: { createdAt: { $gte: periods.last24h } } }),
      strapi.db.query('api::quiz-attempt.quiz-attempt').count({ where: { createdAt: { $gte: periods.last7d } } }),
      strapi.db.query('api::quiz-attempt.quiz-attempt').count({ where: { createdAt: { $gte: periods.last30d } } }),
    ]);

    const rarities = await strapi.db.query('api::rarity.rarity').findMany({ select: ['id', 'name'] });
    const itemsByRarity = {};
    for (const rarity of rarities) {
      itemsByRarity[rarity.name] = await strapi.db.query('api::item.item').count({ where: { rarity: rarity.id } });
    }

    const guilds = await strapi.db.query('api::guild.guild').findMany({ select: ['gold', 'exp'] });
    let totalGoldInCirculation = 0;
    let totalExpInCirculation = 0;
    for (const g of guilds) {
      totalGoldInCirculation += g.gold || 0;
      totalExpInCirculation += Number(g.exp) || 0;
    }

    return {
      totals: { users: totalUsers, guilds: totalGuilds, characters: totalCharacters, items: totalItems, runs: totalRuns, visits: totalVisits, quests: totalQuests, quizAttempts: totalQuizAttempts },
      recent: { newUsers7d: recentUsers, newGuilds7d: recentGuilds },
      activity: {
        expeditions: { last24h: runs24h, last7d: runs7d, last30d: runs30d },
        chestOpened: { last24h: visits24h, last7d: visits7d, last30d: visits30d },
        quizAttempts: { last24h: quizAttempts24h, last7d: quizAttempts7d, last30d: quizAttempts30d },
      },
      economy: { totalGoldInCirculation, totalExpInCirculation, itemsByRarity },
    };
  },

  // ─── PLAYERS ───────────────────────────────────────────────

  async getPlayers({ page = 1, pageSize = 25, search = '', sortBy = 'createdAt', sortOrder = 'desc' }) {
    const where: any = {};
    if (search) {
      where.$or = [
        { username: { $containsi: search } },
        { email: { $containsi: search } },
      ];
    }

    const [users, total] = await Promise.all([
      strapi.db.query('plugin::users-permissions.user').findMany({
        where,
        select: ['id', 'username', 'email', 'blocked', 'createdAt'],
        orderBy: { [sortBy]: sortOrder },
        limit: pageSize,
        offset: (page - 1) * pageSize,
        populate: { role: { select: ['id', 'name', 'type'] } },
      }),
      strapi.db.query('plugin::users-permissions.user').count({ where }),
    ]);

    // Guildes des utilisateurs de la page en 1 requête (au lieu d'un findOne par utilisateur),
    // puis comptages personnages/items groupés (2 requêtes au lieu de 2 × pageSize).
    const userIds = users.map((u) => u.id);
    const guilds = userIds.length
      ? await strapi.db.query('api::guild.guild').findMany({
          where: { user: { id: { $in: userIds } } },
          select: ['id', 'documentId', 'name', 'gold', 'exp', 'scrap', 'debug_mode'],
          populate: { user: { select: ['id'] } },
        })
      : [];
    const guildByUser = new Map<number, any>();
    for (const g of guilds) if (g.user?.id) guildByUser.set(g.user.id, g);

    const guildIds = guilds.map((g) => g.id);
    const charCountByGuild = new Map<number, number>();
    const itemCountByGuild = new Map<number, number>();
    if (guildIds.length) {
      const [chars, items] = await Promise.all([
        strapi.db.query('api::character.character').findMany({ where: { guild: { id: { $in: guildIds } } }, select: ['id'], populate: { guild: { select: ['id'] } } }),
        strapi.db.query('api::item.item').findMany({ where: { guild: { id: { $in: guildIds } } }, select: ['id'], populate: { guild: { select: ['id'] } } }),
      ]);
      for (const c of chars) { const gid = c.guild?.id; if (gid) charCountByGuild.set(gid, (charCountByGuild.get(gid) || 0) + 1); }
      for (const it of items) { const gid = it.guild?.id; if (gid) itemCountByGuild.set(gid, (itemCountByGuild.get(gid) || 0) + 1); }
    }

    const usersWithGuilds = users.map((user) => {
      const guild = guildByUser.get(user.id);
      return {
        id: user.id, username: user.username, email: user.email, blocked: user.blocked, createdAt: user.createdAt, role: user.role,
        guild: guild ? { id: guild.id, documentId: guild.documentId, name: guild.name, gold: guild.gold, exp: guild.exp, scrap: guild.scrap, debug_mode: guild.debug_mode, level: Math.floor(Math.sqrt(Number(guild.exp) / 75)) + 1, characterCount: charCountByGuild.get(guild.id) || 0, itemCount: itemCountByGuild.get(guild.id) || 0 } : null,
      };
    });

    return { data: usersWithGuilds, pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total } };
  },

  async getPlayerDetail(userId: number) {
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
      select: ['id', 'username', 'email', 'blocked', 'createdAt'],
      populate: { role: { select: ['id', 'name', 'type'] } },
    });
    if (!user) return null;

    const guild = await strapi.db.query('api::guild.guild').findOne({
      where: { user: { id: userId } },
      select: ['id', 'documentId', 'name', 'gold', 'exp', 'scrap', 'debug_mode', 'quiz_streak'],
    });

    if (!guild) return { ...user, guild: null, characters: [], stats: null };

    const characters = await strapi.db.query('api::character.character').findMany({
      where: { guild: guild.id },
      select: ['id', 'documentId', 'firstname', 'lastname'],
      populate: { icon: { select: ['url'] } },
    });

    const stats = await strapi.service('api::statistic.statistic').getSummary(userId);

    const [recentRuns, recentVisits, recentQuizAttempts] = await Promise.all([
      strapi.db.query('api::run.run').findMany({ where: { guild: guild.id }, select: ['id', 'date_start', 'date_end', 'gold_earned', 'xp_earned', 'threshold_reached'], orderBy: { createdAt: 'desc' }, limit: 10, populate: { museum: { select: ['name'] } } }),
      strapi.db.query('api::visit.visit').findMany({ where: { guild: guild.id }, select: ['id', 'open_count', 'last_opened_at', 'total_gold_earned', 'total_exp_earned'], orderBy: { last_opened_at: 'desc' }, limit: 10, populate: { poi: { select: ['name'] } } }),
      strapi.db.query('api::quiz-attempt.quiz-attempt').findMany({ where: { guild: guild.id }, select: ['id', 'score', 'completed_at', 'time_spent_seconds'], orderBy: { createdAt: 'desc' }, limit: 10 }),
    ]);

    return {
      ...user,
      guild: { ...guild, level: Math.floor(Math.sqrt(Number(guild.exp) / 75)) + 1 },
      characters, stats,
      recentActivity: { runs: recentRuns, visits: recentVisits, quizAttempts: recentQuizAttempts },
    };
  },

  async toggleBlockUser(userId: number) {
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: userId }, select: ['id', 'blocked'] });
    if (!user) return null;
    return strapi.db.query('plugin::users-permissions.user').update({ where: { id: userId }, data: { blocked: !user.blocked }, select: ['id', 'username', 'blocked'] });
  },

  async changeUserRole(userId: number, roleType: string) {
    const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: roleType }, select: ['id', 'name', 'type'] });
    if (!role) return null;
    return strapi.db.query('plugin::users-permissions.user').update({ where: { id: userId }, data: { role: role.id }, select: ['id', 'username'], populate: { role: { select: ['id', 'name', 'type'] } } });
  },

  // ─── MAP / GEOLOCATION ─────────────────────────────────────

  async getMapData() {
    // 1 requête par type relié, puis agrégation EN MÉMOIRE (Map) — au lieu d'une boucle
    // findMany/count PAR POI (×5073) et PAR musée (×405) qui générait ~10 500 requêtes.
    const [pois, museums, allVisits, allRuns, allQuests] = await Promise.all([
      strapi.db.query('api::poi.poi').findMany({ select: ['id', 'documentId', 'name', 'lat', 'lng'] }),
      strapi.db.query('api::museum.museum').findMany({
        select: ['id', 'documentId', 'name', 'lat', 'lng', 'radius'],
        populate: { tags: { select: ['id', 'name'] } },
      }),
      strapi.db.query('api::visit.visit').findMany({ select: ['open_count', 'total_gold_earned'], populate: { poi: { select: ['id'] } } }),
      strapi.db.query('api::run.run').findMany({ select: ['gold_earned', 'threshold_reached', 'date_start', 'date_end'], populate: { museum: { select: ['id'] } } }),
      strapi.db.query('api::quest.quest').findMany({ select: ['id'], populate: { poi_a: { select: ['id'] }, poi_b: { select: ['id'] } } }),
    ]);

    // Visites agrégées par POI
    const visitStats = new Map<number, { totalVisits: number; uniqueVisitors: number; totalGold: number }>();
    for (const v of allVisits) {
      const pid = v.poi?.id;
      if (!pid) continue;
      const s = visitStats.get(pid) || { totalVisits: 0, uniqueVisitors: 0, totalGold: 0 };
      s.totalVisits += v.open_count || 0;
      s.uniqueVisitors += 1;
      s.totalGold += v.total_gold_earned || 0;
      visitStats.set(pid, s);
    }
    // Quêtes comptées par POI (poi_a OU poi_b)
    const questCounts = new Map<number, number>();
    for (const q of allQuests) {
      for (const pid of [q.poi_a?.id, q.poi_b?.id]) {
        if (pid) questCounts.set(pid, (questCounts.get(pid) || 0) + 1);
      }
    }
    const poisWithStats = pois.map((poi) => {
      const s = visitStats.get(poi.id) || { totalVisits: 0, uniqueVisitors: 0, totalGold: 0 };
      return { ...poi, totalVisits: s.totalVisits, uniqueVisitors: s.uniqueVisitors, totalGold: s.totalGold, questCount: questCounts.get(poi.id) || 0 };
    });

    // Runs agrégés par musée
    const runStats = new Map<number, { totalRuns: number; totalGold: number; maxFloor: number; totalDuration: number }>();
    for (const r of allRuns) {
      const mid = r.museum?.id;
      if (!mid) continue;
      const s = runStats.get(mid) || { totalRuns: 0, totalGold: 0, maxFloor: 0, totalDuration: 0 };
      s.totalRuns += 1;
      s.totalGold += r.gold_earned || 0;
      s.maxFloor = Math.max(s.maxFloor, r.threshold_reached || 0);
      if (r.date_start && r.date_end) s.totalDuration += new Date(r.date_end).getTime() - new Date(r.date_start).getTime();
      runStats.set(mid, s);
    }
    const museumsWithStats = museums.map((museum) => {
      const s = runStats.get(museum.id) || { totalRuns: 0, totalGold: 0, maxFloor: 0, totalDuration: 0 };
      return { ...museum, totalRuns: s.totalRuns, totalGold: s.totalGold, maxFloor: s.maxFloor, avgDuration: s.totalRuns > 0 ? Math.round(s.totalDuration / s.totalRuns) : 0 };
    });

    return { pois: poisWithStats, museums: museumsWithStats };
  },

  // ─── ECONOMY ───────────────────────────────────────────────

  async getEconomy() {
    // Gold sources breakdown
    const [allRuns, allVisits, allQuests, allQuizAttempts] = await Promise.all([
      strapi.db.query('api::run.run').findMany({ select: ['gold_earned', 'xp_earned'] }),
      strapi.db.query('api::visit.visit').findMany({ select: ['total_gold_earned', 'total_exp_earned'] }),
      strapi.db.query('api::quest.quest').findMany({ select: ['gold_earned', 'xp_earned'] }),
      strapi.db.query('api::quiz-attempt.quiz-attempt').findMany({ select: ['rewards'] }),
    ]);

    const goldFromExpeditions = allRuns.reduce((s, r) => s + (r.gold_earned || 0), 0);
    const goldFromChests = allVisits.reduce((s, v) => s + (v.total_gold_earned || 0), 0);
    const goldFromQuests = allQuests.reduce((s, q) => s + (q.gold_earned || 0), 0);
    let goldFromQuiz = 0;
    for (const a of allQuizAttempts) {
      if (a.rewards && typeof a.rewards === 'object') {
        goldFromQuiz += a.rewards.gold || 0;
      }
    }

    const xpFromExpeditions = allRuns.reduce((s, r) => s + (r.xp_earned || 0), 0);
    const xpFromChests = allVisits.reduce((s, v) => s + (v.total_exp_earned || 0), 0);
    const xpFromQuests = allQuests.reduce((s, q) => s + (q.xp_earned || 0), 0);
    let xpFromQuiz = 0;
    for (const a of allQuizAttempts) {
      if (a.rewards && typeof a.rewards === 'object') {
        xpFromQuiz += a.rewards.xp || 0;
      }
    }

    // Item economy
    const items = await strapi.db.query('api::item.item').findMany({
      select: ['isScrapped', 'level', 'index_damage', 'slot'],
      populate: { rarity: { select: ['name'] } },
    });

    const totalItems = items.length;
    const scrappedItems = items.filter((i) => i.isScrapped).length;
    const activeItems = totalItems - scrappedItems;
    const itemsBySlot = { weapon: 0, helmet: 0, charm: 0 };
    for (const item of items) {
      if (item.slot && itemsBySlot[item.slot] !== undefined) {
        itemsBySlot[item.slot]++;
      }
    }

    // Level distribution of guilds
    const guilds = await strapi.db.query('api::guild.guild').findMany({ select: ['gold', 'exp', 'scrap'] });
    const levelDistribution: Record<string, number> = {};
    let totalScrap = 0;
    for (const g of guilds) {
      const level = Math.floor(Math.sqrt(Number(g.exp) / 75)) + 1;
      const bracket = level <= 5 ? '1-5' : level <= 10 ? '6-10' : level <= 20 ? '11-20' : level <= 50 ? '21-50' : '51+';
      levelDistribution[bracket] = (levelDistribution[bracket] || 0) + 1;
      totalScrap += g.scrap || 0;
    }

    return {
      goldSources: { expeditions: goldFromExpeditions, chests: goldFromChests, quests: goldFromQuests, quiz: goldFromQuiz },
      xpSources: { expeditions: xpFromExpeditions, chests: xpFromChests, quests: xpFromQuests, quiz: xpFromQuiz },
      itemEconomy: { total: totalItems, active: activeItems, scrapped: scrappedItems, bySlot: itemsBySlot },
      levelDistribution,
      totalScrapInCirculation: totalScrap,
    };
  },

  // ─── EXPEDITIONS & QUESTS ──────────────────────────────────

  async getExpeditions() {
    // Une seule requête runs (populate museum+npc) agrégée en mémoire, au lieu d'une boucle
    // findMany PAR musée (×405) + count PAR npc (×7).
    const [museums, npcs, allRuns, quests] = await Promise.all([
      strapi.db.query('api::museum.museum').findMany({ select: ['id', 'name'] }),
      strapi.db.query('api::npc.npc').findMany({ select: ['id', 'firstname', 'lastname', 'nickname'] }),
      strapi.db.query('api::run.run').findMany({
        select: ['gold_earned', 'threshold_reached', 'date_start', 'date_end', 'dps'],
        populate: { museum: { select: ['id'] }, npc: { select: ['id'] } },
      }),
      strapi.db.query('api::quest.quest').findMany({
        select: ['is_poi_a_completed', 'is_poi_b_completed', 'gold_earned', 'date_start', 'date_end'],
        populate: { npc: { select: ['id', 'firstname', 'lastname', 'nickname'] } },
      }),
    ]);

    // Runs agrégés par musée + comptage par NPC (en un seul passage)
    type MStat = { count: number; completed: number; totalGold: number; maxFloor: number; totalDps: number; totalTime: number };
    const byMuseum = new Map<number, MStat>();
    const runCountByNpc = new Map<number, number>();
    for (const r of allRuns) {
      const npcId = r.npc?.id;
      if (npcId) runCountByNpc.set(npcId, (runCountByNpc.get(npcId) || 0) + 1);
      const mid = r.museum?.id;
      if (!mid) continue;
      const s = byMuseum.get(mid) || { count: 0, completed: 0, totalGold: 0, maxFloor: 0, totalDps: 0, totalTime: 0 };
      s.count += 1;
      if (r.date_end) s.completed += 1;
      s.totalGold += r.gold_earned || 0;
      s.maxFloor = Math.max(s.maxFloor, r.threshold_reached || 0);
      s.totalDps += r.dps || 0;
      if (r.date_start && r.date_end) s.totalTime += new Date(r.date_end).getTime() - new Date(r.date_start).getTime();
      byMuseum.set(mid, s);
    }
    const museumStats = museums.map((m) => {
      const s = byMuseum.get(m.id) || { count: 0, completed: 0, totalGold: 0, maxFloor: 0, totalDps: 0, totalTime: 0 };
      return { name: m.name, totalRuns: s.count, completed: s.completed, totalGold: s.totalGold, maxFloor: s.maxFloor, avgDps: s.count > 0 ? Math.round(s.totalDps / s.count) : 0, avgDuration: s.count > 0 ? Math.round(s.totalTime / s.count) : 0 };
    });

    const totalQuests = quests.length;
    const completedQuests = quests.filter((q) => q.is_poi_a_completed && q.is_poi_b_completed).length;
    const partialQuests = quests.filter((q) => (q.is_poi_a_completed || q.is_poi_b_completed) && !(q.is_poi_a_completed && q.is_poi_b_completed)).length;

    // NPC quest rankings
    const npcMap: Record<number, { name: string; questCount: number; completedCount: number }> = {};
    for (const q of quests) {
      if (q.npc) {
        if (!npcMap[q.npc.id]) {
          npcMap[q.npc.id] = { name: `${q.npc.firstname} ${q.npc.lastname}`, questCount: 0, completedCount: 0 };
        }
        npcMap[q.npc.id].questCount++;
        if (q.is_poi_a_completed && q.is_poi_b_completed) npcMap[q.npc.id].completedCount++;
      }
    }
    const npcRanking = Object.values(npcMap).sort((a, b) => b.questCount - a.questCount);

    // NPC expedition rankings (depuis runCountByNpc — plus de count par NPC)
    const npcExpeditionRanking = npcs
      .map((npc) => ({ name: `${npc.firstname} ${npc.lastname}`, nickname: npc.nickname, expeditionCount: runCountByNpc.get(npc.id) || 0 }))
      .filter((n) => n.expeditionCount > 0)
      .sort((a, b) => b.expeditionCount - a.expeditionCount);

    return {
      museumStats,
      questStats: { total: totalQuests, completed: completedQuests, partial: partialQuests, pending: totalQuests - completedQuests - partialQuests },
      npcQuestRanking: npcRanking.slice(0, 10),
      npcExpeditionRanking: npcExpeditionRanking.slice(0, 10),
    };
  },

  // ─── QUIZ ──────────────────────────────────────────────────

  async getQuizAnalytics() {
    // Recent sessions
    const sessions = await strapi.db.query('api::quiz-session.quiz-session').findMany({
      orderBy: { date: 'desc' },
      limit: 30,
      select: ['id', 'date', 'generation_status', 'generation_error', 'generated_at'],
    });

    // Tentatives des 30 sessions en 1 requête, agrégées par session (au lieu de 2 × 30 requêtes)
    const sessionIds = sessions.map((s) => s.id);
    const sessionAttempts = sessionIds.length
      ? await strapi.db.query('api::quiz-attempt.quiz-attempt').findMany({
          where: { session: { id: { $in: sessionIds } } },
          select: ['score', 'time_spent_seconds'],
          populate: { session: { select: ['id'] } },
        })
      : [];
    const bySession = new Map<number, { count: number; sumScore: number; sumTime: number }>();
    for (const a of sessionAttempts) {
      const sid = a.session?.id;
      if (!sid) continue;
      const agg = bySession.get(sid) || { count: 0, sumScore: 0, sumTime: 0 };
      agg.count += 1;
      agg.sumScore += a.score || 0;
      agg.sumTime += a.time_spent_seconds || 0;
      bySession.set(sid, agg);
    }
    const sessionHistory = sessions.map((s) => {
      const agg = bySession.get(s.id) || { count: 0, sumScore: 0, sumTime: 0 };
      return {
        id: s.id,
        date: s.date,
        status: s.generation_status,
        participants: agg.count,
        avgScore: agg.count > 0 ? Math.round(agg.sumScore / agg.count) : 0,
        avgTime: agg.count > 0 ? Math.round(agg.sumTime / agg.count) * 1000 : 0,
      };
    });

    // Difficulty by tag — 1 requête questions + comptage par tag (au lieu d'un findMany par tag)
    const tags = await strapi.db.query('api::tag.tag').findMany({ select: ['id', 'name'] });
    const allQuestions = await strapi.db.query('api::quiz-question.quiz-question').findMany({
      select: ['id'],
      populate: { tag: { select: ['id'] } },
    });
    const questionCountByTag = new Map<number, number>();
    for (const qq of allQuestions) {
      const qTags = Array.isArray(qq.tag) ? qq.tag : qq.tag ? [qq.tag] : [];
      for (const t of qTags) if (t?.id) questionCountByTag.set(t.id, (questionCountByTag.get(t.id) || 0) + 1);
    }
    const questionsByTag = tags.map((tag) => ({ name: tag.name, count: questionCountByTag.get(tag.id) || 0 }));

    // Difficulty by type
    const qcmCount = await strapi.db.query('api::quiz-question.quiz-question').count({ where: { question_type: 'qcm' } });
    const timelineCount = await strapi.db.query('api::quiz-question.quiz-question').count({ where: { question_type: 'timeline' } });

    // Score distribution
    const allAttempts = await strapi.db.query('api::quiz-attempt.quiz-attempt').findMany({
      select: ['score', 'time_spent_seconds'],
    });

    const scoreRanges = { '0-500': 0, '501-1000': 0, '1001-1500': 0, '1501-2000': 0, '2001-2500': 0 };
    for (const a of allAttempts) {
      const s = a.score || 0;
      if (s <= 500) scoreRanges['0-500']++;
      else if (s <= 1000) scoreRanges['501-1000']++;
      else if (s <= 1500) scoreRanges['1001-1500']++;
      else if (s <= 2000) scoreRanges['1501-2000']++;
      else scoreRanges['2001-2500']++;
    }

    // Global leaderboard (top 20)
    const topAttempts = await strapi.db.query('api::quiz-attempt.quiz-attempt').findMany({
      orderBy: { score: 'desc' },
      limit: 20,
      select: ['id', 'score', 'completed_at', 'time_spent_seconds'],
      populate: {
        guild: { select: ['name'] },
        session: { select: ['date'] },
      },
    });

    const leaderboard = topAttempts.map((attempt) => ({
      id: attempt.id,
      guildName: attempt.guild?.name || 'Inconnu',
      score: attempt.score,
      date: attempt.session?.date || attempt.completed_at,
      timeSpent: (attempt.time_spent_seconds || 0) * 1000,
    }));

    return {
      sessionHistory,
      questionsByTag,
      questionTypes: { qcm: qcmCount, timeline: timelineCount },
      scoreDistribution: scoreRanges,
      totalAttempts: allAttempts.length,
      avgScore: allAttempts.length > 0 ? Math.round(allAttempts.reduce((s, a) => s + (a.score || 0), 0) / allAttempts.length) : 0,
      leaderboard,
    };
  },

  // ─── CONNECTIONS ─────────────────────────────────────────────

  async getConnectionAnalytics() {
    // Get connections for the last 12 weeks
    const twelveWeeksAgo = new Date();
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 12 * 7);

    // Weekly unique connections (group by ISO week)
    const weeklyMap: Record<string, Set<string>> = {};
    const hourCounts: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourCounts[h] = 0;

    // Also fetch user info for unique counting
    const connectionsWithUser = await strapi.db.query('api::connection-log.connection-log').findMany({
      where: { connected_at: { $gte: twelveWeeksAgo } },
      select: ['connected_at'],
      populate: { user: { select: ['id'] } },
    });

    for (const conn of connectionsWithUser) {
      const date = new Date(conn.connected_at);

      // Compute ISO week key (YYYY-Www)
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      const weekKey = `${d.getFullYear()}-S${String(weekNum).padStart(2, '0')}`;

      if (!weeklyMap[weekKey]) weeklyMap[weekKey] = new Set();
      if (conn.user) weeklyMap[weekKey].add(String(conn.user.id));

      // Peak hours
      hourCounts[date.getHours()]++;
    }

    // Sort weeks chronologically and format
    const weeklyConnections = Object.entries(weeklyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, users]) => ({ week, uniquePlayers: users.size, totalConnections: 0 }));

    // Count total connections per week too
    for (const conn of connectionsWithUser) {
      const date = new Date(conn.connected_at);
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      const weekKey = `${d.getFullYear()}-S${String(weekNum).padStart(2, '0')}`;
      const entry = weeklyConnections.find((w) => w.week === weekKey);
      if (entry) entry.totalConnections++;
    }

    // Peak hours (format as array of { hour, label, count })
    const peakHours = Object.entries(hourCounts).map(([hour, count]) => ({
      hour: Number(hour),
      label: `${String(hour).padStart(2, '0')}h`,
      count,
    }));

    return {
      weeklyConnections,
      peakHours,
      totalConnections: connectionsWithUser.length,
    };
  },

  // ─── GDPR ──────────────────────────────────────────────────

  async getGdprRequests() {
    const requests = await strapi.db.query('api::gdpr-request.gdpr-request').findMany({
      orderBy: { createdAt: 'desc' },
      populate: { user: { select: ['id', 'username', 'email'] } },
    });
    return { requests };
  },

  // ─── SOCIAL ────────────────────────────────────────────────

  async getSocialStats() {
    // Player friendships
    const [totalFriendships, pendingRequests, acceptedFriendships, rejectedRequests] = await Promise.all([
      strapi.db.query('api::player-friendship.player-friendship').count(),
      strapi.db.query('api::player-friendship.player-friendship').count({ where: { status: 'pending' } }),
      strapi.db.query('api::player-friendship.player-friendship').count({ where: { status: 'accepted' } }),
      strapi.db.query('api::player-friendship.player-friendship').count({ where: { status: 'rejected' } }),
    ]);

    const acceptanceRate = totalFriendships > 0 ? Math.round((acceptedFriendships / totalFriendships) * 100) : 0;

    // NPC friendships
    const npcFriendships = await strapi.db.query('api::friendship.friendship').findMany({
      select: ['quests_entry_unlocked', 'expedition_entry_unlocked'],
      populate: { npc: { select: ['id', 'firstname', 'lastname', 'nickname', 'quests_entry_available', 'expedition_entry_available'] } },
    });

    const npcProgressMap: Record<number, { name: string; nickname: string; totalFriendships: number; avgQuestProgress: number; avgExpeditionProgress: number }> = {};
    for (const f of npcFriendships) {
      if (!f.npc) continue;
      if (!npcProgressMap[f.npc.id]) {
        npcProgressMap[f.npc.id] = { name: `${f.npc.firstname} ${f.npc.lastname}`, nickname: f.npc.nickname, totalFriendships: 0, avgQuestProgress: 0, avgExpeditionProgress: 0 };
      }
      const entry = npcProgressMap[f.npc.id];
      entry.totalFriendships++;
      const maxQuests = f.npc.quests_entry_available || 1;
      const maxExpeditions = f.npc.expedition_entry_available || 1;
      entry.avgQuestProgress += (f.quests_entry_unlocked || 0) / maxQuests;
      entry.avgExpeditionProgress += (f.expedition_entry_unlocked || 0) / maxExpeditions;
    }

    const npcProgress = Object.values(npcProgressMap).map((n) => ({
      ...n,
      avgQuestProgress: n.totalFriendships > 0 ? Math.round((n.avgQuestProgress / n.totalFriendships) * 100) : 0,
      avgExpeditionProgress: n.totalFriendships > 0 ? Math.round((n.avgExpeditionProgress / n.totalFriendships) * 100) : 0,
    })).sort((a, b) => b.totalFriendships - a.totalFriendships);

    // Most connected players (most accepted friendships)
    const allAccepted = await strapi.db.query('api::player-friendship.player-friendship').findMany({
      where: { status: 'accepted' },
      select: ['id'],
      populate: {
        requester: { select: ['id', 'name'] },
        receiver: { select: ['id', 'name'] },
      },
    });

    const connectionCount: Record<number, { name: string; count: number }> = {};
    for (const f of allAccepted) {
      if (f.requester) {
        if (!connectionCount[f.requester.id]) connectionCount[f.requester.id] = { name: f.requester.name, count: 0 };
        connectionCount[f.requester.id].count++;
      }
      if (f.receiver) {
        if (!connectionCount[f.receiver.id]) connectionCount[f.receiver.id] = { name: f.receiver.name, count: 0 };
        connectionCount[f.receiver.id].count++;
      }
    }
    const mostConnected = Object.values(connectionCount).sort((a, b) => b.count - a.count).slice(0, 10);

    return {
      playerFriendships: { total: totalFriendships, pending: pendingRequests, accepted: acceptedFriendships, rejected: rejectedRequests, acceptanceRate },
      npcProgress,
      mostConnected,
    };
  },
});
