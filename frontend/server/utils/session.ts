/**
 * Session du joueur côté BFF : trois cookies httpOnly et le renouvellement du jeton d'accès.
 *
 * Strapi émet (mode `refresh`) un jeton d'accès de 10 minutes et un jeton de rafraîchissement
 * tournant, révocable. Le navigateur ne voit ni l'un ni l'autre : `cq_session` (accès),
 * `cq_refresh` (rafraîchissement) et `cq_device` (identifiant d'appareil, pour que la
 * déconnexion ne coupe que cette session) sont httpOnly, `Secure` en production, `SameSite=Lax`.
 *
 * Choix non-évidents :
 * - Renouvellement **proactif** dans `server/middleware/10-session.ts`, avant tout handler : si
 *   l'accès expire dans moins d'une minute, on le renouvelle et on pose les nouveaux cookies sur
 *   la réponse **de la page elle-même** (le Set-Cookie d'une sous-requête SSR serait perdu).
 * - Une rotation à la fois par jeton (`inflight`) : une page charge plusieurs stores en parallèle,
 *   tous porteurs du même jeton. Strapi rend de toute façon le même successeur pour un jeton déjà
 *   tourné, ce qui couvre aussi la sous-requête SSR qui arrive avec les anciens cookies.
 * - L'expiration se lit dans le jeton sans le vérifier : c'est Strapi qui vérifie, ici on décide
 *   seulement s'il est temps de renouveler.
 * - `X-Forwarded-For` : Strapi limite les tentatives par IP ; sans cet en-tête, tous les joueurs
 *   partageaient l'IP du conteneur Nuxt, donc un seul compteur (quelques requêtes bloquaient tout
 *   le monde). L'IP retenue est le **dernier** maillon de l'en-tête reçu : celui que Caddy a posé,
 *   qu'il remplace l'en-tête du client ou qu'il y ajoute. Les maillons de gauche peuvent être forgés
 *   par le client ; les lire permettrait de changer d'IP fictive à chaque essai.
 *
 * Invariant : aucun jeton ne quitte le serveur ; les réponses au navigateur ne portent que `user`.
 */
import type { H3Event } from 'h3'

export const ACCESS_COOKIE = 'cq_session'
export const REFRESH_COOKIE = 'cq_refresh'
export const DEVICE_COOKIE = 'cq_device'
export const GOOGLE_ONBOARDING_COOKIE = 'cq_google_onboarding'

const REFRESH_MAX_AGE = 30 * 24 * 60 * 60
const RENEW_BEFORE_SECONDS = 60

export interface SessionTokens {
  jwt: string
  refreshToken: string
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

export function strapiBaseUrl(event: H3Event): string {
  return useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'
}

/**
 * Dernier maillon d'un en-tête X-Forwarded-For (« a, b, c » → « c »), ou null. Un seul proxy
 * (Caddy) précède Nuxt : ce maillon est l'adresse qu'il a vue. Si un CDN s'intercalait un jour,
 * il faudrait prendre l'avant-dernier.
 */
export function lastForwardedHop(header: string | undefined | null): string | null {
  const hops = (header ?? '').split(',').map((hop) => hop.trim()).filter(Boolean)
  return hops.length > 0 ? hops[hops.length - 1] : null
}

/** IP du joueur telle que Caddy l'a vue, sinon celle de la socket (accès direct, développement). */
export function playerIp(event: H3Event): string {
  return lastForwardedHop(getRequestHeader(event, 'x-forwarded-for')) || getRequestIP(event) || 'unknown'
}

export function forwardedHeaders(event: H3Event): Record<string, string> {
  const ip = playerIp(event)
  return ip === 'unknown' ? {} : { 'X-Forwarded-For': ip }
}

export function setSessionCookies(event: H3Event, tokens: SessionTokens, deviceId?: string): void {
  // `cq_session` vit aussi longtemps que la session : c'est son contenu qui expire (10 min),
  // pas le cookie. Sa présence signale au plugin SSR qu'une session existe.
  setCookie(event, ACCESS_COOKIE, tokens.jwt, cookieOptions(REFRESH_MAX_AGE))
  setCookie(event, REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE))
  if (deviceId) setCookie(event, DEVICE_COOKIE, deviceId, cookieOptions(REFRESH_MAX_AGE))
  event.context.cqAccess = tokens.jwt
}

export function clearSessionCookies(event: H3Event): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, DEVICE_COOKIE, 'culturia_jwt']) {
    // Attributs identiques au setCookie, sinon le cookie `secure` de prod ne serait pas effacé.
    deleteCookie(event, name, cookieOptions(0))
  }
  event.context.cqAccess = undefined
}

/** Secondes avant expiration d'un JWT (sans vérification de signature), ou null si illisible. */
export function secondsLeft(jwt: string, nowMs = Date.now()): number | null {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof exp === 'number' ? exp - Math.floor(nowMs / 1000) : null
  } catch {
    return null
  }
}

type RefreshOutcome = { ok: true; tokens: SessionTokens } | { ok: false; revoked: boolean }
const inflight = new Map<string, Promise<RefreshOutcome>>()

async function rotate(event: H3Event, refreshToken: string): Promise<RefreshOutcome> {
  try {
    const res = await $fetch<{ jwt: string; refreshToken: string }>(`${strapiBaseUrl(event)}/api/auth/refresh`, {
      method: 'POST',
      body: { refreshToken },
      headers: forwardedHeaders(event),
    })
    return { ok: true, tokens: { jwt: res.jwt, refreshToken: res.refreshToken } }
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status
    // 400/401 : jeton révoqué, expiré ou inconnu → la session est finie. Autre : panne passagère.
    return { ok: false, revoked: status === 400 || status === 401 }
  }
}

/**
 * Jeton d'accès valide pour cette requête, renouvelé si besoin ; null si aucune session.
 * Pose les nouveaux cookies (ou les efface si la session a été révoquée).
 */
export async function ensureFreshSession(event: H3Event): Promise<string | null> {
  const access = getCookie(event, ACCESS_COOKIE)
  const left = access ? secondsLeft(access) : null
  if (access && left !== null && left > RENEW_BEFORE_SECONDS) {
    event.context.cqAccess = access
    return access
  }

  const refreshToken = getCookie(event, REFRESH_COOKIE)
  if (!refreshToken) {
    // Ancien JWT de 30 jours (avant les sessions révocables) : Strapi le refusera, on le retire.
    if (access) clearSessionCookies(event)
    return null
  }

  let pending = inflight.get(refreshToken)
  if (!pending) {
    pending = rotate(event, refreshToken).finally(() => inflight.delete(refreshToken))
    inflight.set(refreshToken, pending)
  }
  const outcome = await pending
  if (outcome.ok) {
    setSessionCookies(event, outcome.tokens)
    return outcome.tokens.jwt
  }
  if (outcome.revoked) clearSessionCookies(event)
  return null
}

/** Jeton d'accès de la requête courante (après le middleware de session). */
export function sessionToken(event: H3Event): string | undefined {
  return (event.context.cqAccess as string | undefined) ?? undefined
}
