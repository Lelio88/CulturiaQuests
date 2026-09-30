/**
 * Limitation des tentatives d'authentification, en mémoire du serveur Nuxt.
 *
 * Règle du conteneur (conformite-securite-guide §C1) : quelques essais libres, puis un délai
 * qui double à chaque nouvel échec, plafonné ; **jamais** de verrouillage définitif (sinon
 * n'importe qui bloquerait le compte d'autrui). La clé combine le compte visé et l'IP : un
 * attaquant ne bloque pas un joueur depuis une autre adresse, et une IP ne peut pas essayer
 * mille comptes (compteur par IP à part).
 *
 * Choix non-évidents :
 * - En mémoire : un seul conteneur Nuxt sert le site. Un redémarrage remet les compteurs à
 *   zéro, ce qui reste sans danger : la limite native de Strapi (par IP) tient derrière.
 * - `hit` compte toute tentative (inscription, e-mails envoyés), `fail` seulement les échecs
 *   (connexion) : un joueur qui se connecte souvent n'a pas à attendre.
 * - Les entrées s'oublient une heure après la dernière tentative ; le ménage se fait au fil de
 *   l'eau, sans minuterie.
 *
 * @example
 * const limiter = createThrottle({ freeAttempts: 5 })
 * const wait = limiter.retryAfter(key)          // secondes à attendre, 0 si libre
 * if (wait > 0) throw createError({ statusCode: 429 })
 * ok ? limiter.reset(key) : limiter.fail(key)
 */

interface Entry {
  count: number
  blockedUntil: number
  lastAt: number
}

export interface ThrottleOptions {
  /** Tentatives sans délai : la suivante attend (5 → le 6ᵉ essai attend le premier délai). */
  freeAttempts: number
  /** Premier délai, doublé ensuite à chaque tentative de plus. */
  baseDelayMs?: number
  maxDelayMs?: number
  forgetAfterMs?: number
  now?: () => number
}

export function createThrottle(options: ThrottleOptions) {
  const baseDelay = options.baseDelayMs ?? 30_000
  const maxDelay = options.maxDelayMs ?? 15 * 60_000
  const forgetAfter = options.forgetAfterMs ?? 60 * 60_000
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry>()

  function prune(at: number): void {
    if (entries.size < 1000) return
    for (const [key, entry] of entries) {
      if (at - entry.lastAt > forgetAfter && at >= entry.blockedUntil) entries.delete(key)
    }
  }

  function current(key: string, at: number): Entry | undefined {
    const entry = entries.get(key)
    if (entry && at - entry.lastAt > forgetAfter && at >= entry.blockedUntil) {
      entries.delete(key)
      return undefined
    }
    return entry
  }

  function record(key: string): void {
    const at = now()
    prune(at)
    const entry = current(key, at) ?? { count: 0, blockedUntil: 0, lastAt: at }
    entry.count += 1
    entry.lastAt = at
    if (entry.count >= options.freeAttempts) {
      const over = entry.count - options.freeAttempts
      entry.blockedUntil = at + Math.min(maxDelay, baseDelay * 2 ** over)
    }
    entries.set(key, entry)
  }

  return {
    /** Secondes à attendre avant la prochaine tentative (0 = libre). */
    retryAfter(key: string): number {
      const at = now()
      const entry = current(key, at)
      return entry && entry.blockedUntil > at ? Math.ceil((entry.blockedUntil - at) / 1000) : 0
    },
    /** Compte une tentative (échec de connexion, ou toute demande pour les routes qui envoient un e-mail). */
    fail: record,
    hit: record,
    reset(key: string): void {
      entries.delete(key)
    },
  }
}
