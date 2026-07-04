/**
 * BFF — Inscription (socle httpOnly, phase 1).
 *
 * Relaie le corps vers Strapi /api/auth/local/register (l'extension users-permissions y
 * valide date_of_birth + persiste les champs). En cas de succès, pose le JWT en cookie
 * HTTP-ONLY `cq_session` et ne renvoie que l'utilisateur.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const strapiUrl = useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'

  let res: { jwt: string; user: Record<string, unknown> }
  try {
    // Paramètre de type explicite : coupe l'inférence via le registre de routes Nitro (TS2321).
    res = await $fetch<{ jwt: string; user: Record<string, unknown> }>(`${strapiUrl}/api/auth/local/register`, {
      method: 'POST',
      body,
    })
  } catch (err: any) {
    const message = err?.response?._data?.error?.message || "Inscription refusée"
    throw createError({ statusCode: err?.response?.status || 400, statusMessage: message })
  }

  setCookie(event, 'cq_session', res.jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 14 * 24 * 60 * 60,
  })

  return { user: res.user }
})
