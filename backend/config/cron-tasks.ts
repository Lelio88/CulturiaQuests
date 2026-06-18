export default {
  /**
   * Génération automatique du quiz quotidien à minuit (Europe/Paris).
   * - Timeline via Ollama : best-effort (0 à 3 selon disponibilité).
   * - QCM depuis OpenQuizzDB (fichiers locaux) : complètent pour toujours atteindre 10 questions.
   * Le quiz reste disponible même si le serveur était down à minuit (rattrapage à la demande dans
   * le controller getTodayQuiz) ou si Ollama est indisponible (quiz 100 % QCM). Cf. quiz-generator.ts.
   */
  'generate-daily-quiz': {
    task: async ({ strapi }) => {
      try {
        const generator = strapi.service('api::quiz-session.quiz-generator');
        await generator.generateDailyQuiz();
      } catch (err) {
        strapi.log.error(`[cron] Erreur génération quiz : ${err instanceof Error ? err.message : err}`);
      }
    },
    options: {
      rule: '0 0 * * *',
      tz: 'Europe/Paris',
    },
  },
};
