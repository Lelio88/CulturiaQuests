/**
 * useApi — client HTTP central de l'app, routant tous les appels vers le BFF
 * (proxy serveur same-origin `/api/strapi/*`). Le serveur injecte le Bearer depuis le
 * cookie HTTP-ONLY `cq_session` ; le client n'a donc jamais accès au token (anti-vol XSS).
 *
 * Signature volontairement COMPATIBLE avec `useStrapiClient()` de @nuxtjs/strapi pour
 * minimiser la migration des stores :
 *   `const api = useApi(); api('/guilds', { method, params, body })`
 *
 * Choix non évidents :
 * - `params` est remappé sur `query` (ofetch n'a pas d'option `params`) — sans quoi tous
 *   les `populate`/`filters` des stores tomberaient silencieusement.
 * - Le fetcher est résolu paresseusement : en SSR on utilise `useRequestFetch()` afin de
 *   propager le cookie HTTP-ONLY entrant à la route serveur (un `$fetch` nu n'attache pas
 *   le cookie navigateur côté serveur → 401 + hydration mismatch).
 *
 * Invariant : appeler `useApi()` en tête de store/action (contexte Nuxt présent) puis
 * réutiliser la fonction retournée — ne pas l'appeler après un `await` qui perd l'instance
 * Nuxt (timer, listener Capacitor) sous peine de « Nuxt instance unavailable » en SSR.
 *
 * @example
 * const api = useApi()
 * const guild = await api('/guilds', { params: { populate: 'characters' } })
 */
export function useApi() {
  const fetcher = import.meta.server ? useRequestFetch() : $fetch

  return <T = unknown>(path: string, opts: Record<string, unknown> = {}): Promise<T> => {
    const cleanPath = path.replace(/^\/+/, '')
    const { params, query, ...rest } = opts as { params?: unknown; query?: unknown }
    return fetcher<T>(`/api/strapi/${cleanPath}`, {
      ...rest,
      query: query ?? params,
    } as Record<string, unknown>)
  }
}
