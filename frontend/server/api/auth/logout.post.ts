/**
 * BFF — Déconnexion (socle httpOnly, phase 1).
 * Efface le cookie de session HTTP-ONLY.
 */
export default defineEventHandler((event) => {
  deleteCookie(event, 'cq_session', { path: '/' })
  return { ok: true }
})
