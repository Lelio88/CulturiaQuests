/**
 * BFF — Utilisateur courant (socle httpOnly, phase 1).
 * Lit le cookie HTTP-ONLY `cq_session` et interroge Strapi /api/users/me côté serveur.
 * Permet au front de connaître l'utilisateur SANS jamais accéder au token.
 */
export default defineEventHandler(async (event) => {
  const jwt = getCookie(event, 'cq_session')
  if (!jwt) {
    throw createError({ statusCode: 401, statusMessage: 'Non authentifié' })
  }

  const strapiUrl = useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'
  try {
    return await $fetch(`${strapiUrl}/api/users/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
      query: { populate: 'role' },
    })
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Session invalide ou expirée' })
  }
})
