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
 * - `register` ne connecte pas : l'adresse doit d'abord être confirmée (lien par e-mail), et la
 *   réponse est la même que l'adresse soit neuve ou déjà inscrite (anti-énumération).
 * - `signInWithGoogle` rend soit l'utilisateur, soit `onboarding` (adresse inconnue → écran de
 *   fin d'inscription `/account/google`).
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
  /** Les CGU acceptées ne sont plus les courantes : écran de réacceptation. */
  terms_outdated?: boolean
  [key: string]: unknown
}

export type GoogleSignInResult = { user: CqUser } | { onboarding: true; email?: string }

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
    // Cast par branche (cf. useApi) : évite le calcul du type union `useRequestFetch() | $fetch`
    // qui fait résoudre le registre de routes Nitro (récursif) → TS2321 « Excessive stack depth ».
    type SimpleFetch = <T>(request: string, opts?: Record<string, unknown>) => Promise<T>
    const fetcher: SimpleFetch = import.meta.server
      ? (useRequestFetch() as unknown as SimpleFetch)
      : ($fetch as unknown as SimpleFetch)
    try {
      user.value = await fetcher<CqUser>('/api/auth/me')
      reconcileUser(user.value?.id)
    } catch {
      user.value = null
    }
    return user.value
  }

  async function login(identifier: string, password: string): Promise<CqUser> {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { identifier, password },
    })
    // /me plutôt que la réponse du login : il porte le rôle et l'état des CGU.
    const me = await fetchMe()
    if (!me) throw new Error('Session non ouverte')
    return me
  }

  /** Crée le compte, la guilde et le personnage ; le joueur reçoit un lien de confirmation. */
  async function register(body: Record<string, unknown>): Promise<void> {
    await $fetch('/api/auth/register', { method: 'POST', body })
  }

  async function confirmEmail(confirmation: string): Promise<void> {
    await $fetch('/api/auth/confirm-email', { method: 'POST', body: { confirmation } })
  }

  /** Renvoie le lien de confirmation ; ne dit jamais si l'adresse existe. */
  async function resendConfirmation(email: string): Promise<void> {
    await $fetch('/api/auth/resend-confirmation', { method: 'POST', body: { email } })
  }

  /** Échange un jeton d'identité Google (greffon natif) contre une session ou une inscription à finir. */
  async function signInWithGoogle(idToken: string): Promise<GoogleSignInResult> {
    const res = await $fetch<{ user?: CqUser; onboarding?: true; email?: string }>('/api/auth/google', {
      method: 'POST',
      body: { idToken },
    })
    if (res.user) {
      user.value = res.user
      reconcileUser(res.user.id)
      return { user: res.user }
    }
    return { onboarding: true, email: res.email }
  }

  /** Fin d'inscription Google : crée le compte et ouvre la session. */
  async function completeGoogleRegistration(body: Record<string, unknown>): Promise<CqUser> {
    await $fetch('/api/auth/google/register', { method: 'POST', body })
    // La réponse ne porte que l'essentiel ; /me rend l'utilisateur complet (rôle, CGU).
    const me = await fetchMe()
    if (!me) throw new Error('Session non ouverte')
    return me
  }

  /** Enregistre l'acceptation des CGU courantes (version fournie par la page). */
  async function acceptTerms(version: string): Promise<void> {
    await $fetch('/api/strapi/users/me/accept-terms', { method: 'POST', body: { version } })
    if (user.value) user.value = { ...user.value, terms_outdated: false }
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
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: { code, password, passwordConfirmation },
    })
    const me = await fetchMe()
    if (!me) throw new Error('Session non ouverte')
    return me
  }

  return {
    user,
    fetchMe,
    login,
    register,
    confirmEmail,
    resendConfirmation,
    signInWithGoogle,
    completeGoogleRegistration,
    acceptTerms,
    logout,
    forgotPassword,
    resetPassword,
    reconcileUser,
  }
}
