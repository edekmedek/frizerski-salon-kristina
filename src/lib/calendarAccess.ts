export function isPastCalendarDate(date: string, today: string) {
  return date < today
}

export function canOpenCalendarDate(date: string, today: string, pastUnlocked: boolean) {
  return !isPastCalendarDate(date, today) || pastUnlocked
}

export function calendarDateAfterMove(currentDate: string, offset: number) {
  const date = new Date(`${currentDate}T12:00:00`)
  date.setDate(date.getDate() + offset)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
