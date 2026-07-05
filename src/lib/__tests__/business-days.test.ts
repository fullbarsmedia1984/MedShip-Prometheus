import { describe, it, expect } from 'vitest'
import {
  businessDaysLeftInMonth,
  isBusinessDay,
  isHoliday,
  isWeekend,
  nonBusinessDayReason,
  usHolidays,
} from '../business-days'

describe('usHolidays', () => {
  it('computes 2026 observed holidays correctly', () => {
    const holidays = usHolidays(2026)
    expect(holidays.has('2026-01-01')).toBe(true) // New Year (Thu)
    expect(holidays.has('2026-01-19')).toBe(true) // MLK (3rd Mon)
    expect(holidays.has('2026-05-25')).toBe(true) // Memorial (last Mon)
    expect(holidays.has('2026-06-19')).toBe(true) // Juneteenth (Fri)
    // July 4 2026 is a Saturday -> observed Friday July 3
    expect(holidays.has('2026-07-03')).toBe(true)
    expect(holidays.has('2026-07-04')).toBe(false)
    expect(holidays.has('2026-09-07')).toBe(true) // Labor Day (1st Mon Sep) — inside Q3!
    expect(holidays.has('2026-11-26')).toBe(true) // Thanksgiving (4th Thu)
    expect(holidays.has('2026-11-27')).toBe(true) // day after Thanksgiving
    expect(holidays.has('2026-12-25')).toBe(true) // Christmas (Fri)
  })

  it('shifts Sunday holidays to Monday', () => {
    // July 4 2027 is a Sunday -> observed Monday July 5
    expect(usHolidays(2027).has('2027-07-05')).toBe(true)
    expect(usHolidays(2027).has('2027-07-04')).toBe(false)
  })
})

describe('isBusinessDay / nonBusinessDayReason', () => {
  it('weekends are not business days', () => {
    expect(isWeekend('2026-07-04')).toBe(true) // Saturday
    expect(isWeekend('2026-07-05')).toBe(true) // Sunday
    expect(nonBusinessDayReason('2026-07-04')).toBe('weekend')
  })

  it('observed holidays are not business days', () => {
    expect(isHoliday('2026-07-03')).toBe(true)
    expect(isBusinessDay('2026-07-03')).toBe(false)
    expect(nonBusinessDayReason('2026-07-03')).toBe('holiday')
    expect(nonBusinessDayReason('2026-09-07')).toBe('holiday') // Labor Day Monday
  })

  it('ordinary weekdays are business days', () => {
    expect(isBusinessDay('2026-07-06')).toBe(true) // Monday
    expect(nonBusinessDayReason('2026-07-08')).toBeNull() // Wednesday
  })
})

describe('businessDaysLeftInMonth', () => {
  it('counts selling days from the given date through month end', () => {
    // July 2026: 23 weekdays, minus the observed July 3 holiday = 22 selling days.
    expect(businessDaysLeftInMonth('2026-07-01')).toBe(22)
    // From Saturday July 4: weekdays remaining Jul 6-31 = 20.
    expect(businessDaysLeftInMonth('2026-07-04')).toBe(20)
    // Last business day of July counts itself.
    expect(businessDaysLeftInMonth('2026-07-31')).toBe(1)
  })

  it('handles the Labor Day month', () => {
    // September 2026: 22 weekdays minus Labor Day (Sep 7) = 21.
    expect(businessDaysLeftInMonth('2026-09-01')).toBe(21)
  })
})
