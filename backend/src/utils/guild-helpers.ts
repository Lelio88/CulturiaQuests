import type { Core } from '@strapi/strapi';

/**
 * Récupère la guilde d'un utilisateur via la relation `guild.user` (1 guilde par user).
 *
 * Helper UNIQUE pour le lookup guilde-par-utilisateur, réimplémenté inline dans ~25 controllers/
 * services. Centraliser évite la dérive du format de filtre relation (`{ user: { id } }` vs le
 * raccourci `{ user: user.id }`) et garantit un point unique pour l'invariant d'isolation par
 * utilisateur (garde-fou I du CLAUDE.md). **NE PAS modifier le filtre `where: { user: { id } }`** :
 * c'est ce qui empêche les fuites cross-tenant.
 *
 * @param userId  id numérique de l'utilisateur authentifié (ctx.state.user.id).
 * @param options `select` (colonnes scalaires) et/ou `populate` (relations). Si aucun n'est fourni,
 *                renvoie `['id', 'documentId']` par défaut. Chaque appelant conserve son propre
 *                `select`/`populate` via ce paramètre.
 *
 * @example
 * const guild = await getUserGuild(strapi, user.id, { select: ['id', 'documentId', 'gold'] })
 * if (!guild) return ctx.notFound('Guild not found')
 */
export async function getUserGuild(
  strapi: Core.Strapi,
  userId: number,
  options: { select?: string[]; populate?: unknown } = {}
) {
  const query: Record<string, unknown> = { where: { user: { id: userId } } };
  if (options.select) query.select = options.select;
  if (options.populate) query.populate = options.populate;
  if (!options.select && !options.populate) query.select = ['id', 'documentId'];
  return strapi.db.query('api::guild.guild').findOne(query);
}
