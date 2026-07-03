/**
 * Deep-links natifs (Android App Links / iOS Universal Links).
 *
 * L'app mobile (Capacitor) charge le serveur Nuxt distant (option A). Quand un lien HTTPS de
 * notre domaine ouvre l'app — typiquement le lien de réinitialisation reçu par e-mail
 * (`https://culturia.heianenterprise.com/account/reset-password?code=XXX`) —, Android/iOS émet
 * un événement `appUrlOpen`. On route alors le WebView vers le chemin correspondant en
 * préservant `path + query` (donc le `?code=`).
 *
 * Choix non-évidents :
 * - Imports Capacitor DYNAMIQUES + garde `isNativePlatform()` : en web, `@capacitor/app` n'a pas
 *   de bridge natif ; on n'installe le listener qu'en contexte natif et on ne charge le module
 *   que là (bundle web inchangé).
 * - `useRouter()` est capturé SYNCHRONEMENT (avant tout await) pour ne pas perdre le contexte Nuxt.
 * - Sécurité (cf. anti open-redirect) : on ne route QUE les liens dont le host correspond à celui
 *   déjà chargé dans le WebView (`window.location.host`) — tout lien externe est ignoré.
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.client) return

  const router = useRouter()

  void (async () => {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return

    const { App } = await import('@capacitor/app')
    App.addListener('appUrlOpen', (event) => {
      let parsed: URL
      try {
        parsed = new URL(event.url)
      } catch {
        return
      }
      if (parsed.host !== window.location.host) return
      router.push(parsed.pathname + parsed.search)
    })
  })()
})
