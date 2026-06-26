/**
 * Utilitaire de nettoyage des stores Pinia persistés en localStorage.
 * (Les helpers de debug du localStorage ont été retirés — code mort, #53.)
 */

/**
 * Nettoie uniquement les stores Pinia du localStorage
 * Garde les autres données (par exemple, les préférences utilisateur)
 */
export function clearPiniaStores() {
  const piniaKeys = Object.keys(localStorage).filter(key =>
    key !== 'debug' // Garde les flags de debug si présents
  )

  piniaKeys.forEach(key => localStorage.removeItem(key))
}
