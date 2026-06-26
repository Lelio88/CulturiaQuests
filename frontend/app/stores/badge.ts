// stores/badge.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useZoneStore } from '~/stores/zone'
import { useProgressionStore } from '~/stores/progression'
import { useFogStore } from '~/stores/fog'

export interface ZoneBadge {
  id: string           // 'comcom:{docId}' | 'dept:{docId}' | 'region:{docId}' | 'france'
  name: string
  category: 'comcom' | 'departement' | 'region' | 'special'
  completion: number   // 0-100
  tier: 'none' | 'bronze' | 'gold' | 'plat'
  image: string
  visible: boolean
}

function getTier(completion: number): ZoneBadge['tier'] {
  if (completion >= 90) return 'plat'
  if (completion >= 50) return 'gold'
  if (completion >= 25) return 'bronze'
  return 'none'
}

function getComcomImage(tier: ZoneBadge['tier']): string {
  const map = { none: 'Bronze', bronze: 'Bronze', gold: 'Gold', plat: 'Plat' }
  return `/assets/badges/Com/Com_${map[tier]}.png`
}

function getDeptImage(tier: ZoneBadge['tier']): string {
  const map = { none: 'Bronze', bronze: 'Bronze', gold: 'Gold', plat: 'Plat' }
  return `/assets/badges/Dep/Dep_${map[tier]}.png`
}

// Mapping des noms de régions BDD → noms de dossiers/fichiers dans les assets
// Seul "La Réunion" diffère (espace → tiret dans le dossier)
const REGION_NAME_MAP: Record<string, string> = {
  'La Réunion': 'La-Réunion'
}

function getRegionImage(name: string, tier: ZoneBadge['tier']): string {
  const tierName = tier === 'none' ? 'Bronze' : tier === 'bronze' ? 'Bronze' : tier === 'gold' ? 'Gold' : 'Plat'
  const assetName = REGION_NAME_MAP[name] || name

  // La-Réunion Gold a une double extension .png.png dans les assets
  if (assetName === 'La-Réunion' && tierName === 'Gold') {
    return `/assets/badges/Reg/${encodeURIComponent(assetName)}/${encodeURIComponent(assetName)}_Gold.png.png`
  }

  return `/assets/badges/Reg/${encodeURIComponent(assetName)}/${encodeURIComponent(assetName)}_${tierName}.png`
}

/**
 * Store des badges de zones (comcom / département / région + badge spécial France)
 * dérivés de la progression du joueur, et gestion des badges équipés.
 *
 * Les badges ne sont pas stockés : ils sont calculés à la volée à partir des
 * stores `zone`, `progression` et `fog`. La complétion détermine un palier
 * (`tier` : none/bronze/gold/plat) via `getTier`, qui sélectionne l'image
 * d'asset correspondante.
 *
 * Choix non-évidents :
 * - Complétion comcom : on prend 100 % si `progression.isComcomCompleted`,
 *   sinon le ratio de couverture du fog (la fog est nettoyée après complétion,
 *   d'où la priorité donnée à la progression).
 * - Index pré-calculés `comcomsByDept` / `deptDocIdsByRegion` (passe O(n)) pour
 *   éviter un re-scan O(départements × comcoms) dans les badges dépt/région (#31).
 * - `REGION_NAME_MAP` corrige les écarts nom BDD → nom de fichier d'asset
 *   (« La Réunion » → « La-Réunion ») ; cas spécial double extension
 *   `.png.png` pour « La-Réunion Gold ».
 * - `EXCLUDED_REGIONS` : territoires sans assets de badge, exclus du rendu.
 *
 * Invariants à préserver :
 * - Seul `equippedIds` est persisté (localStorage via Pinia).
 * - Maximum 4 badges équipés ; un badge de palier `none` ne peut pas être équipé.
 * - Les computed retournent `[]` côté serveur (`import.meta.server`) car les
 *   stores dépendants lisent IndexedDB/localStorage (indisponibles en SSR).
 *
 * @example
 * const badgeStore = useBadgeStore()
 * badgeStore.toggleEquip('comcom:abc123') // équipe/déséquipe (max 4)
 * const equipped = badgeStore.equippedBadges
 */
export const useBadgeStore = defineStore('badge', () => {
  const equippedIds = ref<string[]>([])

  // Computed : badges comcoms
  const comcomBadges = computed<ZoneBadge[]>(() => {
    // SSR guard : les stores dépendants utilisent IndexedDB/localStorage
    if (import.meta.server) return []

    const zoneStore = useZoneStore()
    const progressionStore = useProgressionStore()
    const fogStore = useFogStore()

    return zoneStore.comcoms
      .map(comcom => {
        // Progression d'abord (fog nettoyée après complétion), puis fog
        let completion: number
        if (progressionStore.isComcomCompleted(comcom.documentId)) {
          completion = 100
        } else {
          completion = fogStore.getCoverageRatio(comcom.documentId) * 100
        }

        const tier = getTier(completion)
        return {
          id: `comcom:${comcom.documentId}`,
          name: comcom.name,
          category: 'comcom' as const,
          completion,
          tier,
          image: getComcomImage(tier),
          visible: completion > 1
        }
      })
      .filter(b => b.visible)
  })

  // Index pré-calculés (une passe O(n)) pour éviter le re-scan de TOUS les comcoms par
  // zone dans departmentBadges/regionBadges (qui était O(departments × comcoms)). #31
  const comcomsByDept = computed<Map<string, any[]>>(() => {
    const m = new Map<string, any[]>()
    for (const c of useZoneStore().comcoms) {
      const d = c.department?.documentId
      if (!d) continue
      if (!m.has(d)) m.set(d, [])
      m.get(d)!.push(c)
    }
    return m
  })
  const deptDocIdsByRegion = computed<Map<string, string[]>>(() => {
    const m = new Map<string, string[]>()
    for (const d of useZoneStore().departments) {
      const r = d.region?.documentId
      if (!r || !d.documentId) continue
      if (!m.has(r)) m.set(r, [])
      m.get(r)!.push(d.documentId)
    }
    return m
  })

  // Computed : badges départements
  const departmentBadges = computed<ZoneBadge[]>(() => {
    if (import.meta.server) return []

    const zoneStore = useZoneStore()
    const progressionStore = useProgressionStore()

    return zoneStore.departments.map(dept => {
      // % = comcoms complétées dans ce dept / total comcoms dans ce dept
      const comcomsInDept = comcomsByDept.value.get(dept.documentId) || []
      const totalComcoms = comcomsInDept.length
      if (totalComcoms === 0) {
        return {
          id: `dept:${dept.documentId}`,
          name: dept.name,
          category: 'departement' as const,
          completion: 0,
          tier: 'none' as const,
          image: getDeptImage('none'),
          visible: false
        }
      }

      const completedCount = comcomsInDept.filter(
        c => progressionStore.completedComcomIds.has(c.documentId)
      ).length
      const completion = (completedCount / totalComcoms) * 100

      const tier = getTier(completion)
      return {
        id: `dept:${dept.documentId}`,
        name: dept.name,
        category: 'departement' as const,
        completion,
        tier,
        image: getDeptImage(tier),
        visible: completion > 1
      }
    }).filter(b => b.visible)
  })

  // Régions exclues (territoires sans assets de badges)
  const EXCLUDED_REGIONS = new Set([
    'Terres australes et antarctiques françaises',
    'Île de Clipperton',
    'Saint-Pierre-et-Miquelon',
    'Saint-Martin',
    'Saint-Barthélemy',
    'Polynésie française',
    'Nouvelle-Calédonie',
    'Wallis et Futuna',
  ])

  // Computed : badges régions
  const regionBadges = computed<ZoneBadge[]>(() => {
    if (import.meta.server) return []

    const zoneStore = useZoneStore()
    const progressionStore = useProgressionStore()

    return zoneStore.regions.filter(r => !EXCLUDED_REGIONS.has(r.name)).map(region => {
      // % = comcoms complétées dans cette région / total comcoms dans cette région
      const comcomsInRegion = (deptDocIdsByRegion.value.get(region.documentId) || [])
        .flatMap(deptId => comcomsByDept.value.get(deptId) || [])
      const totalComcoms = comcomsInRegion.length
      if (totalComcoms === 0) {
        const tier = 'none' as const
        return {
          id: `region:${region.documentId}`,
          name: region.name,
          category: 'region' as const,
          completion: 0,
          tier,
          image: getRegionImage(region.name, tier),
          visible: true // Régions toujours visibles
        }
      }

      const completedCount = comcomsInRegion.filter(
        c => progressionStore.completedComcomIds.has(c.documentId)
      ).length
      const completion = (completedCount / totalComcoms) * 100

      const tier = getTier(completion)
      return {
        id: `region:${region.documentId}`,
        name: region.name,
        category: 'region' as const,
        completion,
        tier,
        image: getRegionImage(region.name, tier),
        visible: true // Régions toujours visibles
      }
    })
  })

  // Badge spécial France
  const franceBadge = computed<ZoneBadge | null>(() => {
    const allRegionsPlat = regionBadges.value.length > 0 &&
      regionBadges.value.every(r => r.tier === 'plat')

    if (!allRegionsPlat) return null

    return {
      id: 'france',
      name: 'France',
      category: 'special',
      completion: 100,
      tier: 'plat',
      image: '/assets/badges/France.png',
      visible: true
    }
  })

  // Tous les badges
  const allBadges = computed<ZoneBadge[]>(() => {
    const all: ZoneBadge[] = [
      ...comcomBadges.value,
      ...departmentBadges.value,
      ...regionBadges.value
    ]
    if (franceBadge.value) {
      all.push(franceBadge.value)
    }
    return all
  })

  // Badges équipés
  const equippedBadges = computed(() => {
    return equippedIds.value
      .map(id => allBadges.value.find(b => b.id === id))
      .filter((b): b is ZoneBadge => !!b && b.tier !== 'none')
  })

  const equippedCount = computed(() => equippedBadges.value.length)

  // Filtre par catégorie
  function badgesByCategory(category: string): ZoneBadge[] {
    if (category === 'comcom') return comcomBadges.value
    if (category === 'departement') return departmentBadges.value
    if (category === 'region') return regionBadges.value
    if (category === 'special') return franceBadge.value ? [franceBadge.value] : []
    return allBadges.value
  }

  /**
   * Persiste la sélection équipée côté serveur (#54). Le serveur (re)valide que chaque badge est
   * réellement gagné (progression complétée, serveur-autoritative) → source de vérité partagée,
   * visible des autres joueurs et cohérente multi-device.
   */
  async function syncEquippedToServer() {
    const client = useApi()
    await client('/guilds/badges/equip', {
      method: 'PUT',
      body: { badges: equippedIds.value },
    })
  }

  /**
   * Hydrate la sélection équipée depuis le serveur (le serveur fait foi). À appeler au montage des
   * écrans qui affichent/éditent les badges (badges.vue, guild.vue), une fois la guilde disponible.
   * En cas d'échec (hors-ligne), on conserve la valeur localStorage en repli.
   */
  async function hydrateFromServer() {
    const guildStore = useGuildStore()
    const guildDocId = guildStore.guild?.documentId
    if (!guildDocId) return
    try {
      const client = useApi()
      const res = await client<{ equippedBadgeIds?: string[] }>(`/guilds/${guildDocId}/badge-summary`)
      if (Array.isArray(res?.equippedBadgeIds)) {
        equippedIds.value = res.equippedBadgeIds
      }
    } catch (e: any) {
      console.error('Failed to hydrate equipped badges from server:', e)
    }
  }

  // Toggle équipement — optimiste, avec persistance serveur et rollback si le serveur refuse.
  async function toggleEquip(badgeId: string) {
    const badge = allBadges.value.find(b => b.id === badgeId)
    if (!badge || badge.tier === 'none') return

    const previous = [...equippedIds.value]
    const idx = equippedIds.value.indexOf(badgeId)
    if (idx !== -1) {
      equippedIds.value.splice(idx, 1)
    } else if (equippedIds.value.length < 4) {
      equippedIds.value.push(badgeId)
    } else {
      return // déjà 4 équipés : aucun changement
    }

    try {
      await syncEquippedToServer()
    } catch (e: any) {
      // Le serveur a refusé (badge non gagné) ou erreur réseau → on revient à l'état précédent.
      console.error('Failed to equip badges (rollback):', e)
      equippedIds.value = previous
    }
  }

  function isEquipped(badgeId: string): boolean {
    return equippedIds.value.includes(badgeId)
  }

  return {
    equippedIds,
    comcomBadges,
    departmentBadges,
    regionBadges,
    franceBadge,
    allBadges,
    equippedBadges,
    equippedCount,
    badgesByCategory,
    toggleEquip,
    isEquipped,
    syncEquippedToServer,
    hydrateFromServer
  }
}, {
  persist: {
    pick: ['equippedIds']
  }
})
