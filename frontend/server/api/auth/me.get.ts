/**
 * BFF — Utilisateur courant, lu côté serveur avec le jeton de la session (jamais exposé).
 *
 * `/users/me-with-role` rend le rôle (checks admin du front) et `terms_outdated`, qui déclenche
 * l'écran de réacceptation des CGU. Une session refusée par Strapi efface les cookies.
 */
// Retour annoté `Promise<unknown>` : sans ça, l'inférence du type de retour du handler passe par
// le registre de routes Nitro (auto-référence) → `default` implicitement `any` (TS7022/7024).
export default defineEventHandler(async (event): Promise<unknown> => {
  const token = sessionToken(event)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Non authentifié' })

  try {
    return await $fetch<unknown>(`${strapiBaseUrl(event)}/api/users/me-with-role`, {
      headers: { Authorization: `Bearer ${token}`, ...forwardedHeaders(event) },
    })
  } catch (err) {
    const { status } = strapiFailure(err)
    if (status === 401 || status === 403) {
      clearSessionCookies(event)
      throw createError({ statusCode: 401, statusMessage: 'Session invalide ou expirée' })
    }
    throw translateStrapiError(err)
  }
})
