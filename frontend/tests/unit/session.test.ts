import { describe, it, expect } from 'vitest'
import { lastForwardedHop, secondsLeft } from '../../server/utils/session'

function jwtWith(payload: unknown): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'HS256' })}.${part(payload)}.signature`
}

describe('secondsLeft', () => {
  const now = Date.parse('2026-10-01T10:00:00Z')

  it('rend le temps restant avant expiration', () => {
    expect(secondsLeft(jwtWith({ exp: now / 1000 + 600 }), now)).toBe(600)
  })

  it('rend un nombre négatif pour un jeton expiré', () => {
    expect(secondsLeft(jwtWith({ exp: now / 1000 - 5 }), now)).toBe(-5)
  })

  it('rend null pour un jeton illisible ou sans exp', () => {
    expect(secondsLeft('pas-un-jwt', now)).toBeNull()
    expect(secondsLeft('a.@@@.c', now)).toBeNull()
    expect(secondsLeft(jwtWith({ sub: 1 }), now)).toBeNull()
  })
})

describe('lastForwardedHop', () => {
  it('retient le dernier maillon, celui que le proxy a posé', () => {
    expect(lastForwardedHop('1.2.3.4, 203.0.113.9')).toBe('203.0.113.9')
  })

  it('ignore les espaces et les maillons vides', () => {
    expect(lastForwardedHop(' 203.0.113.9 ,')).toBe('203.0.113.9')
  })

  it('rend null sans en-tête', () => {
    expect(lastForwardedHop(undefined)).toBeNull()
    expect(lastForwardedHop('')).toBeNull()
  })
})
