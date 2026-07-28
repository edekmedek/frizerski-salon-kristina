import type { AppointmentTreatment } from '../types'

export function normalizeDurationToQuarter(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(15, Math.round(value / 15) * 15)
}

export function isValidAppointmentDuration(value: number | undefined) {
  return value != null && value >= 15 && value % 15 === 0
}

export function suggestedTreatmentDuration(treatments: AppointmentTreatment[]) {
  return treatments.reduce((total, treatment) => total + (treatment.durationMinutes ?? 0), 0)
}
