import { describe, it, expect } from 'vitest';
import { getParisDateKey, previousDateKey } from './quiz-date';

describe('getParisDateKey', () => {
  it('renvoie le jour suivant une fois minuit Paris passé (été, UTC+2)', () => {
    // 22:30 UTC en été = 00:30 le lendemain à Paris
    expect(getParisDateKey(new Date('2026-06-17T22:30:00Z'))).toBe('2026-06-18');
  });

  it('reste le même jour juste avant minuit Paris (été)', () => {
    // 21:30 UTC en été = 23:30 à Paris
    expect(getParisDateKey(new Date('2026-06-17T21:30:00Z'))).toBe('2026-06-17');
  });

  it("gère le décalage d'hiver (UTC+1)", () => {
    // 23:30 UTC en hiver = 00:30 le lendemain à Paris
    expect(getParisDateKey(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('renvoie le jour courant en pleine journée', () => {
    expect(getParisDateKey(new Date('2026-06-17T12:00:00Z'))).toBe('2026-06-17');
  });

  it('produit toujours un format YYYY-MM-DD', () => {
    expect(getParisDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('previousDateKey', () => {
  it("recule d'un jour en milieu de mois", () => {
    expect(previousDateKey('2026-06-17')).toBe('2026-06-16');
  });

  it('gère le passage de mois (année non bissextile)', () => {
    expect(previousDateKey('2026-03-01')).toBe('2026-02-28');
  });

  it('gère le 29 février (année bissextile)', () => {
    expect(previousDateKey('2024-03-01')).toBe('2024-02-29');
  });

  it("gère le passage d'année", () => {
    expect(previousDateKey('2026-01-01')).toBe('2025-12-31');
  });

  it("reste correct au changement d'heure (printemps EU)", () => {
    expect(previousDateKey('2026-03-30')).toBe('2026-03-29');
  });

  it("reste correct au changement d'heure (automne EU)", () => {
    expect(previousDateKey('2026-11-01')).toBe('2026-10-31');
  });
});
