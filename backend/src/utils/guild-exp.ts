/**
 * Additionne un delta à une valeur d'exp en préservant la précision au-delà de 2^53.
 *
 * L'exp d'une guilde est un `biginteger` Strapi (stocké en string côté Postgres). La convertir en
 * `Number` pour l'additionner perdrait la précision dès que le total dépasse Number.MAX_SAFE_INTEGER
 * (2^53 − 1) — d'où l'usage de `BigInt`. Retourne la nouvelle valeur en string (format attendu par le
 * Document Service pour un biginteger).
 *
 * Helper partagé (#68) : centralise l'arithmétique d'exp. Les chemins run/visit créditent l'exp en
 * SQL atomique (`UPDATE guilds SET exp = exp + ?`, l'addition se fait côté Postgres en bigint) ; ce
 * helper couvre les chemins read-modify-write via le Document Service (ex: récompenses quiz).
 *
 * Repli défensif : une valeur courante non parsable (donnée corrompue) est traitée comme 0. Un delta
 * flottant est tronqué (l'exp est entière).
 *
 * @example addExp('9007199254740993', 10) // => '9007199254741003' (exact, au-delà de 2^53)
 */
export function addExp(
  current: string | number | bigint | null | undefined,
  delta: number | bigint
): string {
  // BigInt(...) plutôt que les littéraux `0n`/`1n` : la cible TS du backend est < ES2020, qui
  // interdit les littéraux BigInt (mais autorise le constructeur).
  let base: bigint;
  try {
    base = BigInt(current ?? 0);
  } catch {
    base = BigInt(0);
  }
  const d = typeof delta === 'bigint' ? delta : BigInt(Math.trunc(delta || 0));
  return (base + d).toString();
}
