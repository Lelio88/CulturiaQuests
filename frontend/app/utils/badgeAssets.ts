// Mapping nom de région BDD → nom de dossier/fichier d'asset (seul « La Réunion » diffère).
const REGION_NAME_MAP: Record<string, string> = {
  'La Réunion': 'La-Réunion',
}

export interface DisplayBadge {
  id: string
  name: string
  image: string
}

interface ComcomLike {
  documentId: string
  name: string
  department?: { documentId?: string } | null
}
interface DeptLike {
  documentId: string
  name: string
  region?: { documentId?: string } | null
}
interface RegionLike {
  documentId: string
  name: string
}

interface ZoneData {
  comcoms: ComcomLike[]
  departments: DeptLike[]
  regions: RegionLike[]
}

type Tier = 'bronze' | 'gold' | 'plat'

// Mêmes seuils que `stores/badge.ts` (getTier). Un badge ÉQUIPÉ est forcément gagné : on ne
// descend jamais en dessous de bronze à l'affichage (le palier `none` n'est pas équipable).
function tierFromCompletion(completion: number): Tier {
  if (completion >= 90) return 'plat'
  if (completion >= 50) return 'gold'
  return 'bronze'
}

const TIER_FILE: Record<Tier, string> = { bronze: 'Bronze', gold: 'Gold', plat: 'Plat' }

/** % de comcoms complétées parmi un ensemble de comcoms (100 si l'ensemble est vide, cf. store). */
function completionRatio(comcomsInZone: ComcomLike[], completed: Set<string>): number {
  if (comcomsInZone.length === 0) return 100
  const done = comcomsInZone.filter((c) => completed.has(c.documentId)).length
  return (done / comcomsInZone.length) * 100
}

function regionImage(name: string, tier: Tier): string {
  const assetName = REGION_NAME_MAP[name] || name
  const enc = encodeURIComponent(assetName)
  // Cas spécial assets (repris de stores/badge.ts) : « La-Réunion Gold » a une double extension .png.png.
  if (assetName === 'La-Réunion' && tier === 'gold') {
    return `/assets/badges/Reg/${enc}/${enc}_Gold.png.png`
  }
  return `/assets/badges/Reg/${enc}/${enc}_${TIER_FILE[tier]}.png`
}

/**
 * Résout le nom + l'image d'un badge ÉQUIPÉ d'un autre joueur (profil ami, #54) à partir de son ID
 * synthétique (`comcom:{docId}` | `dept:{docId}` | `region:{docId}` | `france`), de la hiérarchie de
 * zones locale (`zoneStore`) et des comcoms complétées de l'ami (`completedComcomIds`, renvoyées par
 * `badge-summary`).
 *
 * Le PALIER est calculé exactement comme dans `stores/badge.ts` (au lieu d'être figé à « Plat ») :
 * - comcom : équipé ⇒ complété ⇒ 100 % ⇒ plat ;
 * - département / région : ratio de leurs comcoms complétées → bronze (≥25) / or (≥50) / plat (≥90).
 *
 * @returns le badge d'affichage, ou `null` si l'ID est inconnu / la zone introuvable.
 */
export function resolveEquippedBadge(
  id: string,
  zones: ZoneData,
  completedComcomIds: Set<string>
): DisplayBadge | null {
  if (id === 'france') {
    return { id, name: 'France', image: '/assets/badges/France.png' }
  }

  const sep = id.indexOf(':')
  if (sep === -1) return null
  const prefix = id.slice(0, sep)
  const docId = id.slice(sep + 1)
  if (!docId) return null

  if (prefix === 'comcom') {
    const c = zones.comcoms.find((z) => z.documentId === docId)
    // Un comcom équipé est complété (validé serveur) → plat.
    return c ? { id, name: c.name, image: '/assets/badges/Com/Com_Plat.png' } : null
  }

  if (prefix === 'dept') {
    const d = zones.departments.find((z) => z.documentId === docId)
    if (!d) return null
    const comcomsInDept = zones.comcoms.filter((c) => c.department?.documentId === docId)
    const tier = tierFromCompletion(completionRatio(comcomsInDept, completedComcomIds))
    return { id, name: d.name, image: `/assets/badges/Dep/Dep_${TIER_FILE[tier]}.png` }
  }

  if (prefix === 'region') {
    const r = zones.regions.find((z) => z.documentId === docId)
    if (!r) return null
    // Comcoms de la région = comcoms dont le département appartient à cette région.
    const deptIds = new Set(
      zones.departments.filter((d) => d.region?.documentId === docId).map((d) => d.documentId)
    )
    const comcomsInRegion = zones.comcoms.filter(
      (c) => c.department?.documentId && deptIds.has(c.department.documentId)
    )
    const tier = tierFromCompletion(completionRatio(comcomsInRegion, completedComcomIds))
    return { id, name: r.name, image: regionImage(r.name, tier) }
  }

  return null
}
