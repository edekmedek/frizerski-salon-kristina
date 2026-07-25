export function isPastCalendarDate(date: string, today: string) {
  return date < today
}

export function canOpenMainCalendarDate(date: string, today: string) {
  return !isPastCalendarDate(date, today)
}

export function isArchivedAppointment(dateTime: string, today: string) {
  return isPastCalendarDate(dateTime.slice(0, 10), today)
}

export function calendarDateAfterMove(currentDate: string, offset: number) {
  const date = new Date(`${currentDate}T12:00:00`)
  date.setDate(date.getDate() + offset)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
