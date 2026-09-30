/**
 * Sessions users-permissions en mode `refresh` : émission, révocation, journal de connexion.
 *
 * Le mode `refresh` (config/plugins.ts) remplace le JWT de 30 jours par un jeton d'accès de
 * 10 minutes et un jeton de rafraîchissement tournant, révocable côté serveur. Le BFF Nuxt garde
 * les deux dans des cookies httpOnly et renouvelle l'accès en coulisse.
 *
 * Choix non-évidents :
 * - Un `deviceId` par connexion : la déconnexion ne coupe que la session de cet appareil
 *   (`POST /auth/logout` avec ce `deviceId`), pas celles des autres téléphones du joueur.
 * - Le journal de connexion (`connection-log`) ne garde que la date : ni IP ni appareil.
 *
 * @example
 * const tokens = await issueSession(user.id)
 * ctx.send({ ...tokens, user: sanitized })
 */
import crypto from 'node:crypto';

export interface SessionTokens {
  jwt: string;
  refreshToken: string;
  deviceId: string;
}

export async function issueSession(userId: number | string, deviceId?: string): Promise<SessionTokens> {
  const device = deviceId || crypto.randomUUID();
  const manager = strapi.sessionManager('users-permissions');
  const refresh = await manager.generateRefreshToken(String(userId), device, { type: 'refresh' });
  const access = await manager.generateAccessToken(refresh.token);
  if ('error' in access) {
    throw new Error('Failed to generate access token');
  }
  return { jwt: access.token, refreshToken: refresh.token, deviceId: device };
}

/** Coupe toutes les sessions d'un joueur (compte bloqué, supprimé, ou mot de passe réinitialisé). */
export async function revokeAllSessions(userId: number | string): Promise<void> {
  try {
    await strapi.sessionManager('users-permissions').invalidateRefreshToken(String(userId));
  } catch (err) {
    strapi.log.warn(`[sessions] révocation impossible : ${err instanceof Error ? err.message : err}`);
  }
}

export async function logConnection(userId: number): Promise<void> {
  try {
    await strapi.db.query('api::connection-log.connection-log').create({
      data: { user: userId, connected_at: new Date() },
    });
  } catch (err) {
    strapi.log.warn(`Failed to log connection event: ${err instanceof Error ? err.message : err}`);
  }
}
