/**
 * BFF — Connexion (socle httpOnly, phase 1).
 *
 * Reçoit { identifier, password }, appelle Strapi /api/auth/local côté serveur, puis pose
 * le JWT dans un cookie HTTP-ONLY (`cq_session`) inaccessible au JavaScript → un vol de
 * token par XSS devient impossible. Ne renvoie JAMAIS le token au client, seulement le user.
 *
 * Cookie DÉDIÉ `cq_session` (≠ `culturia_jwt` de @nuxtjs/strapi) pour cohabiter sans conflit
 * pendant la migration. Voir frontend/server/README.md (plan de migration phase 2).
 */
export default defineEventHandler(async (event) => {
  const { identifier, password } = await readBody(event)
  if (!identifier || !password) {
    throw createError({ statusCode: 400, statusMessage: 'identifier et password requis' })
  }

  const strapiUrl = useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'

  let res: { jwt: string; user: Record<string, unknown> }
  try {
    res = await $fetch(`${strapiUrl}/api/auth/local`, {
      method: 'POST',
      body: { identifier, password },
    })
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Identifiants invalides' })
  }

  setCookie(event, 'cq_session', res.jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 14 * 24 * 60 * 60, // 14 jours
  })

  // On ne renvoie que l'utilisateur — jamais le JWT.
  return { user: res.user }
})
