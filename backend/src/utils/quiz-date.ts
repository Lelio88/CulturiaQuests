/**
 * Helpers de date pour le quiz quotidien.
 *
 * Le cron de génération tourne en `Europe/Paris` (cf. config/cron-tasks.ts). La
 * clé de date d'une session DOIT donc être calculée dans ce même fuseau, et non
 * en UTC : à minuit Paris (= 22h/23h UTC la veille), `new Date().toISOString()`
 * renvoie la date de la veille, la session est mal étiquetée et `getTodaySession`
 * ne la retrouve plus une grande partie de la journée.
 *
 * Invariant : la génération (quiz-generator), la lecture (quiz-session.getTodaySession,
 * controller.generate) et le calcul du streak (quiz-attempt) doivent TOUS utiliser
 * la même clé `getParisDateKey()` au format `YYYY-MM-DD`.
 *
 * @example
 *   const today = getParisDateKey();          // "2026-06-17"
 *   const hier  = previousDateKey(today);      // "2026-06-16"
 */

const PARIS_TZ = 'Europe/Paris';

/**
 * Date calendaire courante en Europe/Paris, au format ISO `YYYY-MM-DD`.
 */
export function getParisDateKey(date: Date = new Date()): string {
  // 'en-CA' produit le format YYYY-MM-DD ; le timeZone fait le décalage correct.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Clé du jour calendaire précédant une clé `YYYY-MM-DD`.
 * Arithmétique calendaire pure (insensible au fuseau et au changement d'heure).
 */
export function previousDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(prev);
}
