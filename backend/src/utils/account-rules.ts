/**
 * Règles de compte : ce qu'une inscription doit contenir pour être acceptée.
 *
 * Fonctions pures, sans `strapi` : l'extension users-permissions les appelle, les tests les
 * éprouvent directement. Chaque refus rend un **code** stable (`AccountRuleCode`), jamais un
 * texte : c'est le BFF Nuxt qui le traduit pour l'utilisateur, et un message technique de Strapi
 * n'atteint ainsi jamais l'écran.
 *
 * Choix non-évidents :
 * - Mot de passe : 8 caractères avec au moins une lettre et un chiffre (recommandation CNIL 2022,
 *   combinée à la limitation des tentatives du BFF). Plafond à 72 octets : bcrypt ignore la suite,
 *   un mot de passe plus long donnerait une fausse impression de robustesse.
 * - Âge : 15 ans révolus au jour de l'inscription (majorité numérique en France). Une date future
 *   ou antérieure à 120 ans est une saisie invalide, pas un âge.
 * - Pseudo : 3 à 30 caractères, sans « @ » — Strapi accepte l'e-mail OU le pseudo comme
 *   identifiant de connexion, un pseudo en forme d'adresse créerait une ambiguïté.
 * - `TERMS_VERSION` : à changer à chaque modification substantielle des CGU ou de la politique ;
 *   les comptes dont la version acceptée diffère sont invités à réaccepter à la connexion.
 *
 * Invariant : `parseRegistration` ne renvoie `ok: true` que si **toutes** les règles passent ;
 * les valeurs rendues sont nettoyées (espaces de bord retirés, e-mail en minuscules).
 *
 * @example
 * const result = parseRegistration(ctx.request.body, new Date())
 * if (!result.ok) throw new errors.ValidationError('Inscription refusée', { code: result.code })
 */

export const TERMS_VERSION = '2026-10-01';

/**
 * Entrée en vigueur de la confirmation d'adresse obligatoire. Avant : comptes confirmés d'office
 * (le bootstrap les marque confirmés). Après : lien à suivre, inscription effacée au bout de
 * `UNCONFIRMED_RETENTION_DAYS` sinon. Volontairement **antérieure** au déploiement : une date
 * postérieure ferait confirmer d'office, au redémarrage suivant, des inscriptions jamais vérifiées.
 */
export const EMAIL_CONFIRMATION_SINCE = new Date('2026-09-30T00:00:00Z');
export const UNCONFIRMED_RETENTION_DAYS = 7;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
export const MIN_AGE = 15;
const MAX_AGE = 120;
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const EMAIL_MAX = 254;
const NAME_MAX = 40;

export type AccountRuleCode =
  | 'invalid_body'
  | 'username_invalid'
  | 'email_invalid'
  | 'password_too_short'
  | 'password_too_long'
  | 'password_needs_letter_and_digit'
  | 'birth_date_invalid'
  | 'too_young'
  | 'terms_not_accepted'
  | 'guild_name_invalid'
  | 'character_name_invalid'
  | 'icon_invalid';

export interface GuildSetupInput {
  guildName: string;
  firstname: string;
  lastname: string;
  iconId: number;
}

export interface ProfileInput extends GuildSetupInput {
  username: string;
  dateOfBirth: string;
}

export interface RegistrationInput extends ProfileInput {
  email: string;
  password: string;
}

export type RuleResult<T> = { ok: true; value: T } | { ok: false; code: AccountRuleCode };

// Caractères de contrôle (dont retours à la ligne) : jamais légitimes dans un nom affiché.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function passwordProblem(password: unknown): AccountRuleCode | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return 'password_too_long';
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) return 'password_needs_letter_and_digit';
  return null;
}

/** Âge en années révolues à la date `today` (comparaison sur le calendrier, pas sur 365 jours). */
export function ageAt(birth: Date, today: Date): number {
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export function birthDateProblem(value: unknown, today: Date): AccountRuleCode | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'birth_date_invalid';
  const birth = new Date(`${value}T00:00:00Z`);
  // `new Date('2026-02-31')` roule au 3 mars : on refuse toute date qui ne se relit pas à l'identique.
  if (Number.isNaN(birth.getTime()) || birth.toISOString().slice(0, 10) !== value) return 'birth_date_invalid';
  const age = ageAt(birth, today);
  if (age < 0 || age > MAX_AGE) return 'birth_date_invalid';
  if (age < MIN_AGE) return 'too_young';
  return null;
}

function cleanName(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || CONTROL_CHARS.test(trimmed)) return null;
  return trimmed;
}

export function cleanUsername(value: unknown): string | null {
  const name = cleanName(value, USERNAME_MIN, USERNAME_MAX);
  return name && !name.includes('@') ? name : null;
}

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= EMAIL_MAX && EMAIL_SHAPE.test(email) ? email : null;
}

function cleanIconId(value: unknown): number | null {
  const id = typeof value === 'string' ? Number(value) : value;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

function isRecord(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/** Guilde, personnage et icône : communs à l'inscription par e-mail et à celle par Google. */
export function parseGuildSetup(body: Record<string, unknown>): RuleResult<GuildSetupInput> {
  const guildName = cleanName(body.guildName, 1, NAME_MAX);
  if (!guildName) return { ok: false, code: 'guild_name_invalid' };
  const firstname = cleanName(body.firstname, 1, NAME_MAX);
  const lastname = cleanName(body.lastname, 1, NAME_MAX);
  if (!firstname || !lastname) return { ok: false, code: 'character_name_invalid' };
  const iconId = cleanIconId(body.iconId);
  if (!iconId) return { ok: false, code: 'icon_invalid' };
  return { ok: true, value: { guildName, firstname, lastname, iconId } };
}

/** Profil sans identifiants : ce que l'écran de fin d'inscription Google doit fournir. */
export function parseProfile(body: unknown, today: Date): RuleResult<ProfileInput> {
  if (!isRecord(body)) return { ok: false, code: 'invalid_body' };
  const username = cleanUsername(body.username);
  if (!username) return { ok: false, code: 'username_invalid' };
  const birthProblem = birthDateProblem(body.date_of_birth, today);
  if (birthProblem) return { ok: false, code: birthProblem };
  if (body.terms_accepted !== true) return { ok: false, code: 'terms_not_accepted' };
  const guild = parseGuildSetup(body);
  if (guild.ok === false) return guild;
  return { ok: true, value: { username, dateOfBirth: body.date_of_birth as string, ...guild.value } };
}

/** Inscription complète par e-mail : profil + adresse + mot de passe. */
export function parseRegistration(body: unknown, today: Date): RuleResult<RegistrationInput> {
  if (!isRecord(body)) return { ok: false, code: 'invalid_body' };
  const email = cleanEmail(body.email);
  if (!email) return { ok: false, code: 'email_invalid' };
  const pwdProblem = passwordProblem(body.password);
  if (pwdProblem) return { ok: false, code: pwdProblem };
  const profile = parseProfile(body, today);
  if (profile.ok === false) return profile;
  return { ok: true, value: { ...profile.value, email, password: body.password as string } };
}
