/**
 * Service user-settings : logique métier extraite du controller (#47) — upload d'avatar
 * (validation + redimensionnement Sharp + stockage via le plugin upload) et suppression de compte
 * (purge RGPD de toutes les données liées à l'utilisateur).
 *
 * NB : `user-settings` est une API SANS content-type → service au pattern simple
 * `export default ({ strapi }) => ({...})` (pas de factories.createCoreService, qui exigerait un
 * content-type). Résolu via `strapi.service('api::user-settings.user-settings')`.
 *
 * Contrat d'erreurs : `uploadAvatarFromBase64` lève `AvatarValidationError` pour les entrées
 * invalides (le controller la mappe en 400) ; toute autre erreur remonte (→ 500 côté controller).
 */
import sharp from 'sharp';
import crypto from 'crypto';
import { getUserGuild } from '../../../utils/guild-helpers';

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_IMAGE_FORMATS = ['png', 'jpeg', 'webp'];
const AVATAR_SIZE = 256;

/** Erreur de validation d'avatar → mappée en 400 (badRequest) par le controller. */
export class AvatarValidationError extends Error {}

export default ({ strapi }) => ({
  /**
   * Décode un avatar base64, le valide, le redimensionne en 256x256 WebP, le stocke dans le
   * dossier `avatars` et l'associe à l'utilisateur (en remplaçant l'ancien). Retourne les infos
   * du fichier créé. Lève `AvatarValidationError` sur entrée invalide.
   */
  async uploadAvatarFromBase64(userId: number, base64: string) {
    if (!base64) {
      throw new AvatarValidationError('base64 is required');
    }

    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    let tmpPath: string | null = null;

    try {
      // Valider le type MIME déclaré dans le data-URI (défense en profondeur)
      const declaredMime = (base64.match(/^data:([^;]+);base64,/) || [])[1];
      if (declaredMime && !ALLOWED_MIME_TYPES.includes(declaredMime)) {
        throw new AvatarValidationError(`Unsupported image type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
      }

      // Décoder le base64 (format: "data:image/png;base64,<données>")
      const base64Data = base64.replace(/^data:[^;]+;base64,/, '');
      const fileBuffer = Buffer.from(base64Data, 'base64');

      // Valider la taille du fichier décodé
      if (fileBuffer.length > MAX_FILE_SIZE) {
        throw new AvatarValidationError('File size exceeds 4MB');
      }

      // Vérifier le contenu réel via Sharp et restreindre aux formats autorisés
      const metadata = await sharp(fileBuffer).metadata();
      if (!metadata.format || !ALLOWED_IMAGE_FORMATS.includes(metadata.format)) {
        throw new AvatarValidationError('File is not a valid image (allowed: PNG, JPEG, WebP)');
      }

      // Redimensionner en 256x256 WebP
      const avatarBuffer = await sharp(fileBuffer)
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'center' })
        .webp({ quality: 85 })
        .toBuffer();

      // Créer ou récupérer le dossier 'avatars'
      let avatarFolder = await strapi.db.query('plugin::upload.folder').findOne({
        where: { name: 'avatars' },
      });

      if (!avatarFolder) {
        avatarFolder = await strapi.db.query('plugin::upload.folder').create({
          data: {
            name: 'avatars',
            pathId: crypto.randomInt(1, 1000000),
            path: '/avatars',
          },
        });
      }

      // Supprimer l'ancien avatar de l'utilisateur si existant
      const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: userId },
        populate: { avatar: true },
      });

      if (currentUser?.avatar) {
        try {
          await strapi.plugin('upload').service('upload').remove(currentUser.avatar);
        } catch (err) {
          strapi.log.warn('Could not delete old avatar:', err);
        }
      }

      // Écrire le buffer dans un fichier temporaire (requis par le service upload Strapi)
      const uniqueId = crypto.randomBytes(8).toString('hex');
      const fileName = `avatar_${userId}_${uniqueId}.webp`;
      tmpPath = path.join(os.tmpdir(), fileName);

      await fs.writeFile(tmpPath, avatarBuffer);

      const [newFile] = await strapi.plugin('upload').service('upload').upload({
        data: {
          fileInfo: {
            name: fileName,
            folder: avatarFolder.id,
          },
        },
        files: {
          name: fileName,
          type: 'image/webp',
          size: avatarBuffer.length,
          filepath: tmpPath,
        },
      });

      // Associer le nouveau fichier à l'utilisateur
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: userId },
        data: { avatar: newFile.id },
      });

      return {
        id: newFile.id,
        documentId: newFile.documentId,
        url: newFile.url,
        formats: newFile.formats,
      };
    } finally {
      // Nettoyer le fichier temporaire dans tous les cas
      if (tmpPath) {
        await fs.unlink(tmpPath).catch(() => {});
      }
    }
  },

  /**
   * Supprime toutes les données liées à un utilisateur (RGPD) : player-friendships, quiz-attempts,
   * progressions, guilde + ses relations, connection-logs, demandes RGPD ; anonymise (sans
   * supprimer) les admin-action-logs ; supprime l'avatar puis l'utilisateur.
   */
  async purgeUserData(userId: number) {
    // 1. Trouver la guild de l'utilisateur
    const guild = await getUserGuild(strapi, userId, {
      select: ['id', 'documentId'],
    });

    if (guild) {
      // 2. Supprimer les player-friendships (des deux côtés)
      const friendships = await strapi.db.query('api::player-friendship.player-friendship').findMany({
        where: { $or: [{ requester: guild.id }, { receiver: guild.id }] },
      });
      for (const f of friendships) {
        await strapi.documents('api::player-friendship.player-friendship').delete({ documentId: f.documentId });
      }

      // 3. Supprimer les quiz-attempts
      const attempts = await strapi.db.query('api::quiz-attempt.quiz-attempt').findMany({
        where: { guild: guild.id },
      });
      for (const a of attempts) {
        await strapi.documents('api::quiz-attempt.quiz-attempt').delete({ documentId: a.documentId });
      }

      // 4. Supprimer les progressions
      const progressions = await strapi.db.query('api::progression.progression').findMany({
        where: { guild: guild.id },
      });
      for (const p of progressions) {
        await strapi.documents('api::progression.progression').delete({ documentId: p.documentId });
      }

      // 5. Supprimer guild + items + runs + visits + quests + characters + legacy friendships
      await strapi.service('api::guild.guild').deleteGuildWithRelations(guild.documentId);
    }

    // 6. Supprimer les connection-logs
    const logs = await strapi.db.query('api::connection-log.connection-log').findMany({
      where: { user: { id: userId } },
    });
    for (const l of logs) {
      await strapi.documents('api::connection-log.connection-log').delete({ documentId: l.documentId });
    }

    // 7. Supprimer les demandes RGPD
    const gdprRequests = await strapi.db.query('api::gdpr-request.gdpr-request').findMany({
      where: { user: { id: userId } },
    });
    for (const r of gdprRequests) {
      await strapi.documents('api::gdpr-request.gdpr-request').delete({ documentId: r.documentId });
    }

    // 8. Anonymiser (NE PAS supprimer) les admin-action-logs liés à l'utilisateur (RGPD) :
    // on conserve la trace d'audit (action / date / IP) mais on détache les références vers
    // l'utilisateur supprimé. Empêche un admin d'effacer sa propre trace via la suppression
    // de son compte, tout en respectant le droit à l'oubli (plus de PII liée).
    const actionLogs = await strapi.db.query('api::admin-action-log.admin-action-log').findMany({
      where: { $or: [{ target_user: userId }, { admin: userId }] },
      populate: { admin: { select: ['id'] }, target_user: { select: ['id'] } },
    });
    for (const al of actionLogs) {
      const anonymized: Record<string, any> = {};
      if (al.admin?.id === userId) anonymized.admin = null;
      if (al.target_user?.id === userId) anonymized.target_user = null;
      if (Object.keys(anonymized).length > 0) {
        await strapi.documents('api::admin-action-log.admin-action-log').update({
          documentId: al.documentId,
          data: anonymized,
        });
      }
    }

    // 9. Supprimer l'avatar
    const fullUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
      populate: { avatar: true },
    });
    if (fullUser?.avatar) {
      await strapi.plugin('upload').service('upload').remove(fullUser.avatar).catch(() => {});
    }

    // 10. Supprimer le user
    await strapi.plugins['users-permissions'].services.user.remove({ id: userId });
  },
});
