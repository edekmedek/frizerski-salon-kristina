import { describe, expect, it } from 'vitest'
import { calendarDateAfterMove, canOpenCalendarDate, isPastCalendarDate } from './calendarAccess'

describe('zaštita prošlih datuma kalendara', () => {
  const today = '2026-07-25'

  it('zabranjuje prošlost dok PIN nije potvrđen', () => {
    expect(canOpenCalendarDate('2026-07-24', today, false)).toBe(false)
    expect(isPastCalendarDate('2026-07-24', today)).toBe(true)
  })

  it('pogrešan PIN ne mijenja zaključano stanje', () => {
    const verified = false
    expect(canOpenCalendarDate('2026-07-24', today, verified)).toBe(false)
  })

  it('ispravan PIN dopušta prošlost samo uz memorijsko otključavanje', () => {
    const verified = true
    expect(canOpenCalendarDate('2026-07-24', today, verified)).toBe(true)
  })

  it('ručni odabir prošlog datuma podliježe istoj provjeri', () => {
    expect(canOpenCalendarDate('2025-12-31', today, false)).toBe(false)
    expect(canOpenCalendarDate('2026-07-25', today, false)).toBe(true)
    expect(canOpenCalendarDate('2026-07-26', today, false)).toBe(true)
  })

  it('izračun prethodnog dana ne preskače zaštitnu odluku', () => {
    const target = calendarDateAfterMove(today, -1)
    expect(target).toBe('2026-07-24')
    expect(canOpenCalendarDate(target, today, false)).toBe(false)
  })
})
