// Mapping nom de région BDD → nom de dossier/fichier d'asset (seul « La Réunion » diffère).
const REGION_NAME_MAP: Record<string, string> = {
  'La Réunion': 'La-Réunion',
}

export interface DisplayBadge {
  id: string
  name: string
  image: string
}

interface ZoneLike {
  documentId: string
  name: string
}

interface ZoneData {
  comcoms: ZoneLike[]
  departments: ZoneLike[]
  regions: ZoneLike[]
}

/**
 * Résout le nom + l'image d'un badge ÉQUIPÉ à partir de son ID synthétique
 * (`comcom:{docId}` | `dept:{docId}` | `region:{docId}` | `france`) et des zones du `zoneStore`.
 *
 * Sert à afficher les badges d'un AUTRE joueur (profil ami, #54) à partir de `badge-summary` :
 * un badge équipé est forcément GAGNÉ (validé serveur = zone complétée), on le rend donc au
 * palier « Plat ». Le serveur ne renvoie pas le palier exact (il ne connaît que `is_completed`).
 *
 * NB : les chemins d'assets suivent la même convention que `stores/badge.ts` (palier Plat ici, d'où
 * pas de cas spécial `.png.png` qui ne concernait que « La-Réunion Gold »).
 *
 * @returns le badge d'affichage, ou `null` si l'ID est inconnu / la zone introuvable.
 */
export function resolveEquippedBadge(id: string, zones: ZoneData): DisplayBadge | null {
  if (id === 'france') {
    return { id, name: 'France', image: '/assets/badges/France.png' }
  }

  const sep = id.indexOf(':')
  if (sep === -1) return null
  const prefix = id.slice(0, sep)
  const docId = id.slice(sep + 1)
  if (!docId) return null

  if (prefix === 'comcom') {
    const c = zones.comcoms.find(z => z.documentId === docId)
    return c ? { id, name: c.name, image: '/assets/badges/Com/Com_Plat.png' } : null
  }
  if (prefix === 'dept') {
    const d = zones.departments.find(z => z.documentId === docId)
    return d ? { id, name: d.name, image: '/assets/badges/Dep/Dep_Plat.png' } : null
  }
  if (prefix === 'region') {
    const r = zones.regions.find(z => z.documentId === docId)
    if (!r) return null
    const assetName = REGION_NAME_MAP[r.name] || r.name
    const enc = encodeURIComponent(assetName)
    return { id, name: r.name, image: `/assets/badges/Reg/${enc}/${enc}_Plat.png` }
  }
  return null
}
