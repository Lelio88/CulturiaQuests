/**
 * BFF — Proxy authentifié vers Strapi (socle httpOnly).
 *
 * Toute requête vers `/api/strapi/<chemin>` est relayée vers Strapi `/api/<chemin>` en
 * injectant le JWT (cookie HTTP-ONLY `cq_session`) dans l'en-tête Authorization CÔTÉ SERVEUR.
 * Le client n'a donc jamais besoin du token : il appelle une route same-origin.
 *
 * Garde-fous :
 * - Garde `!jwt` en tout premier : un store appelé sans session échoue en 401 explicite
 *   (au lieu d'un 403 Strapi opaque sur un appel sans Authorization).
 * - Défense CSRF : le cookie étant auto-envoyé par le navigateur, on exige une origine
 *   same-origin sur toute mutation (sameSite=lax ne suffit pas pour un BFF relayant tous
 *   les verbes). On s'appuie sur Sec-Fetch-Site, avec repli sur Origin vs Host.
 *
 * NB : ce proxy traite les requêtes JSON (incl. l'avatar en base64-JSON). Aucun flux
 * multipart n'existe dans l'app.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler(async (event) => {
  const jwt = getCookie(event, 'cq_session')
  if (!jwt) {
    throw createError({ statusCode: 401, statusMessage: 'Non authentifié' })
  }

  const method = event.method

  if (MUTATING.has(method)) {
    const secFetchSite = getHeader(event, 'sec-fetch-site')
    if (secFetchSite) {
      if (secFetchSite !== 'same-origin') {
        throw createError({ statusCode: 403, statusMessage: 'Origine non autorisée' })
      }
    } else {
      // Repli pour les navigateurs sans Sec-Fetch-* : comparer Origin et Host.
      const origin = getHeader(event, 'origin')
      const host = getHeader(event, 'host')
      if (origin && host && new URL(origin).host !== host) {
        throw createError({ statusCode: 403, statusMessage: 'Origine non autorisée' })
      }
    }
  }

  const strapiUrl = useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'
  const path = getRouterParam(event, 'path') || ''
  // Forward du query string VERBATIM (déjà sérialisé en notation Strapi par useApi/qs).
  // Ne PAS parser+re-sérialiser : getQuery+ofetch casserait `populate[...]` imbriqué.
  const search = getRequestURL(event).search

  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` }

  let body: unknown
  if (!['GET', 'HEAD'].includes(method)) {
    body = await readBody(event).catch(() => undefined)
  }

  try {
    return await $fetch(`${strapiUrl}/api/${path}${search}`, { method, headers, body })
  } catch (err: any) {
    // Forme d'erreur robuste : err.response.statusText est vide en HTTP/2 (h2c) et
    // err.response.status n'est pas garanti sur ofetch → on retombe en cascade.
    const strapiData = err?.response?._data ?? err?.data
    throw createError({
      statusCode: err?.response?.status ?? err?.statusCode ?? 500,
      statusMessage: strapiData?.error?.message || err?.statusMessage || 'Erreur proxy Strapi',
      data: strapiData,
    })
  }
})
