/**
 * Règles de saisie du compte, côté écran : confort d'ergonomie seulement.
 *
 * La règle qui fait foi vit côté serveur (`backend/src/utils/account-rules.ts`) ; celle-ci
 * l'annonce avant l'envoi pour éviter un aller-retour. Les deux doivent dire la même chose.
 */
export const MIN_AGE = 15

/** Message d'erreur de date de naissance, ou '' si valide (ou pas encore saisie). */
export function birthDateError(value: string, today = new Date()): string {
  if (!value) return ''
  const birth = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(birth.getTime())) return 'Date invalide.'
  let age = today.getUTCFullYear() - birth.getUTCFullYear()
  const monthDiff = today.getUTCMonth() - birth.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) age--
  if (age < 0 || age > 120) return 'Date invalide.'
  if (age < MIN_AGE) return `Vous devez avoir au moins ${MIN_AGE} ans pour vous inscrire.`
  return ''
}

/** Message d'erreur de mot de passe, ou '' si valide (ou pas encore saisi). */
export function passwordRuleError(password: string): string {
  if (!password) return ''
  if (password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.'
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.'
  }
  return ''
}
