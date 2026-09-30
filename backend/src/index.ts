import type { Core } from '@strapi/strapi';
import fs from 'fs';
import path from 'path';
import { ensureAuthSettings } from './extensions/users-permissions/lib/emails';
import { EMAIL_CONFIRMATION_SINCE } from './utils/account-rules';

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
 * Les comptes créés avant la confirmation d'adresse obligatoire (`EMAIL_CONFIRMATION_SINCE`) se
 * connectaient sans elle : ils sont marqués confirmés une fois pour toutes, sinon l'activation
 * de `email_confirmation` les aurait verrouillés dehors.
 */
async function confirmLegacyAccounts(strapi: Core.Strapi) {
  const updated = await strapi.db.query('plugin::users-permissions.user').updateMany({
    // `$ne: true` écarterait les NULL (SQL) : on les vise explicitement.
    where: {
      $or: [{ confirmed: false }, { confirmed: { $null: true } }],
      createdAt: { $lt: EMAIL_CONFIRMATION_SINCE },
    },
    data: { confirmed: true },
  });
  if (updated?.count) {
    strapi.log.info(`users-permissions : ${updated.count} compte(s) antérieur(s) à la confirmation marqué(s) confirmé(s)`);
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
    // IP du client : dernier maillon de X-Forwarded-For seulement. Un seul proxy (Caddy, ou le BFF
    // Nuxt qui pose l'en-tête lui-même) précède Strapi ; les maillons de gauche viennent du client
    // et peuvent être forgés. Sans cette borne, Koa prend le premier — usurpable — et la limite
    // de tentatives se contourne en changeant d'IP fictive à chaque essai. Si un CDN s'intercale
    // un jour devant Caddy, passer à 2.
    strapi.server.app.maxIpsCount = 1;

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
        // Confirmation d'adresse (lien de l'e-mail, relayé par le BFF) et renvoi du lien.
        'plugin::users-permissions.auth.emailConfirmation',
        'plugin::users-permissions.auth.sendEmailConfirmation',
        // Sessions `refresh` : le BFF renouvelle le jeton d'accès sans en-tête Authorization.
        'plugin::users-permissions.auth.refresh',
        'api::character.character.getCharacterIcons',
        // Zones géographiques (contours de région/département/comcom) : données PUBLIQUES non
        // sensibles, chargées par le zone store dès l'ouverture de la carte. Accordées au rôle Public
        // (le proxy BFF les relaie sans Bearer via PUBLIC_GET_PATHS → Strapi évalue le rôle Public).
        // Le rôle Authenticated les a aussi (plus bas), mais le chemin nominal est désormais Public.
        // Sans ce grant → 401/403 sur regions/comcoms/departments (carte sans contours + badges de
        // zone vides). Régression du routage BFF (commit 7899ab8).
        'api::region.region.find',
        'api::region.region.findOne',
        'api::department.department.find',
        'api::department.department.findOne',
        'api::comcom.comcom.find',
        'api::comcom.comcom.findOne',
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
        // update/delete : override controller impose l'ownership (author) + whitelist des champs
        // (#audit HIGH#1). Sans ces grants : édition/suppression de post en 403 sur base neuve.
        'api::post.post.update',
        'api::post.post.delete',
        // GDPR
        'api::gdpr-request.gdpr-request.requestData',
        // Quest generation + réclamation (complétion des 2 POI → récompense au PNJ, #audit)
        'api::quest.quest.generateDaily',
        'api::quest.quest.complete',
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
        // update/delete : override controller impose l'ownership (guilde) + whitelist firstname/
        // lastname/icon (#audit HIGH#1). Sans ces grants : édition/suppression perso en 403 base neuve.
        'api::character.character.update',
        'api::character.character.delete',
        'api::item.item.find',
        'api::item.item.findOne',
        // Économie serveur-autoritative (#audit HIGH#1) : recyclage/amélioration calculés serveur.
        // Remplacent les PUT /items,/guilds pilotés par le client (trichables). item.update /
        // guild.update NE sont volontairement PAS accordés (le client ne doit pas écrire l'économie).
        'api::item.item.recycle',
        'api::item.item.upgrade',
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
        // Réacceptation des CGU quand leur version change (écran /account/conditions).
        'plugin::users-permissions.user.acceptTerms',
        // Sessions `refresh` : déconnexion = révocation côté serveur.
        'plugin::users-permissions.auth.logout',
        'plugin::users-permissions.auth.refresh',
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

    // Réglages avancés et gabarits e-mail users-permissions alignés sur le dépôt (confirmation
    // obligatoire, pages de retour, expéditeur SMTP_DEFAULT_FROM validé par Brevo). Idempotent.
    await ensureAuthSettings();
    await confirmLegacyAccounts(strapi);
  },
};
