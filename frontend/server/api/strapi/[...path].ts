/**
 * BFF — Proxy authentifié vers Strapi (socle httpOnly, phase 1).
 *
 * Toute requête vers `/api/strapi/<chemin>` est relayée vers Strapi `/api/<chemin>` en
 * injectant le JWT (cookie HTTP-ONLY `cq_session`) dans l'en-tête Authorization CÔTÉ SERVEUR.
 * Le client n'a donc jamais besoin du token : il appelle une route same-origin.
 *
 * NB (phase 2) : ce proxy traite les requêtes JSON. L'upload multipart (avatar) devra être
 * géré spécifiquement (lecture du flux brut) lors de la migration de ce flux.
 */
export default defineEventHandler(async (event) => {
  const jwt = getCookie(event, 'cq_session')
  const strapiUrl = useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'

  const path = getRouterParam(event, 'path') || ''
  const method = event.method
  const query = getQuery(event)

  const headers: Record<string, string> = {}
  if (jwt) headers.Authorization = `Bearer ${jwt}`

  let body: unknown
  if (!['GET', 'HEAD'].includes(method)) {
    body = await readBody(event).catch(() => undefined)
  }

  try {
    return await $fetch(`${strapiUrl}/api/${path}`, { method, query, headers, body })
  } catch (err: any) {
    throw createError({
      statusCode: err?.response?.status || 500,
      statusMessage: err?.response?.statusText || 'Erreur proxy Strapi',
      data: err?.response?._data,
    })
  }
})
