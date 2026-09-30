/**
 * Garde-fous communs aux routes `/api/auth/*` du BFF : limitation des tentatives, durée
 * minimale de réponse, contrôle d'origine, traduction des erreurs de Strapi.
 *
 * Choix non-évidents :
 * - **Durée minimale** (`withMinimumDuration`) : Strapi répond vite pour un compte inconnu et
 *   lentement pour un mot de passe faux (bcrypt). Sans plancher, le temps de réponse révélerait
 *   quelles adresses ont un compte (guide §C2 « réponses indiscernables »).
 * - **Codes, pas de textes** : Strapi renvoie un `details.code` (règles de compte) ou un message
 *   anglais connu ; seul `AUTH_MESSAGES` parle au joueur. Tout le reste devient « Une erreur est
 *   survenue » — aucun texte brut du serveur n'atteint l'écran.
 * - **Origine** : les routes d'authentification posent des cookies ; on exige qu'elles soient
 *   appelées par le site lui-même (Sec-Fetch-Site, repli Origin/Host), comme le proxy. Sans aucun
 *   des deux en-têtes, la mutation est refusée : tout navigateur actuel (WebView comprise) en
 *   envoie au moins un, et un silence ne doit pas valoir autorisation.
 */
import type { H3Event } from 'h3'

export const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Identifiant ou mot de passe incorrect.',
  email_not_confirmed: 'Confirmez d’abord votre adresse : suivez le lien reçu par e-mail.',
  account_blocked: 'Ce compte est suspendu.',
  too_many_attempts: 'Trop de tentatives. Réessayez dans quelques minutes.',
  invalid_body: 'Formulaire incomplet.',
  username_invalid: 'Le pseudo doit faire 3 à 30 caractères, sans « @ ».',
  email_invalid: 'Adresse e-mail invalide.',
  password_too_short: 'Le mot de passe doit contenir au moins 8 caractères.',
  password_too_long: 'Le mot de passe est trop long (72 caractères au plus).',
  password_needs_letter_and_digit: 'Le mot de passe doit contenir au moins une lettre et un chiffre.',
  birth_date_invalid: 'Date de naissance invalide.',
  too_young: 'Vous devez avoir au moins 15 ans pour vous inscrire.',
  terms_not_accepted: 'Vous devez accepter les conditions générales d’utilisation.',
  guild_name_invalid: 'Le nom de guilde doit faire 1 à 40 caractères.',
  character_name_invalid: 'Le prénom et le nom du personnage doivent faire 1 à 40 caractères.',
  icon_invalid: 'Choisissez une icône pour votre personnage.',
  username_taken: 'Ce pseudo est déjà pris.',
  registration_failed: 'L’inscription n’a pas pu aboutir. Réessayez dans un instant.',
  registration_closed: 'Les inscriptions sont fermées pour le moment.',
  account_exists: 'Un compte existe déjà avec cette adresse : reconnectez-vous avec Google.',
  google_unavailable: 'La connexion Google est momentanément indisponible.',
  google_invalid: 'La connexion Google a échoué. Réessayez.',
  google_account_mismatch: 'Ce compte est déjà lié à un autre compte Google.',
  onboarding_expired: 'Le délai est dépassé : reprenez la connexion avec Google.',
  reset_link_invalid: 'Lien de réinitialisation invalide ou expiré.',
  confirmation_link_invalid: 'Ce lien de confirmation n’est plus valable. Connectez-vous, ou demandez-en un nouveau.',
  terms_version_mismatch: 'Les conditions ont changé entre-temps : rechargez la page.',
  unavailable: 'Service momentanément indisponible. Réessayez dans un instant.',
  unknown: 'Une erreur est survenue.',
}

/** Erreur destinée au navigateur : statut, code stable et message en français. */
export function authError(statusCode: number, code: string): Error {
  return createError({
    statusCode,
    statusMessage: AUTH_MESSAGES[code] ?? AUTH_MESSAGES.unknown,
    data: { code },
  })
}

interface StrapiFailure {
  status?: number
  code?: string
  message?: string
}

/** Extrait statut, code et message d'une erreur `$fetch` vers Strapi. */
export function strapiFailure(err: unknown): StrapiFailure {
  const response = (err as { response?: { status?: number; _data?: { error?: { message?: string; details?: { code?: string } } } } })?.response
  const error = response?._data?.error
  return { status: response?.status, code: error?.details?.code, message: error?.message }
}

/**
 * Traduit une erreur de Strapi pour le navigateur. `fallbackCode` s'applique aux refus (4xx)
 * sans code connu ; une panne (5xx, réseau) devient `unavailable`.
 */
export function translateStrapiError(err: unknown, fallbackCode = 'unknown'): Error {
  const { status, code } = strapiFailure(err)
  if (status === 429) return authError(429, 'too_many_attempts')
  if (!status || status >= 500) {
    console.error('[auth] Strapi indisponible :', status ?? (err as Error)?.message)
    return authError(503, 'unavailable')
  }
  if (code && AUTH_MESSAGES[code]) return authError(status === 401 ? 401 : 400, code)
  return authError(status === 401 ? 401 : 400, fallbackCode)
}

const limiters = {
  loginByAccount: createThrottle({ freeAttempts: 5 }),
  loginByIp: createThrottle({ freeAttempts: 30, baseDelayMs: 60_000 }),
  emailByAddress: createThrottle({ freeAttempts: 3 }),
  emailByIp: createThrottle({ freeAttempts: 10, baseDelayMs: 60_000 }),
  registerByIp: createThrottle({ freeAttempts: 10, baseDelayMs: 60_000 }),
  googleByIp: createThrottle({ freeAttempts: 10 }),
}
export type LimiterName = keyof typeof limiters

export function limiter(name: LimiterName) {
  return limiters[name]
}

/** Lève un 429 (avec Retry-After) si l'une des clés est en attente. */
export function assertNotThrottled(event: H3Event, checks: Array<[LimiterName, string]>): void {
  const wait = Math.max(0, ...checks.map(([name, key]) => limiters[name].retryAfter(key)))
  if (wait > 0) {
    setResponseHeader(event, 'Retry-After', wait)
    throw authError(429, 'too_many_attempts')
  }
}

/** Exécute `fn` en garantissant une durée minimale, succès comme échec. */
export async function withMinimumDuration<T>(minMs: number, fn: () => Promise<T>): Promise<T> {
  const started = Date.now()
  const pad = () => new Promise((resolve) => setTimeout(resolve, Math.max(0, minMs - (Date.now() - started))))
  try {
    const result = await fn()
    await pad()
    return result
  } catch (err) {
    await pad()
    throw err
  }
}

/** Refuse une mutation qui ne vient pas du site lui-même (CSRF). */
export function assertSameOrigin(event: H3Event): void {
  const refuse = () => createError({ statusCode: 403, statusMessage: 'Origine non autorisée' })
  const secFetchSite = getHeader(event, 'sec-fetch-site')
  if (secFetchSite) {
    if (secFetchSite !== 'same-origin') throw refuse()
    return
  }
  const origin = getHeader(event, 'origin')
  const host = getHeader(event, 'host')
  if (!origin || !host) throw refuse()
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw refuse()
  }
  if (originHost !== host) throw refuse()
}

/** Lit un corps JSON objet ; `{}` si absent ou invalide (les routes valident ensuite). */
export async function readJsonObject(event: H3Event): Promise<Record<string, unknown>> {
  const body = await readBody(event).catch(() => undefined)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}
