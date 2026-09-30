/**
 * Vérification d'un jeton d'identité Google (ID token) reçu de l'application Android.
 *
 * L'app obtient ce jeton par Credential Manager, en le demandant pour le **client Web** du projet
 * Google Cloud (`audience`) ; le serveur le vérifie ici avant de faire confiance à l'adresse qu'il
 * porte. Aucun secret : la signature RS256 se contrôle avec les clés publiques de Google.
 *
 * Choix non-évidents :
 * - `node:crypto` plutôt qu'une bibliothèque JWT : cinq contrôles suffisent (algorithme, signature,
 *   émetteur, audience, dates) et ils sont éprouvés par `google-id-token.test.ts`. Une dépendance de
 *   plus sur le chemin de l'authentification serait plus de surface, pas plus de sûreté.
 * - L'algorithme est **imposé** (RS256) : on ne lit jamais `alg` pour choisir comment vérifier,
 *   ce qui ferme la famille d'attaques `alg: none` / confusion HS256.
 * - Clés mises en cache selon le `max-age` de Google ; un `kid` inconnu déclenche **un** nouveau
 *   téléchargement au plus par minute (rotation des clés), jamais une rafale.
 * - `email_verified` doit être vrai : c'est lui qui autorise à rattacher le compte Google à un
 *   compte existant de même adresse.
 *
 * Invariant : `verify` ne rend une identité que si toutes les vérifications passent ; sinon elle
 * lève `GoogleTokenError` avec une raison courte, destinée aux journaux (jamais au client).
 *
 * @example
 * const verify = createGoogleVerifier({ audience: webClientId })
 * const { sub, email } = await verify(idToken)
 */
import crypto from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;
const MIN_REFETCH_MS = 60_000;
const DEFAULT_MAX_AGE_SECONDS = 3600;

export interface GoogleJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

export interface GoogleKeySet {
  keys: GoogleJwk[];
  maxAgeSeconds: number;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
}

export class GoogleTokenError extends Error {}

export type KeyFetcher = () => Promise<GoogleKeySet>;

export async function fetchGoogleKeys(): Promise<GoogleKeySet> {
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new GoogleTokenError(`certs_http_${res.status}`);
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
  const body = (await res.json()) as { keys?: GoogleJwk[] };
  return {
    keys: Array.isArray(body.keys) ? body.keys : [],
    maxAgeSeconds: maxAge ? Number(maxAge[1]) : DEFAULT_MAX_AGE_SECONDS,
  };
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new GoogleTokenError('malformed');
  }
}

function checkClaims(payload: Record<string, unknown>, audience: string, nowSeconds: number): GoogleIdentity {
  if (typeof payload.iss !== 'string' || !ISSUERS.has(payload.iss)) throw new GoogleTokenError('issuer');
  const aud = payload.aud;
  const audOk = aud === audience || (Array.isArray(aud) && aud.includes(audience));
  if (!audOk) throw new GoogleTokenError('audience');
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new GoogleTokenError('expired');
  }
  if (typeof payload.iat === 'number' && payload.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new GoogleTokenError('issued_in_future');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new GoogleTokenError('subject');
  if (typeof payload.email !== 'string' || payload.email.length === 0) throw new GoogleTokenError('email');
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new GoogleTokenError('email_not_verified');
  }
  return { sub: payload.sub, email: payload.email.toLowerCase() };
}

export function createGoogleVerifier(options: {
  audience: string;
  fetchKeys?: KeyFetcher;
  now?: () => number;
}) {
  const { audience } = options;
  const fetchKeys = options.fetchKeys ?? fetchGoogleKeys;
  const now = options.now ?? Date.now;
  let keys = new Map<string, crypto.KeyObject>();
  let expiresAt = 0;
  let lastFetch = -Infinity;

  async function refresh(): Promise<void> {
    lastFetch = now();
    const set = await fetchKeys();
    keys = new Map(
      set.keys
        .filter((k) => k.kty === 'RSA' && typeof k.kid === 'string')
        .map((k) => [k.kid, crypto.createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' })]),
    );
    expiresAt = now() + set.maxAgeSeconds * 1000;
  }

  async function keyFor(kid: string): Promise<crypto.KeyObject> {
    const stale = now() >= expiresAt;
    const unknown = !keys.has(kid) && now() - lastFetch >= MIN_REFETCH_MS;
    if (stale || unknown) await refresh();
    const key = keys.get(kid);
    if (!key) throw new GoogleTokenError('unknown_key');
    return key;
  }

  return async function verify(idToken: unknown): Promise<GoogleIdentity> {
    if (!audience) throw new GoogleTokenError('no_audience_configured');
    if (typeof idToken !== 'string' || idToken.length > 4096) throw new GoogleTokenError('malformed');
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new GoogleTokenError('malformed');
    const header = decodeSegment(parts[0]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new GoogleTokenError('algorithm');
    const key = await keyFor(header.kid);
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    if (!crypto.verify('RSA-SHA256', signed, key, signature)) throw new GoogleTokenError('signature');
    return checkClaims(decodeSegment(parts[1]), audience, Math.floor(now() / 1000));
  };
}
