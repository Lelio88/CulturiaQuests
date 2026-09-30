/**
 * BFF — Déconnexion : révoque la session de cet appareil côté serveur, puis efface les cookies.
 *
 * Strapi (`/api/auth/logout`, mode `refresh`) invalide le jeton de rafraîchissement du
 * `deviceId` fourni ; sans `deviceId` (session ouverte avant ce cookie), il invalide toutes les
 * sessions du joueur. Le jeton d'accès déjà émis expire de lui-même en 10 minutes au plus, et le
 * navigateur ne l'a plus. Un échec de révocation n'empêche pas la déconnexion locale.
 */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const token = sessionToken(event)
  const deviceId = getCookie(event, DEVICE_COOKIE)

  if (token) {
    try {
      await $fetch<unknown>(`${strapiBaseUrl(event)}/api/auth/logout`, {
        method: 'POST',
        body: deviceId ? { deviceId } : {},
        headers: { Authorization: `Bearer ${token}`, ...forwardedHeaders(event) },
      })
    } catch (err) {
      console.error('[auth/logout] révocation impossible :', strapiFailure(err).status ?? (err as Error)?.message)
    }
  }

  clearSessionCookies(event)
  return { ok: true }
})
