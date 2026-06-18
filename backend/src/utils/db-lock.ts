import type { Core } from '@strapi/strapi';

/**
 * Exécute `fn` en section critique sérialisée par un verrou consultatif PostgreSQL
 * (`pg_advisory_xact_lock`). Sert à fermer les races « check-then-create » concurrentes pour une
 * même clé métier (ex: (guild, poi) à la première visite #66, (guild, jour) pour les quêtes
 * quotidiennes #67) SANS contrainte d'unicité composite — impossible avec Strapi v5 où les FK
 * (guild, poi…) vivent dans des tables de liaison `_lnk` séparées, pas dans une table unique.
 *
 * Le verrou est nommé par hash de `key` et tenu le temps de la transaction ; il est libéré
 * automatiquement à la fin (commit OU rollback), donc même si `fn` lève.
 *
 * Note importante : les requêtes Strapi dans `fn` s'exécutent sur le pool global (pas sur la
 * transaction qui porte le verrou) et committent immédiatement. C'est voulu : un appel concurrent
 * bloque sur l'acquisition du verrou jusqu'à la fin de CETTE transaction, instant où la ligne créée
 * par `fn` est déjà committée donc visible. La sérialisation est ainsi garantie quelle que soit la
 * connexion physique utilisée par les requêtes internes.
 *
 * Repli défensif : si le client n'est pas PostgreSQL (ex: SQLite en test), on exécute sans verrou
 * (non supporté) — la sérialisation n'est alors pas garantie, mais le comportement reste correct.
 *
 * @example
 * const visit = await withAdvisoryLock(strapi, `visit:${guildId}:${poiId}`, async () =>
 *   (await findVisit()) ?? (await createVisit())
 * );
 */
export async function withAdvisoryLock<T>(
  strapi: Core.Strapi,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const knex = strapi.db.connection as any;
  const dialect = String(
    (strapi.db as any)?.dialect?.client || knex?.client?.config?.client || ''
  ).toLowerCase();
  const isPostgres = dialect.includes('postg') || dialect === 'pg';

  if (!isPostgres) {
    return fn();
  }

  return knex.transaction(async (trx: any) => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [key]);
    return fn();
  });
}
