import type { Core } from '@strapi/strapi';
import { withAdvisoryLock } from './db-lock';

const COMPLETION_THRESHOLD = 0.5;

/**
 * Complétion de comcom SERVEUR-AUTORITATIVE (#54, anti-triche niveau 2).
 *
 * Recalcule si la guilde a VÉRIFIABLEMENT visité ≥ 50% des lieux (POIs + musées) d'une comcom et
 * marque la progression `is_completed` côté serveur si le seuil est atteint. « Vérifiable » = des
 * signaux que le serveur contrôle lui-même :
 *  - une `visit` (ouverture de coffre POI — geofence ≤ 50m vérifié dans `visit.openChest`) ;
 *  - une `run` (expédition de musée — geofence vérifié dans `run.startExpedition`).
 * La couverture « fog » (cellules GPS en localStorage) n'est volontairement PAS prise en compte :
 * elle est invérifiable côté serveur, donc falsifiable (c'est la faille que le niveau 2 ferme).
 *
 * Invariants :
 *  - Au plus UNE progression `is_completed: true` par (guilde, comcom) : l'upsert est sérialisé par
 *    verrou consultatif. Un doublon corromprait le compteur d'enfants du cascade département/région
 *    (`progression/lifecycles.ts`).
 *  - L'upsert passe par `strapi.documents(...)` → les hooks `afterCreate`/`afterUpdate` se déclenchent
 *    → la propagation comcom → département → région reste intacte.
 *
 * Best-effort : l'APPELANT doit envelopper l'appel dans un try/catch. Un échec de recompute ne doit
 * jamais casser le flux de récompense (le coffre / l'expédition est déjà crédité) ; la complétion
 * sera retentée à la prochaine visite.
 *
 * @param guildId            id numérique de la guilde (pour les filtres `strapi.db.query`).
 * @param guildDocumentId    documentId de la guilde (pour les écritures Document Service).
 * @param comcomDocumentId   documentId de la comcom à réévaluer.
 * @returns `true` si la comcom est (ou vient d'être) complétée, `false` sinon.
 *
 * @example
 * try {
 *   await recomputeComcomCompletion(strapi, guild.id, guild.documentId, poi.comcom.documentId);
 * } catch (e) {
 *   strapi.log.warn(`[comcom-completion] recompute échoué: ${e}`);
 * }
 */
export async function recomputeComcomCompletion(
  strapi: Core.Strapi,
  guildId: number,
  guildDocumentId: string,
  comcomDocumentId: string
): Promise<boolean> {
  // 1. Total des lieux de la comcom (dénominateur).
  const pois = await strapi.db.query('api::poi.poi').findMany({
    where: { comcom: { documentId: comcomDocumentId } },
    select: ['id'],
  });
  const museums = await strapi.db.query('api::museum.museum').findMany({
    where: { comcom: { documentId: comcomDocumentId } },
    select: ['id'],
  });
  const totalPlaces = pois.length + museums.length;
  if (totalPlaces === 0) return false;

  const poiIds = pois.map((p: any) => p.id);
  const museumIds = museums.map((m: any) => m.id);

  // 2. Lieux réellement visités par la guilde (signaux serveur-vérifiés).
  let visitedPois = 0;
  if (poiIds.length > 0) {
    visitedPois = await strapi.db.query('api::visit.visit').count({
      where: { guild: { id: guildId }, poi: { id: { $in: poiIds } } },
    });
  }

  let visitedMuseums = 0;
  if (museumIds.length > 0) {
    // Une `run` existe = expédition lancée sur place (geofence vérifié au start) = musée visité.
    const runs = await strapi.db.query('api::run.run').findMany({
      where: { guild: { id: guildId }, museum: { id: { $in: museumIds } } },
      select: ['id'],
      populate: { museum: { select: ['id'] } },
    });
    const distinctMuseums = new Set<number>();
    for (const r of runs as any[]) {
      if (r.museum?.id) distinctMuseums.add(r.museum.id);
    }
    visitedMuseums = distinctMuseums.size;
  }

  // 3. Seuil.
  if ((visitedPois + visitedMuseums) / totalPlaces < COMPLETION_THRESHOLD) {
    return false;
  }

  // 4. Upsert sérialisé (au plus une progression is_completed:true par (guilde, comcom)).
  return withAdvisoryLock(strapi, `comcom_completion:${guildId}:${comcomDocumentId}`, async () => {
    const existing = await strapi.db.query('api::progression.progression').findOne({
      where: { guild: { id: guildId }, comcom: { documentId: comcomDocumentId } },
      select: ['documentId', 'is_completed'],
    });
    if (existing) {
      if (!existing.is_completed) {
        // Document Service → déclenche le cascade département/région via les lifecycles.
        await strapi.documents('api::progression.progression').update({
          documentId: existing.documentId,
          data: { is_completed: true },
        });
      }
      return true;
    }
    await strapi.documents('api::progression.progression').create({
      data: { is_completed: true, guild: guildDocumentId, comcom: comcomDocumentId },
    });
    return true;
  });
}
