import { describe, expect, it } from 'vitest'
import type { Appointment, Service } from '../types'
import { addTreatmentPreservingOverrides, appointmentTreatmentLabel, finalAppointmentPrice, normalizeAppointmentTreatmentTotals, removeTreatmentPreservingOverrides, setManualAppointmentPrice, toggleAppointmentNoCharge, treatmentTotals } from './appointmentTreatments'

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

  it('uključivanje gratis postavlja nulu, a isključivanje vraća zbroj', () => {
    const appointment = addTreatmentPreservingOverrides(
      addTreatmentPreservingOverrides(base, service('s1', 'Šišanje', 7, 30)),
      service('s2', 'Oblikovanje', 15, 45),
    )
    const free = toggleAppointmentNoCharge(appointment, true)
    expect(free.servicePrice).toBe(0)
    expect(toggleAppointmentNoCharge(free, false).servicePrice).toBe(22)
  })

  it('nakon gratis stanja vraća jasno evidentiranu ručnu korekciju', () => {
    const appointment = addTreatmentPreservingOverrides(base, service('s1', 'Šišanje', 7, 30))
    const corrected = setManualAppointmentPrice(appointment, 9)
    const reopened = toggleAppointmentNoCharge(toggleAppointmentNoCharge(corrected, true), false)
    expect(reopened.servicePrice).toBe(9)
  })

  it('pri ponovnom otvaranju ne-gratis termina popravlja pogrešnu nulu', () => {
    const appointment = {
      ...base,
      treatments: [
        { serviceId: 's1', name: 'Šišanje kose mašinica', price: 7, durationMinutes: 30 },
        { serviceId: 's2', name: 'Šišanje i oblikovanje', price: 15, durationMinutes: 45 },
        { serviceId: 's3', name: 'Šišanje šiški', price: 4, durationMinutes: 15 },
      ],
      servicePrice: 0,
      serviceDuration: 0,
      noCharge: false,
    }
    const normalized = normalizeAppointmentTreatmentTotals(appointment)
    expect(normalized.servicePrice).toBe(26)
    expect(normalized.serviceDuration).toBe(90)
    expect(normalized.priceWasManuallyAdjusted).toBe(false)
  })
})
