/**
 * Helpers tableau partagés côté backend.
 */

/**
 * Mélange un tableau (Fisher-Yates) sur une COPIE — n'altère jamais l'entrée.
 * Mutualisé entre quest.service et quiz-generator (#56, déduplication).
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
