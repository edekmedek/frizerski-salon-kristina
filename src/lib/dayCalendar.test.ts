import { describe, expect, it } from 'vitest'
import { calendarEventLayout, calendarTimeMarks, calendarWorkingHours, timeFromCalendarPosition } from './dayCalendar'

describe('dnevni kalendar', () => {
  it('postavlja termin na stvarni položaj i koristi 30 minuta bez trajanja', () => {
    const layout = calendarEventLayout('2026-07-25T08:00')
    expect(layout.displayDuration).toBe(30)
    expect(layout.topPercent).toBeCloseTo(6.667, 2)
    expect(layout.heightPercent).toBeCloseTo(3.333, 2)
  })

  it('visinu termina računa iz spremljenog trajanja', () => {
    expect(calendarEventLayout('2026-07-25T12:00', 120).heightPercent).toBeCloseTo(13.333, 2)
  })

  it('klik na prazninu zaokružuje na interval od 15 minuta', () => {
    expect(timeFromCalendarPosition(90, 900)).toBe('08:30')
    expect(timeFromCalendarPosition(899, 900)).toBe('21:45')
  })

  it('prikazuje sate i pola sata od 07:00 do 22:00', () => {
    const marks = calendarTimeMarks()
    expect(marks).toHaveLength(31)
    expect(marks[0]).toMatchObject({ label: '07:00', isHour: true })
    expect(marks[1]).toMatchObject({ label: '07:30', isHour: false })
    expect(marks.at(-1)).toMatchObject({ label: '22:00', isHour: true })
  })

  it('prikazuje službeno radno vrijeme kao vizualnu smjernicu', () => {
    expect(calendarWorkingHours('2026-07-27')).toMatchObject({ start: 780, end: 1140 })
    expect(calendarWorkingHours('2026-07-28')).toMatchObject({ start: 480, end: 840 })
    expect(calendarWorkingHours('2026-07-29')).toMatchObject({ start: 720, end: 1140 })
    expect(calendarWorkingHours('2026-08-01')).toMatchObject({ start: 480, end: 840 })
  })

  it('nedjeljom označava cijeli kalendar kao vrijeme izvan radnog vremena', () => {
    expect(calendarWorkingHours('2026-07-26')).toBeNull()
  })
})
