import {
  EMAIL_CONFIRMATION_SINCE,
  UNCONFIRMED_RETENTION_DAYS,
} from '../src/utils/account-rules';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Durée de conservation des journaux de connexion, annoncée dans la politique de confidentialité. */
const CONNECTION_LOG_RETENTION_MONTHS = 6;

function monthsAgo(months: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

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

  /**
   * Purges de conservation, chaque nuit à 4 h 17 (hors de la pointe du quiz de minuit) :
   * - journaux de connexion de plus de 6 mois (durée promise par la politique) ;
   * - inscriptions jamais confirmées après 7 jours, avec guilde et personnage (purgeUserData).
   *   Seules les inscriptions postérieures à `EMAIL_CONFIRMATION_SINCE` sont visées : les comptes
   *   antérieurs n'avaient pas de confirmation à suivre.
   */
  'purge-retention': {
    task: async ({ strapi }) => {
      try {
        const logs = await strapi.db.query('api::connection-log.connection-log').deleteMany({
          where: { connected_at: { $lt: monthsAgo(CONNECTION_LOG_RETENTION_MONTHS) } },
        });
        if (logs?.count) strapi.log.info(`[cron] ${logs.count} journal(aux) de connexion purgé(s)`);

        const stale = await strapi.db.query('plugin::users-permissions.user').findMany({
          where: {
            $or: [{ confirmed: false }, { confirmed: { $null: true } }],
            createdAt: {
              $gte: EMAIL_CONFIRMATION_SINCE,
              $lt: new Date(Date.now() - UNCONFIRMED_RETENTION_DAYS * DAY_MS),
            },
          },
          select: ['id'],
        });
        const purge = strapi.service('api::user-settings.user-settings');
        for (const user of stale) {
          await purge.purgeUserData(user.id);
        }
        if (stale.length) strapi.log.info(`[cron] ${stale.length} inscription(s) non confirmée(s) effacée(s)`);
      } catch (err) {
        strapi.log.error(`[cron] Erreur de purge : ${err instanceof Error ? err.message : err}`);
      }
    },
    options: {
      rule: '17 4 * * *',
      tz: 'Europe/Paris',
    },
  },
};
