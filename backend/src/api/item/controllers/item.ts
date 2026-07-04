/**
 * item controller
 */

import { factories } from '@strapi/strapi';
import { getUserGuild } from '../../../utils/guild-helpers';
import { calculateScrapForOneItem, getCumulativeUpgradeCost } from '../../../utils/item-formulas';

export default factories.createCoreController('api::item.item', ({ strapi }) => ({
  /**
   * Find items - restricts to user's guild
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

    const results = await strapi.documents('api::item.item').findMany(sanitizedQuery);
    const sanitizedEntity = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Find one item - restricts to user's guild
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

    const document = await strapi.documents('api::item.item').findOne({
      documentId: id,
      ...sanitizedQuery,
    });

    if (!document) {
      return ctx.notFound('Item not found');
    }

    const sanitizedEntity = await this.sanitizeOutput(document, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Recyclage SERVEUR-AUTORITATIF (#audit HIGH#1). Le client n'envoie QUE les documentId à recycler ;
   * le scrap gagné est calculé côté serveur (jamais fourni par le client → plus de triche). Chaque
   * item est vérifié comme appartenant à la guilde de l'utilisateur (isolation §IV.1), non déjà
   * recyclé. Crédit du scrap ATOMIQUE (SET scrap = scrap + ?) — pas de read-modify-write (#12).
   */
  async recycle(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const body = (ctx.request.body || {}) as { itemIds?: unknown; data?: { itemIds?: unknown } };
    const rawIds = body.itemIds ?? body.data?.itemIds;
    const itemIds = Array.isArray(rawIds) ? rawIds.filter((v): v is string => typeof v === 'string') : [];
    if (itemIds.length === 0) return ctx.badRequest('itemIds (documentId[]) requis');

    const guild = await getUserGuild(strapi, user.id, { select: ['id', 'documentId'] });
    if (!guild) return ctx.notFound('Guild not found');

    // Ownership + non-déjà-recyclés : ne remonte QUE les items recyclables de CETTE guilde.
    const items = await strapi.db.query('api::item.item').findMany({
      where: { documentId: { $in: itemIds }, guild: { id: guild.id }, isScrapped: { $ne: true } },
      select: ['id', 'documentId', 'level', 'index_damage'],
      populate: { rarity: { select: ['name'] } },
    });
    if (items.length === 0) return ctx.badRequest('Aucun item recyclable');

    const totalScrap = items.reduce(
      (sum, it) => sum + calculateScrapForOneItem({ level: it.level, index_damage: it.index_damage, rarity: it.rarity?.name }),
      0
    );

    for (const it of items) {
      await strapi.documents('api::item.item').update({
        documentId: it.documentId,
        data: { isScrapped: true, character: null },
      });
    }

    await strapi.db.connection.raw(
      'UPDATE guilds SET scrap = scrap + ? WHERE document_id = ?',
      [totalScrap, guild.documentId]
    );

    return ctx.send({ data: { recycledCount: items.length, scrapGained: totalScrap } });
  },

  /**
   * Amélioration SERVEUR-AUTORITATIVE (#audit HIGH#1). Le client envoie l'item + le NOMBRE de niveaux
   * souhaités ; le coût (or + scrap) est calculé côté serveur (barème item-formulas), la solvabilité
   * vérifiée, puis le débit est ATOMIQUE et CONDITIONNEL (WHERE gold >= ? AND scrap >= ?) → jamais de
   * solde négatif ni de coût arbitraire fourni par le client. Ownership vérifié (§IV.1).
   */
  async upgrade(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const body = (ctx.request.body || {}) as { itemId?: unknown; levels?: unknown; data?: { itemId?: unknown; levels?: unknown } };
    const itemId = (typeof body.itemId === 'string' ? body.itemId : body.data?.itemId) as string | undefined;
    const rawLevels = body.levels ?? body.data?.levels;
    const levels = Math.min(1000, Math.max(1, Math.floor(Number(rawLevels) || 1)));
    if (!itemId) return ctx.badRequest('itemId (documentId) requis');

    const guild = await getUserGuild(strapi, user.id, { select: ['id', 'documentId', 'gold', 'scrap'] });
    if (!guild) return ctx.notFound('Guild not found');

    // Ownership : l'item doit appartenir à la guilde de l'utilisateur.
    const item = await strapi.db.query('api::item.item').findOne({
      where: { documentId: itemId, guild: { id: guild.id } },
      select: ['id', 'documentId', 'level', 'index_damage'],
      populate: { rarity: { select: ['name'] } },
    });
    if (!item) return ctx.notFound('Item not found');

    const currentLevel = item.level || 1;
    const cost = getCumulativeUpgradeCost(currentLevel, levels, item.rarity?.name, item.index_damage || 0);

    // Pré-check solvabilité (cas courant) puis débit ATOMIQUE conditionnel (couvre la concurrence).
    if ((guild.gold || 0) < cost.gold || (guild.scrap || 0) < cost.scrap) {
      return ctx.badRequest('Or/scrap insuffisant');
    }
    const res = (await strapi.db.connection.raw(
      'UPDATE guilds SET gold = gold - ?, scrap = scrap - ? WHERE document_id = ? AND gold >= ? AND scrap >= ?',
      [cost.gold, cost.scrap, guild.documentId, cost.gold, cost.scrap]
    )) as { rowCount?: number };
    // Postgres (knex) : rowCount = lignes affectées. 0 → une dépense concurrente a vidé le solde
    // entre le pré-check et le débit ; le WHERE conditionnel a bloqué → aucun débit, on refuse.
    if (!res?.rowCount) return ctx.badRequest('Or/scrap insuffisant');

    const newLevel = currentLevel + levels;
    await strapi.documents('api::item.item').update({
      documentId: item.documentId,
      data: { level: newLevel },
    });

    return ctx.send({ data: { itemId: item.documentId, newLevel, costGold: cost.gold, costScrap: cost.scrap } });
  },

  /**
   * Get item icons from media library
   * Filters image files from "weapons", "helmets", and "charms" folders
   */
  async getItemIcons(ctx) {
    try {
      // Find the folders
      const folders = await strapi.db.query('plugin::upload.folder').findMany({
        where: { 
          name: { $in: ['weapons', 'helmets', 'charms'] } 
        },
        select: ['id'],
      });

      if (!folders || folders.length === 0) {
        return ctx.send({
          data: [],
          meta: { total: 0 },
        });
      }

      const folderIds = folders.map(f => f.id);

      // Get files in those folders
      const files = await strapi.db.query('plugin::upload.file').findMany({
        where: {
          folder: { id: { $in: folderIds } },
          mime: { $startsWith: 'image/' },
        },
        select: ['id', 'documentId', 'name', 'url', 'width', 'height'],
        orderBy: { name: 'asc' },
      });

      return ctx.send({
        data: files,
        meta: { total: files.length },
      });
    } catch (error) {
      strapi.log.error('Error fetching item icons:', error);
      return ctx.internalServerError('Failed to fetch item icons');
    }
  },
}));
