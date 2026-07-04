/**
 * BFF — Proxy authentifié vers Strapi (socle httpOnly).
 *
 * Toute requête vers `/api/strapi/<chemin>` est relayée vers Strapi `/api/<chemin>` en
 * injectant le JWT (cookie HTTP-ONLY `cq_session`) dans l'en-tête Authorization CÔTÉ SERVEUR.
 * Le client n'a donc jamais besoin du token : il appelle une route same-origin.
 *
 * Garde-fous :
 * - Garde `!jwt` : un store appelé sans session échoue en 401 explicite (au lieu d'un 403
 *   Strapi opaque sur un appel sans Authorization). EXCEPTION : les routes de `PUBLIC_GET_PATHS`
 *   (GET uniquement, accordées au rôle Public côté Strapi — cf. `backend/src/index.ts`) sont
 *   relayées sans session car consommées AVANT authentification (ex. écran d'inscription →
 *   choix de l'icône du personnage via `/character-icons`). Aucun risque CSRF (GET idempotent),
 *   et Strapi applique lui-même ses permissions Public.
 * - Défense CSRF : le cookie étant auto-envoyé par le navigateur, on exige une origine
 *   same-origin sur toute mutation (sameSite=lax ne suffit pas pour un BFF relayant tous
 *   les verbes). On s'appuie sur Sec-Fetch-Site, avec repli sur Origin vs Host.
 *
 * NB : ce proxy traite les requêtes JSON (incl. l'avatar en base64-JSON). Aucun flux
 * multipart n'existe dans l'app.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Routes Strapi accessibles au rôle Public (bootstrap `backend/src/index.ts`) et appelées
// avant que l'utilisateur ne dispose d'une session. GET uniquement.
const PUBLIC_GET_PATHS = new Set(['character-icons'])

// Retour annoté `Promise<unknown>` : sans ça, l'inférence du type de retour du handler passe par
// le registre de routes Nitro (auto-référence) → `default` implicitement `any` (TS7022/7024).
export default defineEventHandler(async (event): Promise<unknown> => {
  const method = event.method
  const jwt = getCookie(event, 'cq_session')
  const path = getRouterParam(event, 'path') || ''

  const isPublicGet = method === 'GET' && PUBLIC_GET_PATHS.has(path)

  if (!jwt && !isPublicGet) {
    throw createError({ statusCode: 401, statusMessage: 'Non authentifié' })
  }

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
  // Forward du query string VERBATIM (déjà sérialisé en notation Strapi par useApi/qs).
  // Ne PAS parser+re-sérialiser : getQuery+ofetch casserait `populate[...]` imbriqué.
  const search = getRequestURL(event).search

  // Route publique sans session : on relaie sans Authorization (Strapi applique le rôle Public).
  const headers: Record<string, string> = jwt ? { Authorization: `Bearer ${jwt}` } : {}

  let body: Record<string, unknown> | undefined
  if (!['GET', 'HEAD'].includes(method)) {
    body = await readBody(event).catch(() => undefined)
  }

  try {
    // `$fetch<unknown>` explicite : sans paramètre de type, l'inférence de retour se réfère au
    // registre de routes Nitro (récursion) → `any` implicite (TS7022/7024) sur cette route critique.
    return await $fetch<unknown>(`${strapiUrl}/api/${path}${search}`, { method, headers, body })
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
