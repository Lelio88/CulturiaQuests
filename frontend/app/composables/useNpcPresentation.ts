/**
 * Helpers de PRÉSENTATION des PNJ (nom affiché + chemin d'image), mutualisés entre le store npc
 * (getter sortedJournals) et la page stories/[id]. Évite la duplication de la logique de format
 * de nom et du chemin `/assets/npc/<prénom>/<prénom>.webp`. #47
 *
 * Invariant : un PNJ sans prénom (ou « Inconnu ») retombe sur l'avatar par défaut plutôt que sur
 * un chemin d'image cassé.
 *
 * @example
 * const { formatNpcName, npcImagePath } = useNpcPresentation()
 * formatNpcName('Marie', 'Dupont') // 'Marie Dupont'
 * npcImagePath('Marie')            // '/assets/npc/Marie/Marie.webp'
 */
export function useNpcPresentation() {
  /** Nom complet affiché (« Prénom Nom »), « Inconnu » si le prénom manque. */
  function formatNpcName(firstname?: string | null, lastname?: string | null): string {
    return `${firstname || 'Inconnu'} ${lastname || ''}`.trim()
  }

  /** Chemin de l'image du PNJ d'après son prénom ; avatar par défaut si absent/« Inconnu ». */
  function npcImagePath(firstname?: string | null): string {
    const first = (firstname || '').trim()
    if (!first || first === 'Inconnu') return '/assets/default-avatar.png'
    return `/assets/npc/${first}/${first}.webp`
  }

  return { formatNpcName, npcImagePath }
}
