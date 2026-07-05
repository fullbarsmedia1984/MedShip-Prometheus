import { describe, it, expect } from 'vitest'
import { autoFreezeTargetMonth, chicagoMidnightUtc, chicagoNextMidnightUtc, chicagoMonthStart } from '../dates'

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

describe('autoFreezeTargetMonth', () => {
  it('returns null inside the grace period after month end', () => {
    // Aug 5: July ended 4-5 days ago — still inside the 7-day grace window.
    expect(autoFreezeTargetMonth(new Date('2026-08-05T15:00:00Z'), 7)).toBeNull()
  })

  it('returns the previous month once the grace period has elapsed', () => {
    // Aug 10: July ended 9+ days ago — July is due.
    expect(autoFreezeTargetMonth(new Date('2026-08-10T15:00:00Z'), 7)).toBe('2026-07-01')
  })

  it('flips exactly at grace-period end (Chicago month boundary + N days)', () => {
    // July ends 2026-08-01T05:00Z (Chicago midnight, CDT). +7 days = Aug 8 05:00Z.
    expect(autoFreezeTargetMonth(new Date('2026-08-08T04:59:00Z'), 7)).toBeNull()
    expect(autoFreezeTargetMonth(new Date('2026-08-08T05:01:00Z'), 7)).toBe('2026-07-01')
  })

  it('handles year boundaries', () => {
    expect(autoFreezeTargetMonth(new Date('2027-01-09T12:00:00Z'), 7)).toBe('2026-12-01')
  })
})
