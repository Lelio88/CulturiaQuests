/**
 * useGoogleSignIn — « Continuer avec Google » dans l'application Android.
 *
 * Google refuse toute connexion dans une WebView ; l'app (Capacitor, qui affiche le site) passe
 * donc par un greffon natif maison, `GoogleSignIn` (android/app/src/main/java/…/GoogleSignInPlugin),
 * qui ouvre Credential Manager et rend un jeton d'identité. Le serveur le vérifie ensuite.
 *
 * Choix non-évidents :
 * - Rien dans un navigateur : ni bouton, ni script de Google (choix de l'utilisateur). Le bouton
 *   n'apparaît que si l'app qui affiche le site embarque le greffon — une version Play plus
 *   ancienne ne le montre donc pas.
 * - `available` n'est calculé qu'au montage (client) : le rendu serveur ne sait pas s'il tourne
 *   dans l'app, et un bouton présent d'un côté seulement casserait l'hydratation.
 * - Une annulation par le joueur (feuille Google refermée) n'est pas une erreur à afficher.
 *
 * @example
 * const { available, getIdToken } = useGoogleSignIn()
 * const idToken = await getIdToken()      // null si annulé
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

interface GoogleSignInPlugin {
  signIn(options: { serverClientId: string }): Promise<{ idToken: string }>
}

const GoogleSignIn = registerPlugin<GoogleSignInPlugin>('GoogleSignIn')

export function useGoogleSignIn() {
  const config = useRuntimeConfig()
  const available = ref(false)

  onMounted(() => {
    available.value =
      Capacitor.isNativePlatform() &&
      Capacitor.isPluginAvailable('GoogleSignIn') &&
      Boolean(config.public.googleWebClientId)
  })

  /** Jeton d'identité Google, ou null si le joueur a refermé la feuille de connexion. */
  async function getIdToken(): Promise<string | null> {
    try {
      const { idToken } = await GoogleSignIn.signIn({ serverClientId: String(config.public.googleWebClientId) })
      return idToken
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'canceled') return null
      throw e
    }
  }

  return { available, getIdToken }
}
