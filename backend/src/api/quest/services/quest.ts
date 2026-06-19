import { factories } from '@strapi/strapi';

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Service des quêtes quotidiennes : sélection des PNJ donneurs de quête, création des
 * quêtes du jour pour une guilde, et lecture des quêtes du jour d'une guilde.
 *
 * Choix non-évidents :
 * - `selectNpcs` ne retient que les PNJ disposant d'un dialogue `text_type === 'quest_description'`,
 *   puis les classe en deux priorités avant de mélanger chaque groupe indépendamment :
 *     • priorité 1 : PNJ dont le compteur d'amitié `quests_entry_unlocked` est strictement
 *       inférieur à `quests_entry_available` (entrées de quête encore à débloquer) — servis d'abord ;
 *     • priorité 2 : tous les autres PNJ éligibles.
 *   Les deux groupes sont mélangés (Fisher-Yates) puis concaténés, et on prend les `count` premiers,
 *   ce qui favorise la progression d'amitié tout en gardant de la variété.
 * - L'amitié est résolue via `friendshipMap` (clé = id du PNJ) construite depuis les `friendship`
 *   de la guilde, et le `populate` des dialogs est filtré sur `quest_description` pour ne pas
 *   charger tous les dialogues de chaque PNJ.
 * - `createDailyQuests` associe à chaque PNJ deux POI consécutifs du tableau `poiDocumentIds`
 *   (indices `i*2` et `i*2+1`) — l'appelant doit donc fournir 2 × `npcDocumentIds.length` POI.
 * - `getTodayQuestsForGuild` borne sur la journée courante en UTC (`date_start` entre 00:00 et 23:59:59).
 *
 * Invariants à préserver :
 * - Isolation utilisateur : la lecture et la création sont toujours scopées à une guilde précise
 *   (jamais de quête renvoyée hors de la guilde du joueur).
 * - `createDailyQuests` initialise toujours les quêtes non complétées (gold/xp à 0, drapeaux POI à false).
 *
 * @example
 *   const npcs = await strapi.service('api::quest.quest').selectNpcs(guildId, 3);
 *   await strapi.service('api::quest.quest').createDailyQuests(guildDocumentId, npcDocIds, poiDocIds);
 *   const today = await strapi.service('api::quest.quest').getTodayQuestsForGuild(guildId);
 */
export default factories.createCoreService('api::quest.quest', ({ strapi }) => ({

  async getTodayQuestsForGuild(guildId: number) {
    const today = new Date().toISOString().split('T')[0];
    return strapi.db.query('api::quest.quest').findMany({
      where: {
        guild: { id: guildId },
        date_start: {
          $gte: `${today}T00:00:00.000Z`,
          $lte: `${today}T23:59:59.999Z`,
        },
      },
      populate: {
        npc: { populate: { dialogs: true } },
        poi_a: true,
        poi_b: true,
      },
    });
  },

  async selectNpcs(guildId: number, count: number) {
    const allNpcs = await strapi.db.query('api::npc.npc').findMany({
      // On ne teste que l'EXISTENCE d'un dialogue quest_description → on filtre le populate
      // au lieu de charger TOUS les dialogues de chaque NPC. (select text_type conservé pour
      // que le .some() ci-dessous reste correct même si le filtre de populate est ignoré.)
      populate: { dialogs: { where: { text_type: 'quest_description' }, select: ['text_type'] } },
    });

    const friendships = await strapi.db.query('api::friendship.friendship').findMany({
      where: { guild: { id: guildId } },
      populate: { npc: true },
    });
    const friendshipMap = new Map(
      friendships.map((f: any) => [f.npc?.id || f.npc, f])
    );

    const priority1: any[] = [];
    const priority2: any[] = [];

    for (const npc of allNpcs) {
      const hasQuestDialog = (npc as any).dialogs?.some(
        (d: any) => d.text_type === 'quest_description'
      );
      if (!hasQuestDialog) continue;

      const friendship = friendshipMap.get(npc.id);
      const unlocked = (friendship as any)?.quests_entry_unlocked || 0;
      const available = (npc as any).quests_entry_available || 0;

      if (unlocked < available) {
        priority1.push(npc);
      } else {
        priority2.push(npc);
      }
    }

    const shuffled1 = shuffleArray(priority1);
    const shuffled2 = shuffleArray(priority2);
    return [...shuffled1, ...shuffled2].slice(0, count);
  },

  async createDailyQuests(
    guildDocumentId: string,
    npcDocumentIds: string[],
    poiDocumentIds: string[]
  ) {
    const quests = [];
    for (let i = 0; i < npcDocumentIds.length; i++) {
      const quest = await strapi.documents('api::quest.quest').create({
        data: {
          date_start: new Date().toISOString(),
          guild: guildDocumentId,
          npc: npcDocumentIds[i],
          poi_a: poiDocumentIds[i * 2],
          poi_b: poiDocumentIds[i * 2 + 1],
          is_poi_a_completed: false,
          is_poi_b_completed: false,
          gold_earned: 0,
          xp_earned: 0,
        },
      });
      quests.push(quest);
    }
    return quests;
  },
}));
