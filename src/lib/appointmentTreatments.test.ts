import { describe, expect, it } from 'vitest'
import type { Appointment, Service } from '../types'
import { addTreatmentPreservingOverrides, appointmentTreatmentLabel, finalAppointmentPrice, removeTreatmentPreservingOverrides, treatmentTotals } from './appointmentTreatments'

const service = (id: string, name: string, price: number, durationMinutes: number): Service => ({
  id, name, price, durationMinutes, categoryId: 'c', categoryName: 'Kategorija',
  isActive: true, isBookable: true, displayOrder: 1,
})
const base: Appointment = {
  id: '', clientId: 'c1', dateTime: '2026-07-25T12:00', service: '',
  treatments: [], status: 'zakazan', note: '', assignedBy: 'Kristina', createdAt: '', updatedAt: '',
}

describe('više tretmana u terminu', () => {
  it('zbraja cijene i trajanja te ne dopušta duplikat', () => {
    const first = addTreatmentPreservingOverrides(base, service('s1', 'Šišanje', 10, 30))
    const second = addTreatmentPreservingOverrides(first, service('s2', 'Pranje', 5, 15))
    expect(treatmentTotals(second.treatments ?? [])).toEqual({ price: 15, duration: 45 })
    expect(addTreatmentPreservingOverrides(second, service('s1', 'Šišanje', 10, 30))).toBe(second)
    expect(appointmentTreatmentLabel(second)).toBe('Šišanje + Pranje')
  })

  it('čuva svjesnu ručnu korekciju nakon promjene tretmana', () => {
    const first = addTreatmentPreservingOverrides(base, service('s1', 'Šišanje', 10, 30))
    const corrected = { ...first, servicePrice: 12, serviceDuration: 40 }
    const second = addTreatmentPreservingOverrides(corrected, service('s2', 'Pranje', 5, 15))
    expect(second.servicePrice).toBe(12)
    expect(second.serviceDuration).toBe(40)
    expect(removeTreatmentPreservingOverrides(second, 's2').servicePrice).toBe(12)
  })

  it('gratis termin uvijek ima konačnu cijenu nula', () => {
    expect(finalAppointmentPrice({ noCharge: true, servicePrice: 99 })).toBe(0)
  })
})
