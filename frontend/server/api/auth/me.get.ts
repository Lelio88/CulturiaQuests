/**
 * BFF — Utilisateur courant (socle httpOnly, phase 1).
 * Lit le cookie HTTP-ONLY `cq_session` et interroge Strapi /api/users/me côté serveur.
 * Permet au front de connaître l'utilisateur SANS jamais accéder au token.
 */
// Retour annoté `Promise<unknown>` : sans ça, l'inférence du type de retour du handler passe par
// le registre de routes Nitro (auto-référence) → `default` implicitement `any` (TS7022/7024).
export default defineEventHandler(async (event): Promise<unknown> => {
  const jwt = getCookie(event, 'cq_session')
  if (!jwt) {
    throw createError({ statusCode: 401, statusMessage: 'Non authentifié' })
  }

  const strapiUrl = useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'
  try {
    // /users/me-with-role peuple le role (le /users/me natif le retire au sanitizeQuery,
    // rendant ?populate=role inopérant) — requis par les checks admin côté front.
    // Paramètre de type explicite : sans lui, l'inférence de $fetch passe par le registre de
    // routes Nitro → TS2321 « Excessive stack depth ».
    return await $fetch<unknown>(`${strapiUrl}/api/users/me-with-role`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Session invalide ou expirée' })
  }
})
