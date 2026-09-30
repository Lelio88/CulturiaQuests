/**
 * BFF — Réinitialisation du mot de passe (soumission du nouveau mot de passe).
 *
 * Relaie { code, password, passwordConfirmation } vers Strapi, qui applique la même règle de mot
 * de passe qu'à l'inscription, révoque toutes les sessions existantes du joueur et en ouvre une
 * nouvelle : on la pose en cookies (connexion directe). Message générique pour un lien invalide
 * ou expiré, pour ne rien dire de l'état du jeton.
 */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readJsonObject(event)
  const { code, password, passwordConfirmation } = body
  if (typeof code !== 'string' || typeof password !== 'string' || typeof passwordConfirmation !== 'string') {
    throw authError(400, 'invalid_body')
  }
  if (password !== passwordConfirmation) {
    throw createError({ statusCode: 400, statusMessage: 'Les mots de passe ne correspondent pas', data: { code: 'password_mismatch' } })
  }

  const ip = playerIp(event)
  assertNotThrottled(event, [['loginByIp', ip]])
  const deviceId = crypto.randomUUID()

  // Même plancher que la connexion, par cohérence : le code est un jeton aléatoire, sa durée
  // de vérification ne dirait de toute façon rien sur l'existence d'un compte.
  return withMinimumDuration(400, async () => {
    let res: { jwt: string; refreshToken: string; user: Record<string, unknown> }
    try {
      res = await $fetch<typeof res>(`${strapiBaseUrl(event)}/api/auth/reset-password`, {
        method: 'POST',
        body: { code, password, passwordConfirmation, deviceId },
        headers: forwardedHeaders(event),
      })
    } catch (err) {
      const { status, code: ruleCode } = strapiFailure(err)
      if (ruleCode && ruleCode.startsWith('password_')) throw translateStrapiError(err)
      if (status && status < 500 && status !== 429) {
        limiter('loginByIp').fail(ip)
        throw authError(400, 'reset_link_invalid')
      }
      throw translateStrapiError(err)
    }

    setSessionCookies(event, res, deviceId)
    return { user: res.user }
  })
})
