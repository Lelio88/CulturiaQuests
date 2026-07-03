/**
 * BFF — Mot de passe oublié (demande d'e-mail de réinitialisation).
 *
 * Relaie { email } vers Strapi /api/auth/forgot-password (qui génère un token de reset et
 * envoie l'e-mail via le provider SMTP). Renvoie TOUJOURS { ok: true }, quelle que soit
 * l'issue — anti-énumération : le client ne doit pas pouvoir distinguer « e-mail inconnu »,
 * « e-mail envoyé » ou « échec SMTP ». Les erreurs réelles sont journalisées côté serveur
 * (sans l'e-mail — PII).
 */
export default defineEventHandler(async (event) => {
  const { email } = await readBody(event)
  const strapiUrl = useRuntimeConfig(event).strapi?.url || 'http://localhost:1337'

  if (email && typeof email === 'string') {
    try {
      await $fetch(`${strapiUrl}/api/auth/forgot-password`, {
        method: 'POST',
        body: { email },
      })
    } catch (err: any) {
      // Jamais propagé au client (anti-énumération). Statut seul, pas l'e-mail.
      console.error('[auth/forgot-password] échec relais Strapi:', err?.response?.status || err?.message)
    }
  }

  return { ok: true }
})
