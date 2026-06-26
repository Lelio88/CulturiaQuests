/**
 * progression controller
 */

import { factories } from '@strapi/strapi'
import { getUserGuild } from '../../../utils/guild-helpers'

export default factories.createCoreController('api::progression.progression', ({ strapi }) => ({
  /**
   * Find progressions - restricts to user's guild
   */
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    // user garanti (early-return ci-dessus) : filtrage par guilde inconditionnel
    {
      const userGuild = await getUserGuild(strapi, user.id, {
        select: ['documentId'],
      });

      if (!userGuild) {
        return { data: [], meta: { pagination: { page: 1, pageSize: 25, pageCount: 0, total: 0 } } };
      }

      sanitizedQuery.filters = {
        ...(sanitizedQuery.filters as any || {}),
        guild: {
          documentId: userGuild.documentId
        }
      };
    }

    const results = await strapi.documents('api::progression.progression').findMany(sanitizedQuery);
    const sanitizedEntity = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Find one progression - restricts to user's guild
   */
  async findOne(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    if (!user) return ctx.unauthorized();
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    // user garanti (early-return ci-dessus) : filtrage par guilde inconditionnel
    {
      const userGuild = await getUserGuild(strapi, user.id, {
        select: ['documentId'],
      });

      if (!userGuild) {
        return ctx.notFound('Guild not found for user');
      }

      sanitizedQuery.filters = {
        ...(sanitizedQuery.filters as any || {}),
        guild: {
          documentId: userGuild.documentId
        }
      };
    }

    const document = await strapi.documents('api::progression.progression').findOne({
      documentId: id,
      ...sanitizedQuery,
    });

    if (!document) {
      return ctx.notFound('Progression not found');
    }

    const sanitizedEntity = await this.sanitizeOutput(document, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Create progression - ensures it's assigned to user's guild
   */
  async create(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized('You must be logged in to create a progression');
    }

    const userGuild = await getUserGuild(strapi, user.id, {
      select: ['documentId'],
    });

    if (!userGuild) {
      return ctx.badRequest('You must have a guild to create a progression');
    }

    const { data } = ctx.request.body;

    // Anti-triche (#54 phase 2) : la complétion est décidée par le SERVEUR (visites vérifiées,
    // cf. utils/comcom-completion), jamais par le client. On ignore tout `is_completed` fourni et
    // on force `false`. Idempotent par (guilde, comcom) : pas de progression dupliquée — un doublon
    // is_completed corromprait le compteur d'enfants du cascade département/région.
    const safeData: Record<string, any> = { ...(data ?? {}) };
    delete safeData.is_completed;

    if (safeData.comcom) {
      const existingProgression = await strapi.db.query('api::progression.progression').findOne({
        where: { guild: { documentId: userGuild.documentId }, comcom: { documentId: safeData.comcom } },
        select: ['documentId'],
      });
      if (existingProgression) {
        const current = await strapi.documents('api::progression.progression').findOne({
          documentId: existingProgression.documentId,
        });
        return this.transformResponse(await this.sanitizeOutput(current, ctx));
      }
    }

    const entity = await strapi.documents('api::progression.progression').create({
      data: { ...safeData, guild: userGuild.documentId, is_completed: false },
    });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Update progression - only allow for user's own guild
   */
  async update(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in to update a progression');
    }

    const userGuild = await getUserGuild(strapi, user.id, {
      select: ['documentId'],
    });

    if (!userGuild) {
      return ctx.badRequest('You must have a guild');
    }

    // Verify the progression belongs to the user's guild
    const existing = await strapi.documents('api::progression.progression').findOne({
      documentId: id,
      populate: ['guild'],
    });

    if (!existing || existing.guild?.documentId !== userGuild.documentId) {
      return ctx.notFound('Progression not found');
    }

    const { data } = ctx.request.body;

    // Anti-triche (#54 phase 2) : `is_completed` ne peut pas être modifié par le client (la
    // complétion est serveur-autoritative — cf. utils/comcom-completion).
    const safeData: Record<string, any> = { ...(data ?? {}) };
    delete safeData.is_completed;

    const entity = await strapi.documents('api::progression.progression').update({
      documentId: id,
      data: safeData,
    });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Delete progression - only allow for user's own guild
   */
  async delete(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;

    if (!user) {
      return ctx.unauthorized('You must be logged in to delete a progression');
    }

    const userGuild = await getUserGuild(strapi, user.id, {
      select: ['documentId'],
    });

    if (!userGuild) {
      return ctx.badRequest('You must have a guild');
    }

    // Verify the progression belongs to the user's guild
    const existing = await strapi.documents('api::progression.progression').findOne({
      documentId: id,
      populate: ['guild'],
    });

    if (!existing || existing.guild?.documentId !== userGuild.documentId) {
      return ctx.notFound('Progression not found');
    }

    await strapi.documents('api::progression.progression').delete({
      documentId: id,
    });

    return ctx.send({ message: 'Progression deleted successfully' });
  },
}));
