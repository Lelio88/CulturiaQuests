/**
 * useAuth — état d'authentification de l'app adossé au BFF httpOnly.
 *
 * Remplace l'état auto de `useStrapiUser()`/`useStrapiAuth()` : l'utilisateur courant est
 * lu via GET /api/auth/me (le serveur lit le cookie HTTP-ONLY `cq_session`), et les actions
 * login/register/logout passent par /api/auth/*. Le token ne transite jamais par le JS.
 *
 * Choix non évidents :
 * - `user` est un `useState` (partagé app-wide + sérialisé SSR→client → pas de flash de
 *   déconnexion à l'hydratation).
 * - `fetchMe` utilise `useRequestFetch()` en SSR (propage le cookie entrant) ; sur le client
 *   un `$fetch` suffit (cookie same-origin envoyé automatiquement).
 * - login/register/logout sont déclenchés par interaction → toujours côté client : le
 *   Set-Cookie d'une sous-requête Nitro en SSR ne remonterait pas au navigateur.
 *
 * @example
 * const { user, login, logout } = useAuth()
 * await login(identifier, password)
 */
export interface CqUser {
  id: number
  documentId?: string
  username: string
  email: string
  role?: { id: number; name: string; type: string }
  [key: string]: unknown
}

export function useAuth() {
  const user = useState<CqUser | null>('cq_user', () => null)

  async function fetchMe(): Promise<CqUser | null> {
    const fetcher = import.meta.server ? useRequestFetch() : $fetch
    try {
      user.value = await fetcher<CqUser>('/api/auth/me')
    } catch {
      user.value = null
    }
    return user.value
  }

  async function login(identifier: string, password: string): Promise<CqUser> {
    const res = await $fetch<{ user: CqUser }>('/api/auth/login', {
      method: 'POST',
      body: { identifier, password },
    })
    user.value = res.user
    return res.user
  }

  async function register(body: Record<string, unknown>): Promise<CqUser> {
    const res = await $fetch<{ user: CqUser }>('/api/auth/register', {
      method: 'POST',
      body,
    })
    user.value = res.user
    return res.user
  }

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  return { user, fetchMe, login, register, logout }
}
