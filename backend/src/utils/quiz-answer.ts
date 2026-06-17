/**
 * Normalisation des réponses de quiz (QCM).
 *
 * OpenQuizzDB stocke parfois la `réponse` correcte avec une casse, des espaces
 * ou des accents qui diffèrent de la proposition affichée — la comparaison stricte
 * `userAnswer === correct_answer` échouerait alors et la bonne réponse serait
 * inatteignable. On compare donc sur une forme normalisée (sans diacritiques,
 * sans casse, trim).
 *
 * Utilisé à deux endroits :
 *  - génération (quiz-generator) : aligner `correct_answer` sur la proposition exacte
 *  - scoring (quiz-attempt) : filet de sécurité pour les données déjà en base
 *
 * @example normalizeAnswer('  Leonard de Vinci ') === normalizeAnswer('leonard de vinci') // true
 */

// Plage Unicode des "combining diacritical marks" (construite en chaîne ASCII
// pour garder le source portable, sans caractère combinant littéral).
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizeAnswer(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .trim()
    .toLowerCase();
}
