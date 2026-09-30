/**
 * BFF — Inscription : compte, guilde et personnage en une requête.
 *
 * Strapi crée le tout puis envoie un lien de confirmation (`lib/registration.ts`). La réponse est
 * **toujours** `{ pending: true }`, que l'adresse soit neuve ou déjà inscrite (son titulaire est
 * alors prévenu par e-mail) : l'inscription ne révèle pas qui a un compte. Seules les erreurs de
 * saisie et « pseudo déjà pris » (public dans le jeu) sont dites.
 *
 * Aucun cookie n'est posé : le joueur se connecte après avoir confirmé son adresse.
 */
const FIELDS = [
  'username',
  'email',
  'password',
  'date_of_birth',
  'terms_accepted',
  'guildName',
  'firstname',
  'lastname',
  'iconId',
] as const

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readJsonObject(event)
  const payload = Object.fromEntries(FIELDS.map((field) => [field, body[field]]))

  const ip = playerIp(event)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  assertNotThrottled(event, [['registerByIp', ip], ['emailByAddress', email]])
  limiter('registerByIp').hit(ip)

  // Plancher large : la voie « adresse déjà prise » envoie un e-mail, comme la voie normale,
  // mais sans hachage ni écritures ; le plancher efface cette différence.
  return withMinimumDuration(1200, async () => {
    try {
      await $fetch<unknown>(`${strapiBaseUrl(event)}/api/auth/local/register`, {
        method: 'POST',
        body: payload,
        headers: forwardedHeaders(event),
      })
    } catch (err) {
      throw translateStrapiError(err, 'registration_failed')
    }
    // Seule une inscription acceptée envoie un e-mail (lien ou avertissement de doublon) : c'est
    // elle qui compte pour l'adresse, pas une saisie refusée.
    if (email) limiter('emailByAddress').hit(email)
    return { pending: true }
  })
})
