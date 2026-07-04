/**
 * Utilitaire de nettoyage des stores Pinia persistés en localStorage.
 * (Les helpers de debug du localStorage ont été retirés — code mort, #53.)
 */

// Clés à PRÉSERVER lors d'un logout : préférences d'APPAREIL (consentement géoloc) et flags debug.
// Tout le reste (stores Pinia + `quiz_current_session`, spécifiques à l'utilisateur) est effacé.
const PRESERVE_KEYS = new Set(['debug', 'culturia_geoloc_choice'])

/**
 * Efface les données localStorage spécifiques à l'utilisateur (stores Pinia persistés + session
 * quiz), en PRÉSERVANT les préférences d'appareil listées dans PRESERVE_KEYS (notamment le
 * consentement géoloc, pour ne pas re-prompter au changement d'utilisateur).
 */
export function clearPiniaStores() {
  Object.keys(localStorage)
    .filter(key => !PRESERVE_KEYS.has(key))
    .forEach(key => localStorage.removeItem(key))
}
