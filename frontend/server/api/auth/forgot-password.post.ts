/**
 * BFF — Mot de passe oublié (demande d'e-mail de réinitialisation).
 *
 * Renvoie TOUJOURS { ok: true }, quelle que soit l'issue — anti-énumération : le client ne doit
 * pas pouvoir distinguer « e-mail inconnu », « e-mail envoyé » ou « échec SMTP ». Les erreurs
 * réelles sont journalisées côté serveur (sans l'e-mail). Limité par adresse et par IP : sans
 * cela, le formulaire servirait à inonder une boîte de messages.
 */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readJsonObject(event)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const ip = playerIp(event)

  assertNotThrottled(event, [['emailByAddress', email], ['emailByIp', ip]])
  limiter('emailByIp').hit(ip)
  if (email) limiter('emailByAddress').hit(email)

  return withMinimumDuration(600, async () => {
    if (email) {
      try {
        await $fetch<unknown>(`${strapiBaseUrl(event)}/api/auth/forgot-password`, {
          method: 'POST',
          body: { email },
          headers: forwardedHeaders(event),
        })
      } catch (err) {
        console.error('[auth/forgot-password] échec relais Strapi :', strapiFailure(err).status ?? (err as Error)?.message)
      }
    }
    return { ok: true }
  })
})
