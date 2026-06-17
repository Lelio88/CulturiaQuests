/**
 * extractApiError — extrait un message d'erreur lisible quelle que soit la source.
 *
 * Couvre :
 * - la forme @nuxtjs/strapi héritée (`e.error.message`),
 * - la forme du proxy BFF (`e.statusMessage` / `e.data.message` / `e.data.data.error.message`,
 *   le proxy reposant le message Strapi dans `statusMessage` et le payload dans `data`),
 * - le fallback ofetch (`e.message`) en dernier recours.
 *
 * @example error.value = extractApiError(e, 'Échec de la connexion.')
 */
export function extractApiError(e: any, fallback = 'Une erreur est survenue.'): string {
  return (
    e?.error?.message ??
    e?.data?.data?.error?.message ??
    e?.data?.error?.message ??
    e?.data?.message ??
    e?.statusMessage ??
    e?.message ??
    fallback
  )
}
