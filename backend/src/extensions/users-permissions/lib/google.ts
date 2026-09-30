/**
 * Connexion avec Google depuis l'application Android (Credential Manager → jeton d'identité).
 *
 * Deux routes, appelées par le BFF Nuxt :
 * - `POST /auth/google` { idToken } : compte connu → session ; adresse inconnue → jeton
 *   d'inscription (`onboardingToken`, 15 min) pour l'écran de fin d'inscription.
 * - `POST /auth/google/register` { onboardingToken, pseudo, date de naissance, CGU, guilde… } :
 *   crée le compte (adresse déjà vérifiée par Google, donc confirmé) puis ouvre la session.
 *
 * Choix non-évidents :
 * - **Liaison automatique à même adresse** (comme DeckHand) : Google a vérifié l'adresse, le
 *   compte existant la porte. On retient ensuite le `sub` Google, stable même si l'adresse change.
 * - Si le compte trouvé n'avait **jamais confirmé** son adresse, quelqu'un d'autre a pu le créer
 *   avec l'adresse du joueur : on efface son mot de passe en le liant, pour que ce tiers perde
 *   l'accès (le vrai titulaire peut en choisir un par « Mot de passe oublié »).
 * - Aucun compte n'est créé avant l'écran de fin d'inscription : le contrôle d'âge et
 *   l'acceptation des CGU ont lieu avant, et un abandon ne laisse pas de compte fantôme.
 * - Le jeton d'inscription est signé (HMAC) avec une clé dérivée de `JWT_SECRET` : aucun
 *   secret de plus à déployer. Il ne porte que `sub` et l'adresse, jamais de session.
 *
 * Invariant : aucune identité Google n'est crue sans `verifyGoogleIdToken` (signature, audience,
 * adresse vérifiée).
 */
import crypto from 'node:crypto';
import { errors } from '@strapi/utils';
import { createGoogleVerifier, GoogleTokenError } from '../../../utils/google-id-token';
import { parseProfile } from '../../../utils/account-rules';
import { checkProfileAvailability, createAccountWithGuild, emailTaken, refuse } from './registration';
import { issueSession, logConnection } from './sessions';

const { ApplicationError, UnauthorizedError } = errors;
const USER_UID = 'plugin::users-permissions.user';
const ONBOARDING_TTL_SECONDS = 15 * 60;

/**
 * ID du client **Web** du projet Google Cloud « CulturiaQuests » : public, c'est l'audience
 * attendue des jetons (l'app Android le passe à Credential Manager comme `serverClientId`).
 * Doit rester égal à `googleWebClientId` de `frontend/nuxt.config.ts`. `GOOGLE_WEB_CLIENT_ID`
 * le remplace pour un autre projet Google Cloud (essais).
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.GOOGLE_WEB_CLIENT_ID || '1087365705292-su8t603pcte3aq89b42bgnummabuna4k.apps.googleusercontent.com';

const verifyGoogleIdToken = createGoogleVerifier({ audience: GOOGLE_WEB_CLIENT_ID });

function onboardingKey(): Buffer {
  const secret = strapi.config.get('plugin::users-permissions.jwtSecret') as string;
  return crypto.createHash('sha256').update(`google-onboarding:${secret}`).digest();
}

function signOnboarding(sub: string, email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ sub, email, exp: Math.floor(Date.now() / 1000) + ONBOARDING_TTL_SECONDS }),
  ).toString('base64url');
  const mac = crypto.createHmac('sha256', onboardingKey()).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function readOnboarding(token: unknown): { sub: string; email: string } {
  if (typeof token !== 'string' || token.length > 2048) throw new UnauthorizedError('Jeton invalide');
  const [payload, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', onboardingKey()).update(payload ?? '').digest();
  const given = Buffer.from(mac ?? '', 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new UnauthorizedError('Jeton invalide');
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) throw new UnauthorizedError('Jeton expiré');
  return { sub: String(data.sub), email: String(data.email) };
}

async function verifyOrReject(idToken: unknown) {
  try {
    return await verifyGoogleIdToken(idToken);
  } catch (err) {
    const reason = err instanceof GoogleTokenError ? err.message : 'unexpected';
    strapi.log.warn(`[google] jeton refusé : ${reason}`);
    if (reason === 'no_audience_configured' || reason.startsWith('certs_')) {
      throw new ApplicationError('Connexion Google indisponible', { code: 'google_unavailable' });
    }
    throw new UnauthorizedError('Jeton Google invalide');
  }
}

async function sessionResponse(ctx, userId: number) {
  const tokens = await issueSession(userId);
  await logConnection(userId);
  const user = await strapi.db.query(USER_UID).findOne({ where: { id: userId }, select: ['id', 'username', 'email'] });
  ctx.send({ ...tokens, user });
}

/** Contrôleur de `POST /auth/google`. */
export async function googleSignIn(ctx): Promise<void> {
  const identity = await verifyOrReject(ctx.request.body?.idToken);

  const user =
    (await strapi.db.query(USER_UID).findOne({ where: { google_sub: identity.sub } })) ??
    (await strapi.db.query(USER_UID).findOne({ where: { email: identity.email } }));

  if (!user) {
    ctx.send({ onboardingToken: signOnboarding(identity.sub, identity.email), email: identity.email });
    return;
  }
  if (user.blocked) throw new ApplicationError('Compte bloqué', { code: 'account_blocked' });
  // Compte déjà lié à un AUTRE compte Google de même adresse (adresse recyclée d'un domaine
  // professionnel, par exemple) : on ne remplace pas une liaison en silence.
  if (user.google_sub && user.google_sub !== identity.sub) {
    throw new ApplicationError('Compte lié à un autre compte Google', { code: 'google_account_mismatch' });
  }

  const link: Record<string, unknown> = {};
  if (user.google_sub !== identity.sub) link.google_sub = identity.sub;
  if (user.confirmed !== true) {
    link.confirmed = true;
    link.password = null;
    link.confirmationToken = null;
  }
  if (Object.keys(link).length > 0) {
    await strapi.db.query(USER_UID).update({ where: { id: user.id }, data: link });
  }
  await sessionResponse(ctx, user.id);
}

/** Contrôleur de `POST /auth/google/register`. */
export async function googleRegister(ctx): Promise<void> {
  const identity = readOnboarding(ctx.request.body?.onboardingToken);
  const parsed = parseProfile(ctx.request.body, new Date());
  if (parsed.ok === false) refuse(parsed.code);

  // Entre-temps, l'adresse a pu être inscrite par ailleurs : on renvoie alors vers la connexion.
  const subTaken = await strapi.db.query(USER_UID).count({ where: { google_sub: identity.sub } });
  if (subTaken > 0 || (await emailTaken(identity.email))) {
    throw new ApplicationError('Compte déjà existant', { code: 'account_exists' });
  }
  await checkProfileAvailability(parsed.value);

  const user = await createAccountWithGuild(parsed.value, identity.email, {
    google_sub: identity.sub,
    confirmed: true,
  });
  await sessionResponse(ctx, user.id);
}
