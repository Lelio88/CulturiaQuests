/**
 * Déclenche une demande RGPD (export des données personnelles) côté joueur en appelant
 * l'endpoint custom `POST /gdpr-request`, et expose l'état réactif de la requête.
 *
 * La demande est rattachée à l'utilisateur authentifié côté backend (aucun identifiant n'est
 * envoyé depuis le client) ; le message de succès renvoyé par l'API est exposé tel quel.
 *
 * @returns `requestData` (déclencheur async) et les refs réactives `loading`, `error`, `success`.
 * @example
 * const { requestData, loading, error, success } = useGdprRequest()
 * await requestData()
 */
export function useGdprRequest() {
  const client = useApi()
  const loading = ref(false)
  const error = ref<string | null>(null)
  const success = ref<string | null>(null)

  async function requestData() {
    loading.value = true
    error.value = null
    success.value = null
    try {
      const res = await client<{ message: string }>('/gdpr-request', { method: 'POST' })
      success.value = res.message
    } catch (e: any) {
      error.value = e?.data?.error?.message || e?.message || 'Erreur lors de la demande'
    } finally {
      loading.value = false
    }
  }

  return { requestData, loading, error, success }
}
