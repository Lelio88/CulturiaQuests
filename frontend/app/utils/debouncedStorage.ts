/**
 * Storage compatible `pinia-plugin-persistedstate` qui **débounce** les écritures.
 *
 * Problème résolu (#23) : les stores sur le chemin chaud GPS (ex. `fog`) mutent à chaque
 * fix GPS → le plugin réécrit tout le blob dans `localStorage` à CHAQUE mutation (écriture
 * synchrone, jusqu'à plusieurs milliers de points) → saccades sur mobile.
 *
 * Ici les mutations restent instantanées (en mémoire) ; l'écriture disque est **coalescée**
 * (au plus une toutes les `delayMs`). Un **flush synchrone** sur `pagehide` /
 * `visibilitychange:hidden` garantit qu'on ne perd rien à la fermeture/navigation.
 *
 * SSR-safe : `localStorage`/`window` ne sont touchés que dans les méthodes (appelées
 * côté client par le plugin) et derrière `import.meta.client`.
 *
 * @example
 * defineStore('fog', () => ({ ... }), { persist: { pick: [...], storage: createDebouncedStorage() } })
 */
export function createDebouncedStorage(delayMs = 1000) {
  const pending = new Map<string, string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    for (const [k, v] of pending) localStorage.setItem(k, v)
    pending.clear()
  }

  if (import.meta.client) {
    // Ne rien perdre si l'app est fermée/mise en arrière-plan avant le flush débouncé.
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }

  return {
    // Lit la valeur en attente si présente (sinon le disque) → cohérence des reads.
    getItem: (key: string): string | null => (pending.has(key) ? pending.get(key)! : localStorage.getItem(key)),
    setItem: (key: string, value: string): void => {
      pending.set(key, value)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    removeItem: (key: string): void => {
      pending.delete(key)
      localStorage.removeItem(key)
    },
  }
}
