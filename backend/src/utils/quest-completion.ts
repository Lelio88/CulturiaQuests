import type { Core } from '@strapi/strapi';

/**
 * Logique de complétion des quêtes quotidiennes (#audit — le mécanisme n'existait pas).
 *
 * Modèle : une quête = visiter physiquement poi_a ET poi_b (donnés par un PNJ). La complétion est
 * SERVEUR-AUTORITATIVE :
 *  1. `markQuestPoisVisited` est appelé depuis openChest APRÈS la vérif de géofence (≤50m) → marque
 *     le POI de quête correspondant, indépendamment du cooldown de loot du coffre.
 *  2. Quand les deux POI sont marqués, la quête est « à réclamer » ; le joueur revient au PNJ et le
 *     controller `quest.complete` pose `date_end` + crédite la récompense (basée sur la distance).
 *
 * Le client ne déclare jamais une complétion (le marquage passe par la géofence serveur) ni le
 * montant de la récompense (calculé ici depuis les coordonnées des POI).
 */

// Récompense = fonction croissante de la distance poi_a↔poi_b (l'effort de déplacement demandé),
// plafonnée. Constantes ajustables — barème choisi pour être un peu au-dessus d'un quiz du jour.
const QUEST_REWARD = { goldBase: 60, goldPerKm: 25, xpBase: 100, xpPerKm: 35, distCapKm: 15 };

interface PoiCoords {
  lat?: number | null;
  lng?: number | null;
}

/** Distance haversine en km entre deux points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Récompense (or + xp) d'une quête, basée sur la distance entre ses deux POI (serveur-autoritative). */
export function computeQuestReward(poiA: PoiCoords | null, poiB: PoiCoords | null): { gold: number; xp: number; distanceKm: number } {
  let km = 0;
  if (poiA?.lat != null && poiA?.lng != null && poiB?.lat != null && poiB?.lng != null) {
    km = Math.min(haversineKm(poiA.lat, poiA.lng, poiB.lat, poiB.lng), QUEST_REWARD.distCapKm);
  }
  return {
    gold: Math.round(QUEST_REWARD.goldBase + QUEST_REWARD.goldPerKm * km),
    xp: Math.round(QUEST_REWARD.xpBase + QUEST_REWARD.xpPerKm * km),
    distanceKm: km,
  };
}

/**
 * Marque les POI de quête (poi_a/poi_b) correspondant à un POI visité comme complétés, pour toutes
 * les quêtes ACTIVES (non réclamées, date_end null) de la guilde. Idempotent (ne touche que les
 * drapeaux encore à false). Appelé après une géofence vérifiée (openChest).
 */
export async function markQuestPoisVisited(strapi: Core.Strapi, guildId: number, poiDocumentId: string): Promise<void> {
  const quests = await strapi.db.query('api::quest.quest').findMany({
    where: {
      guild: { id: guildId },
      date_end: { $null: true },
      $or: [{ poi_a: { documentId: poiDocumentId } }, { poi_b: { documentId: poiDocumentId } }],
    },
    select: ['id', 'documentId', 'is_poi_a_completed', 'is_poi_b_completed'],
    populate: { poi_a: { select: ['documentId'] }, poi_b: { select: ['documentId'] } },
  });

  for (const q of quests) {
    const data: Record<string, boolean> = {};
    if ((q as any).poi_a?.documentId === poiDocumentId && !q.is_poi_a_completed) data.is_poi_a_completed = true;
    if ((q as any).poi_b?.documentId === poiDocumentId && !q.is_poi_b_completed) data.is_poi_b_completed = true;
    if (Object.keys(data).length > 0) {
      await strapi.documents('api::quest.quest').update({ documentId: q.documentId, data });
    }
  }
}

/**
 * Incrémente la progression d'amitié avec le PNJ donneur à la réclamation d'une quête (débloque
 * progressivement ses dialogues/journal, et pilote la priorité de génération des quêtes). Plafonné
 * à `npc.quests_entry_available`. Get-or-create de la friendship (guild, npc). Best-effort.
 */
export async function incrementNpcQuestFriendship(
  strapi: Core.Strapi,
  guild: { id: number; documentId: string },
  npc: { id?: number; documentId?: string; quests_entry_available?: number } | null
): Promise<void> {
  if (!npc?.id || !npc.documentId) return;
  const cap = npc.quests_entry_available ?? 0;

  const existing = await strapi.db.query('api::friendship.friendship').findOne({
    where: { guild: { id: guild.id }, npc: { id: npc.id } },
    select: ['id', 'documentId', 'quests_entry_unlocked'],
  });

  if (existing) {
    const current = existing.quests_entry_unlocked ?? 0;
    if (current < cap) {
      await strapi.documents('api::friendship.friendship').update({
        documentId: existing.documentId,
        data: { quests_entry_unlocked: current + 1 },
      });
    }
    return;
  }

  await strapi.documents('api::friendship.friendship').create({
    data: {
      guild: guild.documentId,
      npc: npc.documentId,
      quests_entry_unlocked: Math.min(1, cap),
      expedition_entry_unlocked: 0,
    },
  });
}
