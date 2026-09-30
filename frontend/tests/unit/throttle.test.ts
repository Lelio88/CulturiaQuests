import { describe, it, expect } from 'vitest'
import { createThrottle } from '../../server/utils/throttle'

function clock(start = 0) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('createThrottle', () => {
  it('laisse passer les essais libres, puis fait attendre le suivant', () => {
    const c = clock()
    const limiter = createThrottle({ freeAttempts: 3, baseDelayMs: 30_000, now: c.now })
    limiter.fail('k')
    limiter.fail('k')
    expect(limiter.retryAfter('k')).toBe(0)
    limiter.fail('k')
    expect(limiter.retryAfter('k')).toBe(30)
  })

  it('double le délai à chaque échec de plus, jusqu’au plafond', () => {
    const c = clock()
    const limiter = createThrottle({ freeAttempts: 1, baseDelayMs: 1000, maxDelayMs: 5000, now: c.now })
    limiter.fail('k')
    expect(limiter.retryAfter('k')).toBe(1)
    limiter.fail('k')
    expect(limiter.retryAfter('k')).toBe(2)
    limiter.fail('k')
    expect(limiter.retryAfter('k')).toBe(4)
    limiter.fail('k')
    expect(limiter.retryAfter('k')).toBe(5)
  })

  it('ne bloque jamais définitivement : le délai s’écoule', () => {
    const c = clock()
    const limiter = createThrottle({ freeAttempts: 1, baseDelayMs: 1000, now: c.now })
    limiter.fail('k')
    expect(limiter.retryAfter('k')).toBe(1)
    c.advance(1000)
    expect(limiter.retryAfter('k')).toBe(0)
  })

  it('oublie un compte une heure après la dernière tentative', () => {
    const c = clock()
    const limiter = createThrottle({ freeAttempts: 3, baseDelayMs: 1000, now: c.now })
    limiter.fail('k')
    limiter.fail('k')
    c.advance(60 * 60_000 + 1)
    limiter.fail('k') // le compteur est reparti de zéro : cet essai est le premier
    expect(limiter.retryAfter('k')).toBe(0)
  })

  it('isole les clés entre elles, et reset efface le compteur', () => {
    const c = clock()
    const limiter = createThrottle({ freeAttempts: 1, now: c.now })
    limiter.fail('a')
    expect(limiter.retryAfter('b')).toBe(0)
    limiter.reset('a')
    expect(limiter.retryAfter('a')).toBe(0)
  })
})
