/**
 * BFF — Déconnexion (socle httpOnly, phase 1).
 * Efface le cookie de session HTTP-ONLY.
 */
export default defineEventHandler((event) => {
  // Les attributs doivent correspondre à ceux du setCookie (login/register), sinon le
  // cookie `secure` posé en prod ne serait pas effacé (navigateur = cookie distinct).
  deleteCookie(event, 'cq_session', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return { ok: true }
})
