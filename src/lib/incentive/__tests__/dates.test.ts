import { describe, it, expect } from 'vitest'
import { chicagoMidnightUtc, chicagoNextMidnightUtc, chicagoMonthStart } from '../dates'

describe('chicagoMidnightUtc', () => {
  it('handles CDT (summer, UTC-5)', () => {
    expect(chicagoMidnightUtc('2026-07-01').toISOString()).toBe('2026-07-01T05:00:00.000Z')
  })

  it('handles CST (winter, UTC-6)', () => {
    expect(chicagoMidnightUtc('2026-01-15').toISOString()).toBe('2026-01-15T06:00:00.000Z')
  })
})

describe('chicagoNextMidnightUtc', () => {
  it('returns the exclusive end bound (next Chicago midnight)', () => {
    expect(chicagoNextMidnightUtc('2026-09-30').toISOString()).toBe('2026-10-01T05:00:00.000Z')
  })

  it('crosses month and DST boundaries correctly', () => {
    // Nov 1 2026 is the DST fall-back date; Nov 2 midnight is CST (UTC-6).
    expect(chicagoNextMidnightUtc('2026-11-01').toISOString()).toBe('2026-11-02T06:00:00.000Z')
  })
})

describe('chicagoMonthStart', () => {
  it('buckets a UTC instant into the Chicago-local month', () => {
    // 2026-08-01T03:30Z is Jul 31, 10:30 PM in Chicago — still July.
    expect(chicagoMonthStart(new Date('2026-08-01T03:30:00Z'))).toBe('2026-07-01')
    expect(chicagoMonthStart(new Date('2026-08-01T06:30:00Z'))).toBe('2026-08-01')
  })
})
