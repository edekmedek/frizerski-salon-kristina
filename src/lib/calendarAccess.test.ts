import { describe, expect, it } from 'vitest'
import { calendarDateAfterMove, canOpenMainCalendarDate, isArchivedAppointment, isPastCalendarDate } from './calendarAccess'

describe('zaštita prošlih datuma kalendara', () => {
  const today = '2026-07-25'

  it('glavni kalendar uvijek zabranjuje prošlost', () => {
    expect(canOpenMainCalendarDate('2026-07-24', today)).toBe(false)
    expect(isPastCalendarDate('2026-07-24', today)).toBe(true)
  })

  it('ručni odabir dopušta samo danas i budućnost', () => {
    expect(canOpenMainCalendarDate('2025-12-31', today)).toBe(false)
    expect(canOpenMainCalendarDate('2026-07-25', today)).toBe(true)
    expect(canOpenMainCalendarDate('2026-07-26', today)).toBe(true)
  })

  it('prethodni dan ne može zaobići ograničenje glavnog kalendara', () => {
    const target = calendarDateAfterMove(today, -1)
    expect(target).toBe('2026-07-24')
    expect(canOpenMainCalendarDate(target, today)).toBe(false)
  })

  it('odvaja prošle termine od nezaštićenog popisa', () => {
    expect(isArchivedAppointment('2026-07-24T15:00', today)).toBe(true)
    expect(isArchivedAppointment('2026-07-25T08:00', today)).toBe(false)
  })
})
