const dateFormatter = new Intl.DateTimeFormat('hr-HR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const shortDateFormatter = new Intl.DateTimeFormat('hr-HR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function formatDateTime(value: string): string {
  return dateFormatter.format(new Date(value))
}

export function formatDate(value: string): string {
  return shortDateFormatter.format(new Date(value))
}

export function toInputDateTimeValue(value: string): string {
  return new Date(value).toISOString().slice(0, 16)
}
