/**
 * BFF — Renvoi du lien de confirmation d'adresse.
 *
 * Toujours { ok: true } (anti-énumération : ni « adresse inconnue » ni « déjà confirmée »),
 * limité par adresse et par IP comme « mot de passe oublié ».
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
        await $fetch<unknown>(`${strapiBaseUrl(event)}/api/auth/send-email-confirmation`, {
          method: 'POST',
          body: { email },
          headers: forwardedHeaders(event),
        })
      } catch (err) {
        // « Already confirmed », adresse inconnue… : rien n'est dit au client.
        const { status } = strapiFailure(err)
        if (!status || status >= 500) console.error('[auth/resend-confirmation] échec relais Strapi :', status)
      }
    }
    return { ok: true }
  })
})
