/**
 * Suppression complète du compte : DELETE /api/strapi/user-settings/me (purge RGPD côté
 * serveur, sessions révoquées), puis déconnexion locale (`useLogout`, qui vide les stores).
 *
 * `redirectTo` : l'app revient à l'accueil ; la page web de suppression revient sur elle-même
 * avec un message de confirmation.
 */
export function useDeleteAccount() {
  const { logout } = useLogout()
  const client = useApi()
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function deleteAccount(redirectTo = '/') {
    loading.value = true
    error.value = null

    try {
      await client('/user-settings/me', {
        method: 'DELETE',
      })
      await logout(redirectTo)
    } catch (e: any) {
      error.value = 'La suppression n’a pas abouti. Réessayez, ou écrivez à heianenterpriseyt@gmail.com.'
      console.error('[suppression] échec :', e?.status ?? e?.message)
    } finally {
      loading.value = false
    }
  }

  return { deleteAccount, loading, error }
}
