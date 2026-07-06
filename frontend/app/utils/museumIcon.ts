/**
 * Nom de fichier d'icône de catégorie musée, servi sous `/assets/map/museum/<nom>.webp`.
 *
 * Choix non-évident : les catégories métier (`GAME_CATEGORIES`, cf. `scripts/pois_importer/utils.ts`)
 * sont en **français** — `Art`, `Nature`, `Science`, `Histoire`, `Savoir-faire`, `Société` — alors que
 * les fichiers d'icônes sont en **anglais** — `Art`, `Nature`, `Science`, `History`, `Make`, `Society`.
 * Sans mapping, un tag `Histoire`/`Savoir-faire`/`Société` pointe vers un fichier inexistant → image
 * cassée (404) dans le drawer musée, et repli systématique sur `Art` sur la carte.
 *
 * Invariant : retourne TOUJOURS un nom de fichier existant (repli `Art` pour toute valeur inconnue) →
 * jamais de 404. Insensible à la casse ; tolère aussi qu'un tag soit déjà un nom de fichier anglais.
 *
 * @example museumIconFile('Histoire') // 'History'
 * @example museumIconFile('inconnu')  // 'Art'
 */
const CATEGORY_ICON_FILE: Record<string, string> = {
  art: 'Art',
  nature: 'Nature',
  science: 'Science',
  histoire: 'History',
  'savoir-faire': 'Make',
  société: 'Society',
  // Tolérance : tag déjà exprimé comme nom de fichier anglais.
  history: 'History',
  make: 'Make',
  society: 'Society',
}

export function museumIconFile(tag?: string | null): string {
  return CATEGORY_ICON_FILE[(tag || '').trim().toLowerCase()] || 'Art'
}
