/**
 * guild service
 */

import { factories } from '@strapi/strapi';
import type { GuildSetupInput } from '../../../utils/account-rules';

export default factories.createCoreService('api::guild.guild', ({ strapi }) => ({
  /**
   * L'icône choisie est-elle bien une icône de personnage (dossier média `characters`) ?
   * Sans ce contrôle, n'importe quel fichier téléversé (avatar d'un autre joueur compris)
   * pourrait devenir l'icône d'un personnage.
   */
  async isCharacterIcon(iconId: number): Promise<boolean> {
    const folder = await strapi.db.query('plugin::upload.folder').findOne({
      where: { name: 'characters' },
      select: ['id'],
    });
    if (!folder) return false;
    const count = await strapi.db.query('plugin::upload.file').count({
      where: { id: iconId, folder: { id: folder.id }, mime: { $startsWith: 'image/' } },
    });
    return count > 0;
  },

  /**
   * Crée la guilde d'un joueur, son premier personnage et ses objets de départ. Appelé par
   * l'inscription (e-mail ou Google), qui l'enchaîne à la création du compte, et par
   * `POST /guilds/setup`. Les entrées sont déjà validées (`parseGuildSetup`) ; le refus d'une
   * seconde guilde reste ici, car c'est un invariant du modèle et non du formulaire.
   */
  async createForUser(userId: number, input: GuildSetupInput) {
    const existingGuild = await strapi.db.query('api::guild.guild').findOne({
      where: { user: { id: userId } },
      select: ['id'],
    });
    if (existingGuild) {
      throw new Error('User already has a guild');
    }

    const newGuild = await strapi.documents('api::guild.guild').create({
      data: {
        name: input.guildName,
        user: userId,
        publishedAt: new Date(),
        gold: 0,
        scrap: 0,
        exp: 0,
      },
    });

    const newCharacter = await strapi.documents('api::character.character').create({
      data: {
        firstname: input.firstname,
        lastname: input.lastname,
        guild: newGuild.documentId,
        icon: input.iconId,
        publishedAt: new Date(),
      },
    });

    await strapi.service('api::character.character').createStarterItems(
      newCharacter.documentId,
      newGuild.documentId
    );

    return newGuild;
  },

  /**
   * Delete a guild and all its associated data (characters, items, friendships, runs, visits, quests)
   */
  async deleteGuildWithRelations(guildDocumentId: string) {
    // Find the guild with all its related data
    const guild = await strapi.db.query('api::guild.guild').findOne({
      where: { documentId: guildDocumentId },
      populate: {
        characters: true,
        items: true,
        friendships: true,
        runs: true,
        visits: true,
        quests: true,
      },
    });

    if (!guild) {
      throw new Error('Guild not found');
    }

    // Delete all related items
    if (guild.items && guild.items.length > 0) {
      for (const item of guild.items) {
        await strapi.documents('api::item.item').delete({
          documentId: item.documentId,
        });
      }
    }

    // Delete all related friendships
    if (guild.friendships && guild.friendships.length > 0) {
      for (const friendship of guild.friendships) {
        await strapi.documents('api::friendship.friendship').delete({
          documentId: friendship.documentId,
        });
      }
    }

    // Delete all related runs
    if (guild.runs && guild.runs.length > 0) {
      for (const run of guild.runs) {
        await strapi.documents('api::run.run').delete({
          documentId: run.documentId,
        });
      }
    }

    // Delete all related visits
    if (guild.visits && guild.visits.length > 0) {
      for (const visit of guild.visits) {
        await strapi.documents('api::visit.visit').delete({
          documentId: visit.documentId,
        });
      }
    }

    // Delete all related quests
    if (guild.quests && guild.quests.length > 0) {
      for (const quest of guild.quests) {
        await strapi.documents('api::quest.quest').delete({
          documentId: quest.documentId,
        });
      }
    }

    // Delete all related characters
    if (guild.characters && guild.characters.length > 0) {
      for (const character of guild.characters) {
        await strapi.documents('api::character.character').delete({
          documentId: character.documentId,
        });
      }
    }

    // Finally, delete the guild itself
    await strapi.documents('api::guild.guild').delete({
      documentId: guildDocumentId,
    });

    return { success: true };
  },
}));
