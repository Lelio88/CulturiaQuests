/**
 * BFF — Fin d'inscription après une première connexion Google.
 *
 * Complète le jeton d'inscription (cookie httpOnly posé par `google.post.ts`) avec ce que Google
 * ne fournit pas : pseudo, date de naissance (15 ans minimum), acceptation des CGU, guilde et
 * personnage. Strapi ne crée le compte qu'à cette étape, confirmé d'office (Google a vérifié
 * l'adresse), puis ouvre la session.
 */
const FIELDS = ['username', 'date_of_birth', 'terms_accepted', 'guildName', 'firstname', 'lastname', 'iconId'] as const
const ONBOARDING_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth/google',
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const onboardingToken = getCookie(event, GOOGLE_ONBOARDING_COOKIE)
  if (!onboardingToken) throw authError(401, 'onboarding_expired')

  const body = await readJsonObject(event)
  const payload = Object.fromEntries(FIELDS.map((field) => [field, body[field]]))
  const ip = playerIp(event)
  assertNotThrottled(event, [['registerByIp', ip]])
  limiter('registerByIp').hit(ip)

  let res: { jwt: string; refreshToken: string; deviceId?: string; user: Record<string, unknown> }
  try {
    res = await $fetch<typeof res>(`${strapiBaseUrl(event)}/api/auth/google/register`, {
      method: 'POST',
      body: { ...payload, onboardingToken },
      headers: forwardedHeaders(event),
    })
  } catch (err) {
    const { status, code } = strapiFailure(err)
    if (status === 401 && !code) {
      deleteCookie(event, GOOGLE_ONBOARDING_COOKIE, ONBOARDING_COOKIE_OPTIONS)
      throw authError(401, 'onboarding_expired')
    }
    throw translateStrapiError(err, 'registration_failed')
  }

  deleteCookie(event, GOOGLE_ONBOARDING_COOKIE, ONBOARDING_COOKIE_OPTIONS)
  setSessionCookies(event, { jwt: res.jwt, refreshToken: res.refreshToken }, res.deviceId)
  return { user: res.user }
})
