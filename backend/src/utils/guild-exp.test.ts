import { describe, it, expect } from 'vitest';
import { addExp } from './guild-exp';

describe('addExp', () => {
  it('additionne des petits entiers (string ou number en entrée)', () => {
    expect(addExp(100, 50)).toBe('150');
    expect(addExp('100', 50)).toBe('150');
    expect(addExp(0, 0)).toBe('0');
  });

  it('préserve la précision au-delà de 2^53 (là où Number arrondirait)', () => {
    const big = '9007199254740993'; // 2^53 + 1
    expect(addExp(big, 10)).toBe('9007199254741003');
    // Preuve que l'arithmétique Number serait fausse à cette échelle :
    expect(Number(big) + 10).not.toBe(9007199254741003);
  });

  it('traite null / undefined / valeur corrompue comme 0', () => {
    expect(addExp(null, 5)).toBe('5');
    expect(addExp(undefined, 5)).toBe('5');
    expect(addExp('not-a-number', 5)).toBe('5');
    expect(addExp('12.5', 5)).toBe('5');
  });

  it('accepte un delta bigint et tronque un delta flottant', () => {
    expect(addExp(0, 10n)).toBe('10');
    expect(addExp(0, 9.9)).toBe('9');
    expect(addExp('1000000000000000000000', 1n)).toBe('1000000000000000000001');
  });
});
