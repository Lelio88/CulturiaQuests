import type { Core } from '@strapi/strapi';
import fs from 'fs';
import path from 'path';

/**
 * Vérifie au démarrage que les données source du quiz quotidien sont présentes
 * (selected-quizzes.json + au moins un openquizzdb_*.json). Si elles manquent, log une ERREUR
 * explicite plutôt que de laisser la génération de minuit échouer silencieusement (#73).
 * Non bloquant : on ne fait pas planter le boot, mais l'absence est visible dans les logs.
 */
function checkQuizDataPresence(strapi: Core.Strapi) {
  const dataDir = path.join(process.cwd(), 'src', 'data', 'openquizzdb');
  const selectedPath = path.join(dataDir, 'selected-quizzes.json');

  if (!fs.existsSync(selectedPath)) {
    strapi.log.error(
      `[quiz] Données quiz ABSENTES : ${selectedPath} introuvable. La génération du quiz quotidien échouera. Vérifiez le build (Dockerfile « COPY . . » + backend/.dockerignore n'excluant pas src/data).`
    );
    return;
  }

  let sourceCount = 0;
  try {
    sourceCount = fs.readdirSync(dataDir).filter((f) => /^openquizzdb_\d+\.json$/.test(f)).length;
  } catch {
    sourceCount = 0;
  }

  if (sourceCount === 0) {
    strapi.log.error(
      `[quiz] Aucun fichier openquizzdb_*.json dans ${dataDir}. La génération des QCM échouera (la session du jour sera marquée "failed").`
    );
    return;
  }

  strapi.log.info(`[quiz] Données quiz présentes : selected-quizzes.json + ${sourceCount} fichiers openquizzdb.`);
}

/**
 * Helper: grants a list of permission actions to a role (idempotent)
 */
async function grantPermissions(strapi: Core.Strapi, roleId: number, actions: string[], roleName: string) {
  for (const action of actions) {
    const permission = await strapi.db.query('plugin::users-permissions.permission').findOne({
      where: {
        action,
        role: roleId,
      },
    });

    if (!permission) {
      await strapi.db.query('plugin::users-permissions.permission').create({
        data: {
          action,
          role: roleId,
        },
      });
      strapi.log.info(`Granted ${action} permission to ${roleName} role`);
    }
  }
}

/**
 * Crée (idempotent) les index DB custom non gérés par les schemas Strapi.
 * Ces colonnes scalaires sont filtrées/triées par des requêtes GLOBALES (analytics du
 * dashboard admin, filtres d'expédition) — là où l'index évite un seq scan à la croissance
 * des données. Les relations (guild/session/poi…) sont déjà indexées par Strapi via les
 * tables de liaison `_lnk`, inutile de les redoubler.
 * Réf : EPIC-PERF #20, story #21.
 */
async function ensureCustomIndexes(strapi: Core.Strapi) {
  const statements = [
    // getConnectionAnalytics : WHERE connected_at >= (12 dernières semaines)
    'CREATE INDEX IF NOT EXISTS idx_connection_logs_connected_at ON connection_logs (connected_at)',
    // run.controller : run active (date_end IS NULL) / terminées + analytics expéditions
    'CREATE INDEX IF NOT EXISTS idx_runs_date_end ON runs (date_end)',
    // dashboard économie/expéditions : séries temporelles par date_start
    'CREATE INDEX IF NOT EXISTS idx_runs_date_start ON runs (date_start)',
  ];
  for (const sql of statements) {
    try {
      await strapi.db.connection.raw(sql);
    } catch (err) {
      strapi.log.warn(`ensureCustomIndexes: échec « ${sql} » -> ${err}`);
    }
  }
  strapi.log.info('Custom DB indexes ensured (perf #21)');
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Grant permissions to Public role (unauthenticated users)
    const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'public' },
    });

    if (publicRole) {
      await grantPermissions(strapi, publicRole.id, [
        'plugin::users-permissions.auth.register',
        'api::character.character.getCharacterIcons',
      ], 'Public');
    }

    // Grant custom permissions to Authenticated role
    const authenticatedRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'authenticated' },
    });

    if (authenticatedRole) {
      await grantPermissions(strapi, authenticatedRole.id, [
        'api::guild.guild.setup',
        // Suppression de SA propre guilde (controller.delete vérifie l'ownership) — utilisé par le front
        'api::guild.guild.delete',
        'api::character.character.create',
        'api::character.character.getCharacterIcons',
        'api::item.item.getItemIcons',
        'api::museum.museum.find',
        'api::museum.museum.findOne',
        'api::poi.poi.find',
        'api::poi.poi.findOne',
        'api::tag.tag.find',
        'api::tag.tag.findOne',
        'api::statistic.statistic.getSummary',
        'api::visit.visit.openChest',
        'api::run.run.startExpedition',
        'api::run.run.endExpedition',
        'api::run.run.getActiveRun',
        // Player friendship permissions
        'api::player-friendship.player-friendship.find',
        'api::player-friendship.player-friendship.searchUser',
        'api::player-friendship.player-friendship.sendRequest',
        'api::player-friendship.player-friendship.acceptRequest',
        'api::player-friendship.player-friendship.rejectRequest',
        'api::player-friendship.player-friendship.removeFriend',
        'api::player-friendship.player-friendship.toggleFriendRequests',
        // Upload plugin — nécessaire pour POST /api/upload
        'plugin::upload.file.create',
        // User settings permissions
        'api::user-settings.user-settings.getSettings',
        'api::user-settings.user-settings.updateSettings',
        'api::user-settings.user-settings.uploadAvatar',
        'api::user-settings.user-settings.removeAvatar',
        'api::user-settings.user-settings.deleteAccount',
        // Quiz permissions
        // NB: quiz-session/quiz-question find/findOne ne sont volontairement PAS exposés :
        // ils divulgueraient correct_answer/explanation (triche). Le client passe par les
        // endpoints custom quiz-attempt (getTodayQuiz strippe les réponses).
        'api::quiz-attempt.quiz-attempt.find',
        'api::quiz-attempt.quiz-attempt.findOne',
        'api::quiz-attempt.quiz-attempt.create',
        'api::quiz-attempt.quiz-attempt.getTodayQuiz',
        'api::quiz-attempt.quiz-attempt.submitQuiz',
        'api::quiz-attempt.quiz-attempt.getTodayLeaderboard',
        'api::quiz-attempt.quiz-attempt.getMyHistory',
        // Post (social feed)
        'api::post.post.find',
        'api::post.post.create',
        'api::post.post.toggleLike',
        // GDPR
        'api::gdpr-request.gdpr-request.requestData',
        // Quest generation
        'api::quest.quest.generateDaily',
        // Progression / fog-of-war (le controller filtre tout par la guilde de l'utilisateur)
        'api::progression.progression.find',
        'api::progression.progression.findOne',
        'api::progression.progression.create',
        'api::progression.progression.update',
        // Friendship (legacy) — find/findOne filtrés par guild.user.id
        'api::friendship.friendship.find',
        'api::friendship.friendship.findOne',
        // Routes cœur (find/findOne) appelées par le front. Isolation vérifiée :
        // chaque controller filtre par la guilde de l'utilisateur (cf. §IV.1).
        // Versionner ces permissions évite de dépendre d'une config admin-panel
        // non reproductible (garde-fou §IV.3) — sans elles : 403 sur tout env neuf.
        'api::guild.guild.find',
        'api::guild.guild.findOne',
        'api::character.character.find',
        'api::character.character.findOne',
        'api::item.item.find',
        'api::item.item.findOne',
        'api::run.run.find',
        'api::run.run.findOne',
        'api::visit.visit.find',
        'api::visit.visit.findOne',
        'api::quest.quest.find',
        'api::quest.quest.findOne',
        // NPC : contenu de jeu partagé (lecture, comme museum/poi)
        'api::npc.npc.find',
        'api::npc.npc.findOne',
        // BFF httpOnly (#17) : /users/me-with-role peuple le role (le /users/me natif le strippe).
        // Requis par useAuth/useAdmin côté front. L'Admin l'hérite via la copie des perms authenticated.
        'plugin::users-permissions.user.meWithRole',
      ], 'Authenticated');
    }

    // Create and configure the Admin role
    let adminRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'admin' },
    });

    if (!adminRole) {
      adminRole = await strapi.db.query('plugin::users-permissions.role').create({
        data: {
          name: 'Admin',
          description: 'Administrator role with access to the admin dashboard',
          type: 'admin',
        },
      });
      strapi.log.info('Created Admin role for users-permissions');
    }

    if (adminRole && authenticatedRole) {
      // Copy ALL permissions from authenticated role to admin role
      // This includes both bootstrap-defined and admin-panel-configured permissions
      const authPermissions = await strapi.db.query('plugin::users-permissions.permission').findMany({
        where: { role: authenticatedRole.id },
        select: ['action'],
      });

      const authActions = authPermissions.map((p) => p.action);

      // Admin dashboard specific endpoints
      const adminOnlyActions = [
        // Mode debug (désactive le geofence) — strictement réservé aux admins (anti-triche)
        'api::guild.guild.toggleDebugMode',
        'api::admin-dashboard.admin-dashboard.check',
        'api::admin-dashboard.admin-dashboard.getOverview',
        'api::admin-dashboard.admin-dashboard.getPlayers',
        'api::admin-dashboard.admin-dashboard.getPlayerDetail',
        'api::admin-dashboard.admin-dashboard.toggleBlockPlayer',
        'api::admin-dashboard.admin-dashboard.changePlayerRole',
        'api::admin-dashboard.admin-dashboard.getMapData',
        'api::admin-dashboard.admin-dashboard.getEconomy',
        'api::admin-dashboard.admin-dashboard.getExpeditions',
        'api::admin-dashboard.admin-dashboard.getQuizAnalytics',
        'api::admin-dashboard.admin-dashboard.getSocialStats',
        'api::admin-dashboard.admin-dashboard.getConnectionAnalytics',
        'api::admin-dashboard.admin-dashboard.getGdprRequests',
        'api::admin-dashboard.admin-dashboard.markGdprProcessed',
        // Quiz generation (admin only)
        'api::quiz-session.quiz-session.generate',
      ];

      // Merge: all authenticated permissions + admin-only permissions
      const allAdminActions = [...new Set([...authActions, ...adminOnlyActions])];

      await grantPermissions(strapi, adminRole.id, allAdminActions, 'Admin');
    }

    // Index DB custom (idempotent) — colonnes scalaires filtrées par des requêtes globales.
    await ensureCustomIndexes(strapi);

    // Vérification des données source du quiz quotidien (log explicite si absentes). #73
    checkQuizDataPresence(strapi);
  },
};
