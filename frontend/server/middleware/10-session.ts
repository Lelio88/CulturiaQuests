/**
 * Renouvelle le jeton d'accès avant tout handler (pages SSR comme routes /api).
 *
 * Voir `server/utils/session.ts` : le renouvellement doit avoir lieu sur la requête de la page,
 * seule réponse dont les Set-Cookie atteignent le navigateur. Les fichiers statiques sont
 * ignorés, et une requête sans cookie de session ne coûte rien.
 */
const STATIC_PREFIXES = ['/_nuxt/', '/_fonts/', '/assets/', '/fonts/', '/favicon', '/.well-known/', '/__nuxt']

export default defineEventHandler(async (event) => {
  if (STATIC_PREFIXES.some((prefix) => event.path.startsWith(prefix))) return
  if (!getCookie(event, ACCESS_COOKIE) && !getCookie(event, REFRESH_COOKIE)) return
  await ensureFreshSession(event)
})
