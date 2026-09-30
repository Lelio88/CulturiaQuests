/**
 * Extension du plugin users-permissions : les règles de compte de CulturiaQuests.
 *
 * - `auth.register` : remplacé par `lib/registration.ts` (compte + guilde + lien de confirmation,
 *   réponse identique si l'adresse est déjà prise).
 * - `auth.callback` : journal de connexion (date seule) après une connexion réussie.
 * - `auth.resetPassword` / `auth.changePassword` : même règle de mot de passe qu'à l'inscription.
 * - `auth.googleSignIn` / `auth.googleRegister` : connexion Google de l'app Android (`lib/google.ts`).
 * - `user.meWithRole` : l'utilisateur courant avec son rôle, et `terms_outdated` quand la version
 *   des CGU acceptée n'est plus la courante.
 * - `user.acceptTerms` : enregistre l'acceptation (date + version) des CGU courantes.
 *
 * Les sessions sont en mode `refresh` (config/plugins.ts) : `lib/sessions.ts` les émet pour les
 * routes ajoutées ici, le natif pour les autres.
 *
 * Piège : dans Strapi 5, `plugin.controllers.auth` est une **fabrique** (`({ strapi }) => ({…})`),
 * alors que `plugin.controllers.user` est un objet. Poser une méthode sur la fabrique n'a aucun
 * effet — c'est ainsi que l'ancien journal de connexion et le contrôle d'âge ne tournaient pas.
 * On remplace donc la fabrique par une autre, qui enveloppe le contrôleur d'origine.
 */
import { errors } from '@strapi/utils';
import { passwordProblem, TERMS_VERSION } from '../../utils/account-rules';
import { register } from './lib/registration';
import { googleRegister, googleSignIn } from './lib/google';
import { issueSession, logConnection, revokeAllSessions } from './lib/sessions';

const { ValidationError } = errors;
const USER_UID = 'plugin::users-permissions.user';

function enforcePasswordRule(password: unknown): void {
  const problem = passwordProblem(password);
  if (problem) throw new ValidationError('Mot de passe refusé', { code: problem });
}

export default (plugin) => {
  const originalAuth = plugin.controllers.auth;
  plugin.controllers.auth = (deps) => {
    const auth = typeof originalAuth === 'function' ? originalAuth(deps) : originalAuth;
    return {
      ...auth,

      async callback(ctx) {
        await auth.callback(ctx);
        if (ctx.body && ctx.body.jwt && ctx.body.user) {
          await logConnection(ctx.body.user.id);
        }
      },

      register,

      async resetPassword(ctx) {
        enforcePasswordRule(ctx.request.body?.password);
        // Le schéma natif refuse toute clé inconnue : on retire `deviceId` avant de l'appeler, et
        // on rouvre ensuite la session sur cet appareil (sinon la déconnexion ne saurait pas
        // laquelle couper).
        const deviceId = typeof ctx.request.body?.deviceId === 'string' ? ctx.request.body.deviceId : undefined;
        if (ctx.request.body) delete ctx.request.body.deviceId;
        const code = ctx.request.body?.code;
        const target = typeof code === 'string' && code
          ? await strapi.db.query(USER_UID).findOne({ where: { resetPasswordToken: code }, select: ['id', 'confirmed'] })
          : null;
        await auth.resetPassword(ctx);
        if (deviceId && ctx.body?.user?.id && ctx.body.refreshToken) {
          // La réinitialisation a déjà coupé toutes les sessions et en a ouvert une, anonyme :
          // on la remplace par une session rattachée à l'appareil.
          await revokeAllSessions(ctx.body.user.id);
          const tokens = await issueSession(ctx.body.user.id, deviceId);
          ctx.body = { ...ctx.body, jwt: tokens.jwt, refreshToken: tokens.refreshToken };
        }
        // Suivre le lien reçu par e-mail prouve la maîtrise de l'adresse : un compte encore non
        // confirmé l'est désormais (sinon la connexion suivante le refuserait).
        if (target && target.confirmed !== true) {
          await strapi.db.query(USER_UID).update({
            where: { id: target.id },
            data: { confirmed: true, confirmationToken: null },
          });
        }
      },

      async changePassword(ctx) {
        enforcePasswordRule(ctx.request.body?.password);
        await auth.changePassword(ctx);
      },

      googleSignIn,
      googleRegister,
    };
  };

  // /users/me natif retire ?populate=role au sanitizeQuery → user.role.type revient undefined, ce
  // qui casse les checks admin côté front (useAdmin, desktop guard). On requête l'utilisateur avec
  // son rôle, puis on ne garde que les champs utiles au front (liste blanche).
  plugin.controllers.user.meWithRole = async (ctx) => {
    if (!ctx.state.user) return ctx.unauthorized();

    const user = await strapi.db.query(USER_UID).findOne({
      where: { id: ctx.state.user.id },
      populate: { role: { select: ['id', 'name', 'type'] } },
    });
    if (!user) return ctx.notFound();

    ctx.body = {
      id: user.id,
      documentId: user.documentId,
      username: user.username,
      email: user.email,
      confirmed: user.confirmed,
      blocked: user.blocked,
      date_of_birth: user.date_of_birth,
      friend_requests_enabled: user.friend_requests_enabled,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      terms_outdated: user.terms_version !== TERMS_VERSION,
      // Version à renvoyer par l'écran de réacceptation (une seule source : ce serveur).
      terms_current_version: TERMS_VERSION,
      google_linked: Boolean(user.google_sub),
    };
  };

  plugin.controllers.user.acceptTerms = async (ctx) => {
    if (!ctx.state.user) return ctx.unauthorized();
    if (ctx.request.body?.version !== TERMS_VERSION) {
      throw new ValidationError('Version des CGU inattendue', { code: 'terms_version_mismatch' });
    }
    await strapi.db.query(USER_UID).update({
      where: { id: ctx.state.user.id },
      data: { terms_accepted_at: new Date(), terms_version: TERMS_VERSION },
    });
    ctx.body = { ok: true, version: TERMS_VERSION };
  };

  const rateLimited = { prefix: '', middlewares: ['plugin::users-permissions.rateLimit'] };
  plugin.routes['content-api'].routes.unshift(
    { method: 'GET', path: '/users/me-with-role', handler: 'user.meWithRole', config: { prefix: '', policies: [] } },
    { method: 'POST', path: '/users/me/accept-terms', handler: 'user.acceptTerms', config: { prefix: '', policies: [] } },
    // `auth: false` : routes publiques par nature (aucun joueur connecté), comme le login natif.
    { method: 'POST', path: '/auth/google', handler: 'auth.googleSignIn', config: { ...rateLimited, auth: false } },
    { method: 'POST', path: '/auth/google/register', handler: 'auth.googleRegister', config: { ...rateLimited, auth: false } },
  );

  return plugin;
};
