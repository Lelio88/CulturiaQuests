/**
 * Composable for checking admin role status.
 * Uses two strategies:
 * 1. Sync: reads role.type from the user state (fast path)
 * 2. Async: calls /admin-dashboard/check endpoint (reliable fallback)
 */
// Dédup au scope MODULE : garantit un seul appel `/admin-dashboard/check` en vol quel que soit
// le nombre d'instances de useAdmin() montées simultanément. Un ref local ne dédupliquait pas
// entre instances → appels BFF redondants au premier chargement.
let verifyInFlight: Promise<void> | null = null

export function useAdmin() {
  const { user } = useAuth()
  const isAdminVerified = useState<boolean>('is_admin_verified', () => false)

  const isAdmin = computed(() => {
    const u = user.value as any
    return u?.role?.type === 'admin' || isAdminVerified.value
  })

  const adminChecked = computed(() => !!user.value)

  function verifyAdmin(): Promise<void> {
    if (!user.value || isAdminVerified.value) return Promise.resolve()
    if (verifyInFlight) return verifyInFlight
    verifyInFlight = (async () => {
      try {
        const client = useApi()
        const result: any = await client('/admin-dashboard/check')
        isAdminVerified.value = result?.isAdmin === true
      } catch {
        isAdminVerified.value = false
      } finally {
        verifyInFlight = null
      }
    })()
    return verifyInFlight
  }

  function checkAdminRole(): boolean {
    if (!user.value) return false
    return (user.value as any)?.role?.type === 'admin' || isAdminVerified.value
  }

  // Auto-verify on client when user is connected but not yet verified
  if (import.meta.client && user.value && !isAdminVerified.value) {
    verifyAdmin()
  }

  return {
    isAdmin,
    adminChecked,
    checkAdminRole,
    verifyAdmin,
  }
}
