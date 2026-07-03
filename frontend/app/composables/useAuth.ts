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
 * - `reconcileUser` purge les stores Pinia persistés si l'utilisateur courant diffère du
 *   dernier connu sur cet appareil (anti-fuite cross-user, device partagé sans logout).
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

const LAST_USER_KEY = 'cq_last_user_id'

export function useAuth() {
  const user = useState<CqUser | null>('cq_user', () => null)

  /**
   * Anti-fuite cross-user : si les stores persistés (localStorage) appartiennent à un
   * autre utilisateur que celui qui se (re)connecte sur cet appareil, on les purge.
   * Client-only (localStorage). No-op si `id` est absent.
   */
  function reconcileUser(id?: number | null) {
    if (!import.meta.client || id == null) return
    const last = localStorage.getItem(LAST_USER_KEY)
    if (last && last !== String(id)) {
      clearPiniaStores()
    }
    localStorage.setItem(LAST_USER_KEY, String(id))
  }

  async function fetchMe(): Promise<CqUser | null> {
    const fetcher = import.meta.server ? useRequestFetch() : $fetch
    try {
      user.value = await fetcher<CqUser>('/api/auth/me')
      reconcileUser(user.value?.id)
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
    reconcileUser(res.user?.id)
    return res.user
  }

  async function register(body: Record<string, unknown>): Promise<CqUser> {
    const res = await $fetch<{ user: CqUser }>('/api/auth/register', {
      method: 'POST',
      body,
    })
    user.value = res.user
    reconcileUser(res.user?.id)
    return res.user
  }

  async function logout(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  /**
   * Demande un e-mail de réinitialisation. Ne lève jamais pour cause d'e-mail inconnu :
   * le BFF renvoie toujours un succès (anti-énumération).
   */
  async function forgotPassword(email: string): Promise<void> {
    await $fetch('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
    })
  }

  /**
   * Soumet le nouveau mot de passe avec le `code` reçu par e-mail. En cas de succès, le BFF
   * pose le cookie de session → l'utilisateur est connecté (comme après un login).
   */
  async function resetPassword(code: string, password: string, passwordConfirmation: string): Promise<CqUser> {
    const res = await $fetch<{ user: CqUser }>('/api/auth/reset-password', {
      method: 'POST',
      body: { code, password, passwordConfirmation },
    })
    user.value = res.user
    reconcileUser(res.user?.id)
    return res.user
  }

  return { user, fetchMe, login, register, logout, forgotPassword, resetPassword, reconcileUser }
}
