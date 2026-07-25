export const CALENDAR_START_MINUTES = 7 * 60
export const CALENDAR_END_MINUTES = 22 * 60
export const CALENDAR_DURATION_MINUTES = CALENDAR_END_MINUTES - CALENDAR_START_MINUTES

const WORKING_HOURS: Record<number, { start: number; end: number } | null> = {
  0: null,
  1: { start: 13 * 60, end: 19 * 60 },
  2: { start: 8 * 60, end: 14 * 60 },
  3: { start: 12 * 60, end: 19 * 60 },
  4: { start: 12 * 60, end: 19 * 60 },
  5: { start: 12 * 60, end: 19 * 60 },
  6: { start: 8 * 60, end: 14 * 60 },
}

export function calendarWorkingHours(dateValue: string) {
  const day = new Date(`${dateValue}T12:00:00`).getDay()
  const hours = WORKING_HOURS[day]
  if (!hours) return null
  return {
    ...hours,
    topPercent: ((hours.start - CALENDAR_START_MINUTES) / CALENDAR_DURATION_MINUTES) * 100,
    heightPercent: ((hours.end - hours.start) / CALENDAR_DURATION_MINUTES) * 100,
  }
}

export function calendarWorkingHoursLabel(dateValue: string) {
  const hours = calendarWorkingHours(dateValue)
  if (!hours) return 'Danas ne radimo'
  const format = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return `Radno vrijeme danas: ${format(hours.start)}–${format(hours.end)}`
}

export function minutesFromDateTime(dateTime: string) {
  const time = dateTime.slice(11, 16)
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function calendarEventLayout(dateTime: string, durationMinutes?: number) {
  const duration = durationMinutes && durationMinutes > 0 ? durationMinutes : 30
  const start = minutesFromDateTime(dateTime)
  const visibleStart = Math.max(start, CALENDAR_START_MINUTES)
  const visibleEnd = Math.min(start + duration, CALENDAR_END_MINUTES)
  return {
    visible: visibleEnd > visibleStart,
    topPercent: ((visibleStart - CALENDAR_START_MINUTES) / CALENDAR_DURATION_MINUTES) * 100,
    heightPercent: ((visibleEnd - visibleStart) / CALENDAR_DURATION_MINUTES) * 100,
    displayDuration: duration,
  }
}

export function timeFromCalendarPosition(offsetY: number, calendarHeight: number) {
  const ratio = calendarHeight > 0 ? Math.min(1, Math.max(0, offsetY / calendarHeight)) : 0
  const rawMinutes = CALENDAR_START_MINUTES + ratio * CALENDAR_DURATION_MINUTES
  const snapped = Math.round(rawMinutes / 15) * 15
  const minutes = Math.min(CALENDAR_END_MINUTES - 15, Math.max(CALENDAR_START_MINUTES, snapped))
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function calendarTimeMarks() {
  return Array.from({ length: CALENDAR_DURATION_MINUTES / 30 + 1 }, (_, index) => {
    const minutes = CALENDAR_START_MINUTES + index * 30
    return {
      minutes,
      label: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      isHour: minutes % 60 === 0,
      topPercent: ((minutes - CALENDAR_START_MINUTES) / CALENDAR_DURATION_MINUTES) * 100,
    }
  })
}
