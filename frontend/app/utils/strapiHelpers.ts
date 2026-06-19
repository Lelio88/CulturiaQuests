import type { Tag } from '~/types/tag'

/**
 * Extrait les noms de tags d'un objet Museum brut Strapi.
 * Gère les structures v4/v5 polymorphes (flattened et nested).
 *
 * @param museumRaw - Objet Museum brut retourné par l'API Strapi
 * @returns Tableau de noms de tags (strings)
 *
 * @example
 * const tags = extractTags(rawMuseum)
 * // ['Histoire', 'Art', 'Sciences']
 */
export function extractTags(museumRaw: any): string[] {
  // Helper pour extraire tableau de tags depuis différentes structures
  const extractTagsArray = (data: any): Tag[] | null => {
    if (!data) return null
    if (Array.isArray(data)) return data
    if ('data' in data && Array.isArray(data.data)) return data.data
    return null
  }

  // Essayer attributes.tags puis tags direct
  const tagsArray = extractTagsArray(museumRaw.attributes?.tags)
    || extractTagsArray(museumRaw.tags)
    || []

  // Extraire les noms et filtrer les valeurs vides
  return tagsArray
    .map((tag: Tag) => tag.attributes?.name || tag.name || '')
    .filter(Boolean)
}

/**
 * Construit l'URL complète d'une ressource Strapi (image, icône, etc.).
 * Gère les URLs absolues (commençant par http) et relatives.
 *
 * @param path - Chemin de la ressource (peut être absolu ou relatif)
 * @returns URL complète de la ressource
 *
 * @example
 * buildStrapiUrl('/uploads/image.png')
 * // 'http://localhost:1337/uploads/image.png'
 *
 * buildStrapiUrl('https://example.com/image.png')
 * // 'https://example.com/image.png'
 */
export function buildStrapiUrl(path: string): string {
  const config = useRuntimeConfig()

  // Si déjà une URL absolue, la retourner telle quelle
  if (path.startsWith('http')) return path

  // Sinon, construire l'URL complète avec l'URL du serveur Strapi
  return `${config.public.strapi.url}${path}`
}

/**
 * Résout l'URL absolue d'une image Strapi sous ses formes polymorphes : `.url`,
 * `.attributes.url` (v4) ou `.data.attributes.url` (v5). Mutualise 5 copies inline divergentes. #39
 *
 * @param imgData  objet image brut (relation media Strapi) — ou null/undefined.
 * @param fallback valeur de repli si aucune URL n'est trouvée (défaut `null`). Les vues "avatar"
 *   passent `'/assets/default-avatar.png'` ; celles qui gèrent l'absence au call-site laissent `null`.
 * @returns l'URL absolue (via buildStrapiUrl) ou `fallback`.
 */
export function getImageUrl(imgData: any, fallback: string | null = null): string | null {
  if (!imgData) return fallback
  const url = imgData.url || imgData.attributes?.url || imgData.data?.attributes?.url
  if (!url) return fallback
  return buildStrapiUrl(url)
}

const MUSEUM_TAG_IMAGES = ['art', 'history', 'make', 'nature', 'science', 'society']

/**
 * Chemin de l'image d'un musée d'après son premier tag (ex: `/assets/map/museum/Art.webp`),
 * ou l'image générique `/assets/musee.png` si le tag est absent/inconnu. #39
 */
export function getMuseumImageByTag(museum: any): string {
  const firstTag = museum?.tags?.[0]?.name?.toLowerCase()
  if (firstTag && MUSEUM_TAG_IMAGES.includes(firstTag)) {
    const capitalized = firstTag.charAt(0).toUpperCase() + firstTag.slice(1)
    return `/assets/map/museum/${capitalized}.webp`
  }
  return '/assets/musee.png'
}
