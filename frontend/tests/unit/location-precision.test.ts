import { describe, it, expect } from 'vitest'
import {
  ESCALATION_HOLD_MS,
  INITIAL_PRECISION_STATE,
  nearestDistanceM,
  nextPrecision,
  type PrecisionState,
} from '../../app/utils/location-precision'

const economy: PrecisionState = { mode: 'economy', holdPreciseUntil: 0 }
const precise: PrecisionState = { mode: 'precise', holdPreciseUntil: 0 }

describe('nextPrecision', () => {
  it('passe en précis à l\'approche d\'un lieu', () => {
    const next = nextPrecision(economy, { nearestTargetM: 200, accuracyM: 30, now: 0 })
    expect(next.mode).toBe('precise')
  })

  it('repasse en économie loin de tout lieu', () => {
    const next = nextPrecision(precise, { nearestTargetM: 600, accuracyM: 8, now: 0 })
    expect(next.mode).toBe('economy')
  })

  it('passe en économie quand aucun lieu n\'est chargé', () => {
    const next = nextPrecision(INITIAL_PRECISION_STATE, { nearestTargetM: null, accuracyM: 8, now: 0 })
    expect(next.mode).toBe('economy')
  })

  it('garde le mode courant dans la bande d\'hystérésis', () => {
    const input = { nearestTargetM: 320, accuracyM: 20, now: 0 }
    expect(nextPrecision(precise, input).mode).toBe('precise')
    expect(nextPrecision(economy, input).mode).toBe('economy')
  })

  it('escalade en précis quand le mode économie est trop imprécis, et maintient l\'escalade', () => {
    const escalated = nextPrecision(economy, { nearestTargetM: 2000, accuracyM: 600, now: 1000 })
    expect(escalated).toEqual({ mode: 'precise', holdPreciseUntil: 1000 + ESCALATION_HOLD_MS })

    const stillHeld = nextPrecision(escalated, { nearestTargetM: 2000, accuracyM: 8, now: 1000 + ESCALATION_HOLD_MS - 1 })
    expect(stillHeld.mode).toBe('precise')

    const released = nextPrecision(stillHeld, { nearestTargetM: 2000, accuracyM: 8, now: 1000 + ESCALATION_HOLD_MS })
    expect(released.mode).toBe('economy')
  })

  it('n\'escalade pas sur une imprécision vécue en mode précis', () => {
    const next = nextPrecision(precise, { nearestTargetM: 2000, accuracyM: 600, now: 0 })
    expect(next).toEqual({ mode: 'economy', holdPreciseUntil: 0 })
  })

  it('ne modifie pas l\'état reçu', () => {
    const state: PrecisionState = { mode: 'economy', holdPreciseUntil: 0 }
    nextPrecision(state, { nearestTargetM: 10, accuracyM: 5, now: 0 })
    expect(state).toEqual({ mode: 'economy', holdPreciseUntil: 0 })
  })
})

describe('nearestDistanceM', () => {
  it('retient le lieu le plus proche parmi plusieurs listes', () => {
    const pois = [{ lat: 49.1267, lng: -1.0833 }]   // ~1,1 km au nord
    const museums = [{ lat: 49.1168, lng: -1.0833 }] // ~11 m au nord
    const distance = nearestDistanceM(49.1167, -1.0833, pois, museums)
    expect(distance).toBeGreaterThan(10)
    expect(distance).toBeLessThan(12)
  })

  it('ignore les lieux sans coordonnées et rend null sans lieu localisé', () => {
    expect(nearestDistanceM(49.1, -1.08, [{ lat: null, lng: -1.08 }, {}], [])).toBeNull()
  })
})
