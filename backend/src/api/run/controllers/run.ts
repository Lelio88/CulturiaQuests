/**
 * run controller
 */

import { factories } from '@strapi/strapi';
import { getUserGuild } from '../../../utils/guild-helpers';
import { RunServiceError } from '../services/run';

/**
 * Mappe une RunServiceError (levée par le service, #40) vers la réponse HTTP appropriée,
 * en préservant message + details. Toute autre erreur est relancée (→ 500 Strapi).
 */
function mapRunError(ctx: any, e: unknown) {
  if (e instanceof RunServiceError) {
    if (e.status === 404) return ctx.notFound(e.message);
    if (e.status === 403) return ctx.forbidden(e.message);
    return ctx.badRequest(e.message, e.details);
  }
  throw e;
}

export default factories.createCoreController('api::run.run', ({ strapi }) => ({
  /**
   * Find runs - restricts to user's guild
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

    const results = await strapi.documents('api::run.run').findMany(sanitizedQuery);
    const sanitizedEntity = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Find one run - restricts to user's guild
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

    const document = await strapi.documents('api::run.run').findOne({
      documentId: id,
      ...sanitizedQuery,
    });

    if (!document) {
      return ctx.notFound('Run not found');
    }

    const sanitizedEntity = await this.sanitizeOutput(document, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Démarre une expédition. Délègue toute la logique métier au service (#40) ;
   * ne garde que l'auth et le mapping d'erreurs.
   */
  async startExpedition(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    try {
      return await strapi.service('api::run.run').startExpedition(user.id, ctx.request.body);
    } catch (e) {
      return mapRunError(ctx, e);
    }
  },

  /**
   * Termine une expédition. Délègue au service (claim atomique + crédit atomique #62 inclus) ;
   * ne garde que l'auth et le mapping d'erreurs.
   */
  async endExpedition(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    try {
      return await strapi.service('api::run.run').endExpedition(user.id, ctx.request.body?.runDocumentId);
    } catch (e) {
      return mapRunError(ctx, e);
    }
  },

  async getActiveRun(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const guild = await getUserGuild(strapi, user.id, {
      select: ['documentId']
    });

    if (!guild) return null;

    const activeRuns = await strapi.documents('api::run.run').findMany({
      filters: {
        guild: { documentId: guild.documentId },
        date_end: { $null: true }
      },
      limit: 1,
      populate: ['museum', 'npc']
    });

    return activeRuns.length > 0 ? activeRuns[0] : null;
  }
}));
