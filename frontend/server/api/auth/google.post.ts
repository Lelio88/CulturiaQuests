/**
 * BFF — Connexion avec Google (application Android seulement).
 *
 * L'app obtient un jeton d'identité par Credential Manager (greffon natif `GoogleSignIn`) et
 * l'envoie ici ; Strapi le vérifie (`lib/google.ts`). Deux issues :
 * - compte connu (ou même adresse) → session posée en cookies, `{ user }` ;
 * - adresse inconnue → `{ onboarding: true }` et un jeton d'inscription de 15 minutes, gardé en
 *   cookie httpOnly jusqu'à l'écran de fin d'inscription (`/account/google`).
 */
const ONBOARDING_MAX_AGE = 15 * 60

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readJsonObject(event)
  if (typeof body.idToken !== 'string' || body.idToken.length === 0) throw authError(400, 'google_invalid')

  const ip = playerIp(event)
  assertNotThrottled(event, [['googleByIp', ip]])

  let res: {
    jwt?: string
    refreshToken?: string
    deviceId?: string
    user?: Record<string, unknown>
    onboardingToken?: string
    email?: string
  }
  try {
    res = await $fetch<typeof res>(`${strapiBaseUrl(event)}/api/auth/google`, {
      method: 'POST',
      body: { idToken: body.idToken },
      headers: forwardedHeaders(event),
    })
  } catch (err) {
    const { status, code } = strapiFailure(err)
    if (status === 401 && !code) {
      limiter('googleByIp').fail(ip)
      throw authError(401, 'google_invalid')
    }
    throw translateStrapiError(err, 'google_invalid')
  }

  if (res.onboardingToken) {
    setCookie(event, GOOGLE_ONBOARDING_COOKIE, res.onboardingToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/google',
      maxAge: ONBOARDING_MAX_AGE,
    })
    return { onboarding: true, email: res.email }
  }
  if (!res.jwt || !res.refreshToken) throw authError(503, 'unavailable')
  setSessionCookies(event, { jwt: res.jwt, refreshToken: res.refreshToken }, res.deviceId)
  return { user: res.user }
})
