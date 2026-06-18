/**
 * quest controller
 */

import { factories } from '@strapi/strapi';
import { withAdvisoryLock } from '../../../utils/db-lock';

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
    const guild = await strapi.db.query('api::guild.guild').findOne({
      where: { user: { id: user.id } },
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
}));
