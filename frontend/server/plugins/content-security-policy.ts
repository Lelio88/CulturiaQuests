/**
 * Politique de sécurité du contenu (CSP) des pages rendues, avec un nonce par réponse.
 *
 * Nuxt insère ses propres scripts en ligne (configuration, données de la page) : sans nonce, il
 * faudrait `'unsafe-inline'`, qui laisse passer tout script injecté. Ici, chaque page reçoit un
 * nonce aléatoire, posé sur les `<script>` qu'elle contient au moment du rendu, et seul un script
 * porteur de ce nonce (ou servi par le site) s'exécute.
 *
 * Choix non-évidents :
 * - Le nonce est ajouté à **tous** les `<script` du document rendu. C'est sûr parce que Vue
 *   échappe le texte interpolé (`<` devient `&lt;`) et que l'app n'utilise aucun `v-html` : un
 *   contenu de joueur ne peut pas produire une balise `<script`. **Introduire un `v-html` sur un
 *   contenu de joueur rendrait ce nonce complice d'une injection.**
 * - Styles en ligne tolérés (`'unsafe-inline'` sur style-src) : Vue, Leaflet et les liaisons
 *   `:style` en posent partout, et un style injecté ne peut pas exécuter de code.
 * - Sources externes : les tuiles OpenStreetMap (images) et l'API Strapi publique (médias).
 *   Rien d'autre — le site ne charge aucun script, police ni service de Google.
 * - Pas de CSP en développement : Vite y injecte ses scripts de rechargement à chaud.
 * - Le pont de l'app Android (Capacitor 8) est injecté par la WebView elle-même
 *   (`addDocumentStartJavaScript`), hors de portée de la CSP.
 */
import { randomBytes } from 'node:crypto'

function policy(nonce: string, strapiPublicUrl: string): string {
  const strapi = strapiPublicUrl.startsWith('http') ? new URL(strapiPublicUrl).origin : ''
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org ${strapi}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${strapi}`.trim(),
    `media-src 'self' ${strapi}`.trim(),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = randomBytes(16).toString('base64')
    event.context.cspNonce = nonce
    const withNonce = (chunk: string) => chunk.replace(/<script(?![^>]*\snonce=)/g, `<script nonce="${nonce}"`)
    html.head = html.head.map(withNonce)
    html.bodyPrepend = html.bodyPrepend.map(withNonce)
    html.body = html.body.map(withNonce)
    html.bodyAppend = html.bodyAppend.map(withNonce)
  })

  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (response.headers) delete response.headers['x-powered-by']
    const nonce = event.context.cspNonce as string | undefined
    if (!nonce || import.meta.dev) return
    const strapiPublicUrl = String(useRuntimeConfig(event).public?.strapi?.url ?? '')
    response.headers = { ...response.headers, 'content-security-policy': policy(nonce, strapiPublicUrl) }
  })
})
