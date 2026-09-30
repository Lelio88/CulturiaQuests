/**
 * BFF — Confirmation d'adresse, déclenchée par le bouton de la page `/account/confirm`.
 *
 * Le lien de l'e-mail mène à cette page plutôt qu'à Strapi : un scanner de messagerie qui suit
 * les liens ne confirme donc pas un compte à la place du titulaire de l'adresse. Strapi répond à
 * une confirmation réussie par une redirection (302) ; tout refus veut dire « lien plus valable ».
 */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readJsonObject(event)
  const confirmation = typeof body.confirmation === 'string' ? body.confirmation : ''
  if (!/^[a-f0-9]{20,128}$/i.test(confirmation)) throw authError(400, 'confirmation_link_invalid')

  const ip = playerIp(event)
  assertNotThrottled(event, [['loginByIp', ip]])

  try {
    const res = await $fetch.raw<unknown>(`${strapiBaseUrl(event)}/api/auth/email-confirmation`, {
      query: { confirmation },
      redirect: 'manual',
      headers: forwardedHeaders(event),
    })
    if (res.status >= 300 && res.status < 400) return { ok: true }
    // Strapi ne rend un 2xx que s'il n'a pas de page de retour configurée : c'est aussi un succès.
    if (res.status < 300) return { ok: true }
  } catch (err) {
    const { status } = strapiFailure(err)
    if (status && status < 500) {
      limiter('loginByIp').fail(ip)
      throw authError(400, 'confirmation_link_invalid')
    }
    throw translateStrapiError(err)
  }
  throw authError(400, 'confirmation_link_invalid')
})
