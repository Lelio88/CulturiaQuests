/**
 * BFF — Connexion par identifiant (e-mail ou pseudo) et mot de passe.
 *
 * Appelle Strapi `/api/auth/local` côté serveur, pose la session en cookies httpOnly
 * (`server/utils/session.ts`) et ne renvoie que l'utilisateur, jamais les jetons.
 *
 * Choix non-évidents :
 * - Limitation par compte + IP, délai croissant (`auth-guard.ts`) ; un succès remet le compteur
 *   du compte à zéro.
 * - Réponse d'au moins 400 ms : compte inconnu et mot de passe faux prennent le même temps.
 * - « Adresse non confirmée » et « compte suspendu » ne sont dits qu'après un mot de passe
 *   **correct** (Strapi vérifie le mot de passe d'abord) : ils ne révèlent rien à un inconnu.
 * - `deviceId` généré ici : la déconnexion ne révoquera que la session de cet appareil.
 */
// Strapi ne donne pas de code pour ce cas, seulement son message (« Your account email is not
// confirmed »). Motif large : une reformulation retomberait sur « identifiants invalides »,
// sans rien révéler, mais l'invitation à confirmer disparaîtrait.
const NOT_CONFIRMED = /not confirmed/i

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readJsonObject(event)
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!identifier || !password) throw authError(400, 'invalid_credentials')

  const ip = playerIp(event)
  const accountKey = `${identifier.toLowerCase()}|${ip}`
  assertNotThrottled(event, [['loginByAccount', accountKey], ['loginByIp', ip]])
  const deviceId = crypto.randomUUID()

  return withMinimumDuration(400, async () => {
    let res: { jwt: string; refreshToken: string; user: Record<string, unknown> }
    try {
      res = await $fetch<typeof res>(`${strapiBaseUrl(event)}/api/auth/local`, {
        method: 'POST',
        body: { identifier, password, deviceId },
        headers: forwardedHeaders(event),
      })
    } catch (err) {
      const failure = strapiFailure(err)
      if (failure.status === 400 && NOT_CONFIRMED.test(failure.message ?? '')) {
        limiter('loginByAccount').reset(accountKey)
        throw authError(403, 'email_not_confirmed')
      }
      if (failure.status === 400 && /blocked/i.test(failure.message ?? '')) throw authError(403, 'account_blocked')
      if (failure.status && failure.status < 500 && failure.status !== 429) {
        limiter('loginByAccount').fail(accountKey)
        limiter('loginByIp').fail(ip)
        throw authError(401, 'invalid_credentials')
      }
      throw translateStrapiError(err)
    }

    limiter('loginByAccount').reset(accountKey)
    setSessionCookies(event, res, deviceId)
    return { user: res.user }
  })
})
