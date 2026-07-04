/**
 * BFF — Réinitialisation du mot de passe (soumission du nouveau mot de passe).
 *
 * Reçoit { code, password, passwordConfirmation }, relaie vers Strapi /api/auth/reset-password.
 * En cas de succès, Strapi renvoie { jwt, user } → on pose le cookie HTTP-ONLY `cq_session`
 * (auto-login, cohérent avec login/register) et on ne renvoie que l'utilisateur.
 * Message d'erreur générique (code invalide OU expiré) pour ne pas divulguer l'état du token.
 */
export default defineEventHandler(async (event) => {
  const { code, password, passwordConfirmation } = await readBody(event)

  if (!code || !password || !passwordConfirmation) {
    throw createError({ statusCode: 400, statusMessage: 'code, password et passwordConfirmation requis' })
  }
  if (password !== passwordConfirmation) {
    throw createError({ statusCode: 400, statusMessage: 'Les mots de passe ne correspondent pas' })
  }

  const strapiUrl = useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'

  let res: { jwt: string; user: Record<string, unknown> }
  try {
    // Paramètre de type explicite : coupe l'inférence via le registre de routes Nitro (TS2321).
    res = await $fetch<{ jwt: string; user: Record<string, unknown> }>(`${strapiUrl}/api/auth/reset-password`, {
      method: 'POST',
      body: { code, password, passwordConfirmation },
    })
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Lien de réinitialisation invalide ou expiré' })
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
