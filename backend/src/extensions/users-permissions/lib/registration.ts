/**
 * Inscription : création du compte, de la guilde et du personnage en une seule requête.
 *
 * Remplace `auth.register` de users-permissions. Le joueur reçoit un lien de confirmation et ne
 * peut se connecter qu'après l'avoir suivi (`email_confirmation`, réglé par `ensureAuthSettings`).
 *
 * Choix non-évidents :
 * - **Anti-énumération** : une adresse déjà inscrite reçoit exactement la même réponse qu'une
 *   inscription réussie (`{ pending: true }`), et son titulaire un avertissement par e-mail. Le
 *   pseudo, lui, est public dans le jeu : « pseudo déjà pris » ne révèle rien.
 * - Implémentation propre plutôt qu'un emballage du `register` natif : il faut créer la guilde
 *   **avant** d'envoyer le lien, et tout défaire si l'une des étapes échoue. Le natif envoie le
 *   lien au milieu et ne sait rien de la guilde.
 * - Preuve d'acceptation : date et version des CGU (`TERMS_VERSION`), enregistrées avec le compte.
 *
 * Invariant : un compte ne reste en base que si sa guilde existe et que le lien est parti.
 */
import { errors } from '@strapi/utils';
import { parseRegistration, TERMS_VERSION, type ProfileInput } from '../../../utils/account-rules';
import { sendDuplicateSignupNotice } from './emails';

const { ApplicationError, ValidationError } = errors;
const USER_UID = 'plugin::users-permissions.user';

export function refuse(code: string): never {
  throw new ValidationError('Inscription refusée', { code });
}

/** Une adresse est « prise » si elle sert d'e-mail ou — cas limite hérité — de pseudo. */
export async function emailTaken(email: string): Promise<boolean> {
  const count = await strapi.db.query(USER_UID).count({ where: { $or: [{ email }, { username: email }] } });
  return count > 0;
}

export async function usernameTaken(username: string): Promise<boolean> {
  const count = await strapi.db.query(USER_UID).count({
    where: { $or: [{ username }, { username: username.toLowerCase() }, { email: username.toLowerCase() }] },
  });
  return count > 0;
}

/** Vérifie pseudo et icône, communs aux deux inscriptions ; lève un refus codé sinon. */
export async function checkProfileAvailability(profile: ProfileInput): Promise<void> {
  if (await usernameTaken(profile.username)) {
    throw new ApplicationError('Pseudo déjà pris', { code: 'username_taken' });
  }
  if (!(await strapi.service('api::guild.guild').isCharacterIcon(profile.iconId))) refuse('icon_invalid');
}

async function defaultRoleId(): Promise<number> {
  const advanced = (await strapi.store({ type: 'plugin', name: 'users-permissions' }).get({ key: 'advanced' })) as
    | { default_role?: string; allow_register?: boolean }
    | null;
  if (advanced && advanced.allow_register === false) {
    throw new ApplicationError('Inscription fermée', { code: 'registration_closed' });
  }
  const role = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: advanced?.default_role || 'authenticated' }, select: ['id'] });
  if (!role) throw new ApplicationError('Rôle par défaut introuvable');
  return role.id;
}

/**
 * Crée le compte puis sa guilde ; efface tout si la guilde échoue. `extra` porte ce qui diffère
 * selon la voie d'inscription (mot de passe et `confirmed: false` par e-mail ; `google_sub` et
 * `confirmed: true` par Google).
 */
export async function createAccountWithGuild(
  profile: ProfileInput,
  email: string,
  extra: Record<string, unknown>,
): Promise<{ id: number; email: string }> {
  const user = await strapi.plugin('users-permissions').service('user').add({
    username: profile.username,
    email,
    provider: 'local',
    role: await defaultRoleId(),
    blocked: false,
    date_of_birth: profile.dateOfBirth,
    terms_accepted_at: new Date(),
    terms_version: TERMS_VERSION,
    ...extra,
  });
  try {
    await strapi.service('api::guild.guild').createForUser(user.id, profile);
  } catch (err) {
    await discardAccount(user.id);
    strapi.log.error(`[inscription] guilde non créée, compte retiré : ${err instanceof Error ? err.message : err}`);
    throw new ApplicationError('Inscription impossible', { code: 'registration_failed' });
  }
  return user;
}

export async function discardAccount(userId: number): Promise<void> {
  try {
    await strapi.service('api::user-settings.user-settings').purgeUserData(userId);
  } catch (err) {
    strapi.log.error(`[inscription] nettoyage du compte ${userId} impossible : ${err instanceof Error ? err.message : err}`);
  }
}

/** Contrôleur de `POST /auth/local/register`. */
export async function register(ctx): Promise<void> {
  const parsed = parseRegistration(ctx.request.body, new Date());
  if (parsed.ok === false) refuse(parsed.code);
  const input = parsed.value;

  if (await emailTaken(input.email)) {
    await sendDuplicateSignupNotice(input.email);
    ctx.send({ pending: true });
    return;
  }
  await checkProfileAvailability(input);

  const user = await createAccountWithGuild(input, input.email, { password: input.password, confirmed: false });
  try {
    await strapi.plugin('users-permissions').service('user').sendConfirmationEmail(user);
  } catch (err) {
    await discardAccount(user.id);
    strapi.log.error(`[inscription] lien de confirmation non envoyé, compte retiré : ${err instanceof Error ? err.message : err}`);
    throw new ApplicationError('Inscription impossible', { code: 'registration_failed' });
  }
  ctx.send({ pending: true });
}
