/**
 * BFF — Utilisateur courant, lu côté serveur avec le jeton de la session (jamais exposé).
 *
 * `/users/me-with-role` rend le rôle (checks admin du front) et `terms_outdated`, qui déclenche
 * l'écran de réacceptation des CGU. Une session refusée par Strapi efface les cookies.
 *
 * Un visiteur sans session reçoit `null` (200), pas un 401 : c'est l'état normal d'un visiteur,
 * et le client l'interroge à chaque démarrage (les cookies httpOnly ne lui sont pas lisibles) ;
 * un 401 polluait la console. Le 401 reste réservé à une session présente mais refusée.
 */
// Retour annoté `Promise<unknown>` : sans ça, l'inférence du type de retour du handler passe par
// le registre de routes Nitro (auto-référence) → `default` implicitement `any` (TS7022/7024).
export default defineEventHandler(async (event): Promise<unknown> => {
  const token = sessionToken(event)
  if (!token) return null

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
