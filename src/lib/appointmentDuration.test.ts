import { describe, expect, it } from 'vitest'
import { isValidAppointmentDuration, normalizeDurationToQuarter, suggestedTreatmentDuration } from './appointmentDuration'

describe('flexible appointment duration', () => {
  it('allows no treatments when duration is valid', () => {
    expect(suggestedTreatmentDuration([])).toBe(0)
    expect(isValidAppointmentDuration(45)).toBe(true)
  })
  it('uses 15-minute steps', () => {
    expect(normalizeDurationToQuarter(22)).toBe(15)
    expect(normalizeDurationToQuarter(38)).toBe(45)
    expect(isValidAppointmentDuration(40)).toBe(false)
  })
  it('sums multiple treatments', () => {
    expect(suggestedTreatmentDuration([
      { serviceId: 'a', name: 'Šišanje', price: 10, durationMinutes: 45 },
      { serviceId: 'b', name: 'Feniranje', price: 12, durationMinutes: 30 },
    ])).toBe(75)
  })
})
