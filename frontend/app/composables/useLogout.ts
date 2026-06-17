/**
 * Composable de déconnexion complète.
 * Efface la session httpOnly (BFF `cq_session`), tous les stores Pinia, le localStorage,
 * puis force un reload pour repartir d'un état propre.
 *
 * INVARIANT (anti-fuite cross-user, ne pas retirer) : `localStorage.clear()` +
 * `sessionStorage.clear()` + reload externe — sinon l'utilisateur suivant sur le même
 * appareil hériterait des stores persistés du précédent.
 */
export function useLogout() {
  const { logout: authLogout } = useAuth()
  const guildStore = useGuildStore()

  async function logout(redirectTo: string = '/') {
    // 1. Efface la session httpOnly côté serveur (cookie cq_session). Best-effort :
    //    on poursuit le nettoyage local même si l'appel réseau échoue.
    try {
      await authLogout()
    } catch {
      // ignore — le nettoyage local ci-dessous reste impératif
    }

    // 2. Défensif : efface un éventuel cookie `culturia_jwt` résiduel (legacy
    //    @nuxtjs/strapi, retiré au cutover #17). No-op s'il est httpOnly.
    useCookie('culturia_jwt', { path: '/' }).value = null

    // 3. Purge tous les stores Pinia
    guildStore.clearAll()

    // 4. Vide localStorage + sessionStorage (INVARIANT anti-fuite cross-user)
    if (import.meta.client) {
      localStorage.clear()
      sessionStorage.clear()
    }

    // 5. Reload complet
    await navigateTo(redirectTo, { external: true })
  }

  return {
    logout,
  }
}
