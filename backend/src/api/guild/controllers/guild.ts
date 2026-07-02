/**
 * guild controller
 */

import { factories } from '@strapi/strapi';
import { getUserGuild } from '../../../utils/guild-helpers';

/**
 * Retire récursivement l'attribut `email` de tout objet peuplé dans la réponse guild.
 * Empêche la fuite d'e-mails de tiers via un populate profond piloté par le client
 * (amitiés/badges → guildes d'autrui → user.email). Cf. audit #2.
 * L'e-mail du joueur lui-même reste accessible via /users/me (endpoint non impacté).
 */
function stripPopulatedEmails(node: any): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(stripPopulatedEmails);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === 'email') {
      delete node[key];
    } else if (node[key] && typeof node[key] === 'object') {
      stripPopulatedEmails(node[key]);
    }
  }
}

export default factories.createCoreController('api::guild.guild', ({ strapi }) => ({
  /**
   * Find guilds - for authenticated users, returns only their guild
   */
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    // Sanitize the query parameters first (handles populate, sort, etc.)
    const sanitizedQuery = await this.sanitizeQuery(ctx);

    // user garanti (early-return ci-dessus) : filtrage par utilisateur inconditionnel
    {
      // Force filter by the authenticated user's ID
      // We assume sanitizedQuery.filters is an object (it usually is after sanitization)
      sanitizedQuery.filters = {
        ...(sanitizedQuery.filters as any || {}),
        user: {
          id: user.id
        }
      };
    }

    // Use the Document Service to fetch the data
    const results = await strapi.documents('api::guild.guild').findMany(sanitizedQuery);

    const sanitizedEntity = await this.sanitizeOutput(results, ctx);
    stripPopulatedEmails(sanitizedEntity);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Find one guild - ensures users can only access their own guild
   */
  async findOne(ctx) {
    const user = ctx.state.user;
    const { id } = ctx.params;
    if (!user) return ctx.unauthorized();

    const sanitizedQuery = await this.sanitizeQuery(ctx);

    // user garanti (early-return ci-dessus) : filtrage par utilisateur inconditionnel
    {
      // Force filter by the authenticated user's ID
      sanitizedQuery.filters = {
        ...(sanitizedQuery.filters as any || {}),
        user: {
          id: user.id
        }
      };
    }

    // Use the Document Service to fetch the data
    const document = await strapi.documents('api::guild.guild').findOne({
      documentId: id,
      ...sanitizedQuery,
    });

    if (!document) {
      return ctx.notFound('Guild not found');
    }

    const sanitizedEntity = await this.sanitizeOutput(document, ctx);
    stripPopulatedEmails(sanitizedEntity);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Setup a new guild, character, and starter items
   */
  async setup(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in to create a guild');
    }

    const { guildName, firstname, lastname, iconId } = ctx.request.body;

    if (!guildName || !firstname || !lastname || !iconId) {
      return ctx.badRequest('Missing required fields: guildName, firstname, lastname, iconId');
    }

    // Check if user already has a guild
    const existingGuild = await strapi.db.query('api::guild.guild').findOne({
      where: { user: { id: user.id } },
    });

    if (existingGuild) {
      return ctx.badRequest('User already has a guild');
    }

    // Create Guild
    const newGuild = await strapi.documents('api::guild.guild').create({
      data: {
        name: guildName,
        user: user.id,
        publishedAt: new Date(),
        gold: 0,
        scrap: 0,
        exp: 0,
      },
    });

    // Create Character
    const newCharacter = await strapi.documents('api::character.character').create({
      data: {
        firstname: firstname,
        lastname: lastname,
        guild: newGuild.documentId,
        icon: iconId,
        publishedAt: new Date(),
      },
    });

    // Create starter items using character service
    await strapi.service('api::character.character').createStarterItems(
      newCharacter.documentId,
      newGuild.documentId
    );

    // Return the populated guild
    const finalGuild = await strapi.documents('api::guild.guild').findOne({
      documentId: newGuild.documentId,
      populate: {
        characters: {
            populate: ['icon']
        },
        items: {
            populate: ['icon', 'rarity']
        }
      }
    });

    const sanitizedEntity = await this.sanitizeOutput(finalGuild, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Toggle debug mode for the guild
   */
  async toggleDebugMode(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Strictement réservé aux admins : debug_mode désactive le geofence (anti-triche).
    const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: user.id },
      populate: { role: { select: ['type'] } },
    });
    if (fullUser?.role?.type !== 'admin') {
      return ctx.forbidden('Admin role required');
    }

    // Get user's guild
    const guild = await strapi.db.query('api::guild.guild').findOne({
      where: { user: { id: user.id } },
      select: ['documentId', 'debug_mode']
    });

    if (!guild) {
      return ctx.notFound('Guild not found');
    }

    // Toggle debug mode
    const newDebugMode = !guild.debug_mode;
    const updatedGuild = await strapi.documents('api::guild.guild').update({
      documentId: guild.documentId,
      data: {
        debug_mode: newDebugMode
      }
    });

    const sanitizedEntity = await this.sanitizeOutput(updatedGuild, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Delete guild and all associated data
   */
  async delete(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in to delete a guild');
    }

    const { id } = ctx.params;

    // First, verify that the guild belongs to the user
    const guild = await strapi.db.query('api::guild.guild').findOne({
      where: {
        documentId: id,
        user: { id: user.id }
      },
    });

    if (!guild) {
      return ctx.notFound('Guild not found or you do not have permission to delete it');
    }

    try {
      // Delete all related data using the guild service
      await strapi.service('api::guild.guild').deleteGuildWithRelations(id);

      return ctx.send({
        message: 'Guild and all associated data deleted successfully',
      });
    } catch (error) {
      strapi.log.error('Failed to delete guild:', error);
      return ctx.internalServerError('Failed to delete guild');
    }
  },

  /**
   * Résumé « badges » PUBLIC d'une guilde — visible par les autres joueurs (#54).
   *
   * Cross-joueur VOLONTAIRE (pas de filtre `guild.user`) : c'est le seul endpoint guilde qui
   * expose les données d'un AUTRE joueur, et il ne renvoie QUE les badges (zones complétées +
   * sélection équipée). Il ne fuit jamais or/xp/persos/items → l'invariant d'isolation §I reste
   * respecté (aucune donnée sensible exposée). Le déverrouillage d'un badge = progression
   * `is_completed: true` pour la zone (serveur-autoritatif), jamais une déclaration client.
   */
  async badgeSummary(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { documentId } = ctx.params;
    if (!documentId) return ctx.badRequest('documentId requis');

    const guild = await strapi.db.query('api::guild.guild').findOne({
      where: { documentId },
      select: ['documentId', 'name', 'equipped_badge_ids'],
    });
    if (!guild) return ctx.notFound('Guild not found');

    const progressions = await strapi.documents('api::progression.progression').findMany({
      filters: { guild: { documentId }, is_completed: true },
      populate: {
        comcom: { fields: ['name'] },
        department: { fields: ['name'] },
        region: { fields: ['name'] },
      },
    });

    const completedComcomIds: string[] = [];
    const completedDepartmentIds: string[] = [];
    const completedRegionIds: string[] = [];
    for (const p of progressions) {
      if (p.comcom?.documentId) completedComcomIds.push(p.comcom.documentId);
      if (p.department?.documentId) completedDepartmentIds.push(p.department.documentId);
      if (p.region?.documentId) completedRegionIds.push(p.region.documentId);
    }

    return ctx.send({
      guildName: guild.name,
      equippedBadgeIds: Array.isArray(guild.equipped_badge_ids) ? guild.equipped_badge_ids : [],
      completedComcomIds,
      completedDepartmentIds,
      completedRegionIds,
    });
  },

  /**
   * Met à jour la sélection de badges équipés de la guilde de l'utilisateur courant (max 4).
   *
   * Serveur-autoritatif : on n'accepte d'équiper qu'un badge RÉELLEMENT gagné = une zone dont
   * la progression est `is_completed: true` pour cette guilde (le badge `france` exige que toutes
   * les régions soient complétées). Empêche un client de s'auto-attribuer un badge non mérité.
   * IDs synthétiques attendus : `comcom:{docId}`, `dept:{docId}`, `region:{docId}`, `france`.
   */
  async equipBadges(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { badges } = ctx.request.body ?? {};
    if (!Array.isArray(badges)) return ctx.badRequest("badges doit être un tableau d'IDs");
    if (badges.length > 4) return ctx.badRequest('Maximum 4 badges équipés');
    if (!badges.every((b) => typeof b === 'string')) return ctx.badRequest('IDs de badges invalides');

    const guild = await getUserGuild(strapi, user.id, { select: ['documentId'] });
    if (!guild) return ctx.notFound('Guild not found');

    // Zones réellement complétées (serveur-autoritatif) pour cette guilde.
    const progressions = await strapi.documents('api::progression.progression').findMany({
      filters: { guild: { documentId: guild.documentId }, is_completed: true },
      populate: {
        comcom: { fields: ['name'] },
        department: { fields: ['name'] },
        region: { fields: ['name'] },
      },
    });
    const completed: Record<string, Set<string>> = {
      comcom: new Set(),
      dept: new Set(),
      region: new Set(),
    };
    for (const p of progressions) {
      if (p.comcom?.documentId) completed.comcom.add(p.comcom.documentId);
      if (p.department?.documentId) completed.dept.add(p.department.documentId);
      if (p.region?.documentId) completed.region.add(p.region.documentId);
    }

    // Validation d'ownership de chaque badge demandé (anti-triche).
    for (const id of badges) {
      if (id === 'france') {
        const totalRegions = await strapi.db.query('api::region.region').count();
        if (totalRegions === 0 || completed.region.size < totalRegions) {
          return ctx.badRequest('Badge "france" non débloqué (toutes les régions doivent être complétées)');
        }
        continue;
      }
      const [prefix, zoneDocId] = id.split(':');
      if (!zoneDocId || !completed[prefix] || !completed[prefix].has(zoneDocId)) {
        return ctx.badRequest(`Badge non débloqué ou ID invalide : ${id}`);
      }
    }

    const updated = await strapi.documents('api::guild.guild').update({
      documentId: guild.documentId,
      data: { equipped_badge_ids: badges },
    });

    return ctx.send({ equippedBadgeIds: updated?.equipped_badge_ids ?? badges });
  },
}));