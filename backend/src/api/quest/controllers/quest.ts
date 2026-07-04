/**
 * quest controller
 */

import { factories } from '@strapi/strapi';
import { withAdvisoryLock } from '../../../utils/db-lock';
import { getUserGuild } from '../../../utils/guild-helpers';
import { computeQuestReward, incrementNpcQuestFriendship } from '../../../utils/quest-completion';

export default factories.createCoreController('api::quest.quest', ({ strapi }) => ({
  /**
   * Find quests - restricts to user's guild
   */
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    // user garanti (early-return ci-dessus) : filtrage par guilde inconditionnel
    {
      sanitizedQuery.filters = {
        ...(sanitizedQuery.filters as any || {}),
        guild: {
          user: {
            id: user.id
          }
        }
      };
    }

    const results = await strapi.documents('api::quest.quest').findMany(sanitizedQuery);
    const sanitizedEntity = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Find one quest - restricts to user's guild
   */
  async findOne(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    if (!user) return ctx.unauthorized();
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    // user garanti (early-return ci-dessus) : filtrage par guilde inconditionnel
    {
      sanitizedQuery.filters = {
        ...(sanitizedQuery.filters as any || {}),
        guild: {
          user: {
            id: user.id
          }
        }
      };
    }

    const document = await strapi.documents('api::quest.quest').findOne({
      documentId: id,
      ...sanitizedQuery,
    });

    if (!document) {
      return ctx.notFound('Quest not found');
    }

    const sanitizedEntity = await this.sanitizeOutput(document, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Generate daily quests for the authenticated user's guild.
   * Expects { poiDocumentIds: string[] } in request body.
   * Returns existing quests if already generated today.
   */
  async generateDaily(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('You must be logged in');

    const { poiDocumentIds } = ctx.request.body;
    if (!poiDocumentIds || !Array.isArray(poiDocumentIds) || poiDocumentIds.length < 2) {
      return ctx.badRequest('poiDocumentIds array required (min 2 ids)');
    }

    // Récupérer la guild du joueur
    const guild = await getUserGuild(strapi, user.id, {
      select: ['id', 'documentId'],
    });
    if (!guild) return ctx.notFound('Guild not found');

    const questService = strapi.service('api::quest.quest');

    // Génération sérialisée (#67) : deux appels concurrents (double-tap, double montage de page)
    // ne doivent PAS créer deux jeux de quêtes pour la même guilde le même jour. Le verrou
    // (guild, jour) sérialise le check-then-create ; le second appel voit les quêtes déjà créées
    // par le premier (committées) et renvoie alreadyGenerated. La clé reprend la fenêtre "jour"
    // de getTodayQuestsForGuild (UTC) pour rester cohérente.
    const today = new Date().toISOString().split('T')[0];
    const result = await withAdvisoryLock(
      strapi,
      `daily-quests:${guild.id}:${today}`,
      async () => {
        // Vérifier si des quêtes existent déjà aujourd'hui
        const existingQuests = await questService.getTodayQuestsForGuild(guild.id);
        if (existingQuests.length > 0) {
          return { quests: existingQuests, alreadyGenerated: true as const };
        }

        // Calculer combien de quêtes on peut créer (max 4, limité par les POIs fournis)
        const questCount = Math.min(4, Math.floor(poiDocumentIds.length / 2));

        // Sélectionner les NPCs (logique prioritaire côté back)
        const selectedNpcs = await questService.selectNpcs(guild.id, questCount);
        if (selectedNpcs.length === 0) {
          return { error: 'No NPCs available for quests' as const };
        }

        const actualCount = Math.min(questCount, selectedNpcs.length);
        const npcDocumentIds = selectedNpcs.slice(0, actualCount).map((n: any) => n.documentId);
        const usedPoiIds = poiDocumentIds.slice(0, actualCount * 2);

        // Créer les quêtes
        await questService.createDailyQuests(guild.documentId, npcDocumentIds, usedPoiIds);

        // Retourner les quêtes avec populate
        const populatedQuests = await questService.getTodayQuestsForGuild(guild.id);
        return { quests: populatedQuests, alreadyGenerated: false as const };
      }
    );

    if ('error' in result) {
      return ctx.badRequest(result.error);
    }
    return ctx.send({ data: result.quests, alreadyGenerated: result.alreadyGenerated });
  },

  /**
   * POST /quests/:id/complete — RÉCLAMATION de la quête au PNJ (#audit : la complétion n'existait
   * pas). Le joueur a visité les deux POI (marqués serveur via la géofence d'openChest) et revient
   * au PNJ pour clôturer. On vérifie l'ownership (§IV.1), que les deux POI sont complétés et que la
   * quête n'est pas déjà réclamée, puis on calcule la récompense (distance poi_a↔poi_b, serveur-
   * autoritative), on pose date_end + gold/xp_earned via un CLAIM ATOMIQUE (anti double-crédit sur
   * double-tap), on crédite la guilde atomiquement, et on fait progresser l'amitié avec le PNJ.
   */
  async complete(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const { id } = ctx.params; // documentId

    const guild = await getUserGuild(strapi, user.id, { select: ['id', 'documentId'] });
    if (!guild) return ctx.notFound('Guild not found');

    const quest = await strapi.db.query('api::quest.quest').findOne({
      where: { documentId: id, guild: { id: guild.id } },
      select: ['id', 'documentId', 'is_poi_a_completed', 'is_poi_b_completed', 'date_end'],
      populate: {
        poi_a: { select: ['lat', 'lng'] },
        poi_b: { select: ['lat', 'lng'] },
        npc: { select: ['id', 'documentId', 'quests_entry_available'] },
      },
    });
    if (!quest) return ctx.notFound('Quest not found');
    if (quest.date_end) return ctx.badRequest('Quête déjà réclamée');
    if (!quest.is_poi_a_completed || !quest.is_poi_b_completed) {
      return ctx.badRequest('Les deux POI doivent être visités avant de réclamer la récompense');
    }

    const reward = computeQuestReward((quest as any).poi_a, (quest as any).poi_b);

    // Claim ATOMIQUE de date_end (WHERE date_end IS NULL) : un double-tap ne crédite qu'une fois.
    const claim = await strapi.db.query('api::quest.quest').updateMany({
      where: { id: quest.id, date_end: { $null: true } },
      data: { date_end: new Date(), gold_earned: reward.gold, xp_earned: reward.xp },
    });
    if (!claim || claim.count === 0) {
      return ctx.badRequest('Quête déjà réclamée');
    }

    // Crédit ATOMIQUE de la guilde (SET x = x + delta), comme quiz/expédition/coffre (#12).
    await strapi.db.connection.raw(
      'UPDATE guilds SET gold = gold + ?, exp = exp + ? WHERE document_id = ?',
      [reward.gold, reward.xp, guild.documentId]
    );

    // Progression d'amitié PNJ (best-effort, sans remettre en cause la récompense déjà créditée).
    try {
      await incrementNpcQuestFriendship(strapi, guild, (quest as any).npc);
    } catch (err) {
      strapi.log.warn(`[quest] incrementNpcQuestFriendship a échoué : ${err instanceof Error ? err.message : err}`);
    }

    return ctx.send({ data: { questId: quest.documentId, goldEarned: reward.gold, xpEarned: reward.xp } });
  },
}));
