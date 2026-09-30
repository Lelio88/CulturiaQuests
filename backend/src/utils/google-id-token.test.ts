import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import { createGoogleVerifier, type GoogleJwk, type GoogleKeySet } from './google-id-token';

const AUDIENCE = 'web-client.apps.googleusercontent.com';
const NOW = Date.parse('2026-10-01T10:00:00Z');
const NOW_S = Math.floor(NOW / 1000);

let privateKey: crypto.KeyObject;
let otherPrivateKey: crypto.KeyObject;
let jwk: GoogleJwk;

beforeAll(() => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const exported = pair.publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  jwk = { kid: 'k1', kty: 'RSA', n: exported.n, e: exported.e };
  otherPrivateKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
});

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function sign(payload: Record<string, unknown>, opts: { key?: crypto.KeyObject; header?: Record<string, unknown> } = {}) {
  const head = b64(opts.header ?? { alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}

const claims = {
  iss: 'https://accounts.google.com',
  aud: AUDIENCE,
  sub: '1234567890',
  email: 'Joueur@Gmail.com',
  email_verified: true,
  iat: NOW_S - 10,
  exp: NOW_S + 3600,
};

function verifier(fetchCount = { n: 0 }) {
  return createGoogleVerifier({
    audience: AUDIENCE,
    now: () => NOW,
    fetchKeys: async (): Promise<GoogleKeySet> => {
      fetchCount.n++;
      return { keys: [jwk], maxAgeSeconds: 3600 };
    },
  });
}

describe('createGoogleVerifier', () => {
  it('rend sub et adresse (en minuscules) d’un jeton valide', async () => {
    await expect(verifier()(sign(claims))).resolves.toEqual({ sub: '1234567890', email: 'joueur@gmail.com' });
  });

  it('refuse une signature d’une autre clé', async () => {
    await expect(verifier()(sign(claims, { key: otherPrivateKey }))).rejects.toThrow('signature');
  });

  it('refuse un jeton destiné à un autre client', async () => {
    await expect(verifier()(sign({ ...claims, aud: 'autre' }))).rejects.toThrow('audience');
  });

  it('refuse un autre émetteur', async () => {
    await expect(verifier()(sign({ ...claims, iss: 'https://evil.example' }))).rejects.toThrow('issuer');
  });

  it('refuse un jeton expiré (au-delà de la tolérance d’horloge)', async () => {
    await expect(verifier()(sign({ ...claims, exp: NOW_S - 120 }))).rejects.toThrow('expired');
  });

  it('refuse une adresse non vérifiée par Google', async () => {
    await expect(verifier()(sign({ ...claims, email_verified: false }))).rejects.toThrow('email_not_verified');
  });

  it('refuse alg none et HS256, quel que soit le reste', async () => {
    await expect(verifier()(sign(claims, { header: { alg: 'none', kid: 'k1' } }))).rejects.toThrow('algorithm');
    await expect(verifier()(sign(claims, { header: { alg: 'HS256', kid: 'k1' } }))).rejects.toThrow('algorithm');
  });

  it('refuse un jeton mal formé', async () => {
    await expect(verifier()('abc')).rejects.toThrow('malformed');
    await expect(verifier()(42)).rejects.toThrow('malformed');
  });

  it('met les clés en cache et ne retélécharge pas pour un kid inconnu dans la minute', async () => {
    const count = { n: 0 };
    const verify = verifier(count);
    await verify(sign(claims));
    await verify(sign(claims));
    await expect(verify(sign(claims, { header: { alg: 'RS256', kid: 'inconnu' } }))).rejects.toThrow('unknown_key');
    expect(count.n).toBe(1);
  });

  it('refuse tout si aucune audience n’est configurée', async () => {
    const verify = createGoogleVerifier({ audience: '', fetchKeys: async () => ({ keys: [jwk], maxAgeSeconds: 60 }) });
    await expect(verify(sign(claims))).rejects.toThrow('no_audience_configured');
  });
});
