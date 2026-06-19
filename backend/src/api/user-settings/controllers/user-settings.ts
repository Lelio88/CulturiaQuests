/**
 * user-settings controller
 * Handles user profile settings including avatar upload with resize
 */
import { AvatarValidationError } from '../services/user-settings';

// Rate-limit léger en mémoire : max 5 uploads d'avatar par utilisateur et par minute. #16
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const avatarUploadHits = new Map<number, number[]>();

function isAvatarUploadAllowed(userId: number): boolean {
  const now = Date.now();
  const recent = (avatarUploadHits.get(userId) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    avatarUploadHits.set(userId, recent);
    return false;
  }
  recent.push(now);
  avatarUploadHits.set(userId, recent);
  return true;
}

export default {
  /**
   * Receive a base64-encoded image, resize to 256x256 WebP,
   * store in avatars folder, and associate to user.
   */
  async uploadAvatar(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    // Rate-limit (#16) : protège l'endpoint d'upload (décodage Sharp coûteux).
    if (!isAvatarUploadAllowed(user.id)) {
      const msg = 'Trop d\'uploads d\'avatar. Réessayez dans une minute.';
      return ctx.tooManyRequests ? ctx.tooManyRequests(msg) : ctx.throw(429, msg);
    }

    const { base64 } = ctx.request.body;

    try {
      const avatar = await strapi
        .service('api::user-settings.user-settings')
        .uploadAvatarFromBase64(user.id, base64);

      return ctx.send({
        data: { avatar },
        message: 'Avatar uploaded successfully',
      });
    } catch (error) {
      if (error instanceof AvatarValidationError) {
        return ctx.badRequest(error.message);
      }
      strapi.log.error('Error uploading avatar:', error);
      return ctx.internalServerError('Failed to upload avatar');
    }
  },

  /**
   * Remove user avatar
   */
  async removeAvatar(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    try {
      const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
        populate: { avatar: true },
      });

      if (!currentUser?.avatar) {
        return ctx.badRequest('No avatar to remove');
      }

      try {
        await strapi.plugin('upload').service('upload').remove(currentUser.avatar);
      } catch (err) {
        strapi.log.warn('Could not delete avatar file:', err);
      }

      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { avatar: null },
      });

      return ctx.send({
        message: 'Avatar removed successfully',
      });
    } catch (error) {
      strapi.log.error('Error removing avatar:', error);
      return ctx.internalServerError('Failed to remove avatar');
    }
  },

  /**
   * Get current user settings (avatar, friend_requests_enabled)
   */
  async getSettings(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    try {
      const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { id: user.id },
        select: ['id', 'username', 'email', 'friend_requests_enabled'],
        populate: {
          avatar: {
            select: ['id', 'documentId', 'url', 'formats', 'width', 'height'],
          },
        },
      });

      return ctx.send({
        data: {
          username: currentUser.username,
          email: currentUser.email,
          friend_requests_enabled: currentUser.friend_requests_enabled,
          avatar: currentUser.avatar || null,
        },
      });
    } catch (error) {
      strapi.log.error('Error fetching user settings:', error);
      return ctx.internalServerError('Failed to fetch user settings');
    }
  },

  /**
   * Delete the current user's account and all associated data
   */
  async deleteAccount(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    try {
      await strapi.service('api::user-settings.user-settings').purgeUserData(user.id);

      return ctx.send({ message: 'Account deleted successfully' });
    } catch (error) {
      strapi.log.error('Error deleting account:', error);
      return ctx.internalServerError('Failed to delete account');
    }
  },

  /**
   * Update user settings
   */
  async updateSettings(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return ctx.unauthorized('You must be logged in');
    }

    const { friend_requests_enabled } = ctx.request.body;

    try {
      const updateData: Record<string, any> = {};

      if (typeof friend_requests_enabled === 'boolean') {
        updateData.friend_requests_enabled = friend_requests_enabled;
      }

      if (Object.keys(updateData).length === 0) {
        return ctx.badRequest('No valid settings to update');
      }

      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: updateData,
      });

      return ctx.send({
        data: updateData,
        message: 'Settings updated successfully',
      });
    } catch (error) {
      strapi.log.error('Error updating user settings:', error);
      return ctx.internalServerError('Failed to update user settings');
    }
  },
};
