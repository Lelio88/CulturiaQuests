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

/**
 * Force l'expéditeur des e-mails users-permissions (reset password + confirmation de compte)
 * sur l'adresse validée côté Brevo (`SMTP_DEFAULT_FROM`), à la place du défaut `no-reply@strapi.io`
 * que Brevo REJETTE (« sender not valid »).
 *
 * Motivation : le template e-mail de users-permissions impose son propre `from`, qui écrase le
 * `defaultFrom` du provider (config/plugins.ts). Sur un déploiement neuf, le store est initialisé
 * par le plugin avec `no-reply@strapi.io` → tous les envois échouent silencieusement (le controller
 * renvoie quand même `{ ok: true }` par anti-énumération, d'où un debug pénible). Ce seed idempotent
 * corrige le `from` à chaque boot SANS toucher au reste du template (sujet/corps personnalisés dans
 * l'admin sont préservés). No-op si `SMTP_DEFAULT_FROM` est absent (dev local sans SMTP).
 */
async function ensureEmailSenders(strapi: Core.Strapi) {
  const fromEmail = process.env.SMTP_DEFAULT_FROM;
  if (!fromEmail) return; // pas de SMTP configuré → on ne force rien

  type EmailOptions = { from?: { name?: string; email?: string } };
  type EmailStore = Record<string, { options?: EmailOptions } | undefined>;

  const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const emails = (await pluginStore.get({ key: 'email' })) as EmailStore | null;
  if (!emails) return;

  const senderName = 'CulturiaQuests';
  let changed = false;

  for (const key of ['reset_password', 'email_confirmation']) {
    const options = emails[key]?.options;
    if (!options) continue;
    if (!options.from) options.from = {};
    const from = options.from;
    if (from.email !== fromEmail) {
      from.email = fromEmail;
      changed = true;
    }
    if (!from.name || from.name === 'Administration Panel') {
      from.name = senderName;
      changed = true;
    }
  }

  if (changed) {
    await pluginStore.set({ key: 'email', value: emails });
    strapi.log.info(`users-permissions: expéditeur des e-mails forcé sur ${fromEmail}`);
  }
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
        // Flux « mot de passe oublié » : demande d'e-mail de reset + soumission du nouveau
        // mot de passe. Consommés avant authentification (utilisateur déconnecté par nature).
        'plugin::users-permissions.auth.forgotPassword',
        'plugin::users-permissions.auth.resetPassword',
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
        'api::progression.progression.delete',
        // Friendship (legacy) — find/findOne filtrés par guild.user.id
        'api::friendship.friendship.find',
        'api::friendship.friendship.findOne',
        // Routes cœur (find/findOne) appelées par le front. Isolation vérifiée :
        // chaque controller filtre par la guilde de l'utilisateur (cf. §IV.1).
        // Versionner ces permissions évite de dépendre d'une config admin-panel
        // non reproductible (garde-fou §IV.3) — sans elles : 403 sur tout env neuf.
        'api::guild.guild.find',
        'api::guild.guild.findOne',
        // Badges serveur-autoritatifs (#54) : badge-summary = lecture cross-joueur (données
        // badge uniquement, jamais or/xp/persos), equip-badges = sélection équipée de SA
        // guilde, validée serveur contre les progressions réellement complétées (anti-triche).
        'api::guild.guild.badgeSummary',
        'api::guild.guild.equipBadges',
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
        // Zones géographiques (région/département/comcom) : contenu public de la carte, lu via le
        // BFF par le zone store (fog-of-war, contours, badges de zone). Sans ces grants → 403 sur
        // déploiement neuf → carte sans zones + tous les badges de zone vides. #audit HIGH
        'api::region.region.find',
        'api::region.region.findOne',
        'api::department.department.find',
        'api::department.department.findOne',
        'api::comcom.comcom.find',
        'api::comcom.comcom.findOne',
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

    // Expéditeur des e-mails users-permissions forcé sur SMTP_DEFAULT_FROM
    // (évite le piège `no-reply@strapi.io` rejeté par Brevo). Idempotent.
    await ensureEmailSenders(strapi);
  },
};
