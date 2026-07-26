import { describe, expect, it } from 'vitest'
import { conflictingAppointments } from '../AdminApp'
import type { Appointment } from '../types'

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'existing',
    clientId: 'client-1',
    dateTime: '2026-07-27T13:15',
    service: 'Šišanje pranje i oblikovanje',
    treatments: [],
    servicePrice: 0,
    serviceDuration: 30,
    status: 'zakazan',
    note: '',
    assignedBy: 'Kristina',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('preklapanje termina u kalendaru', () => {
  it('ne prijavljuje konflikt kada novi termin počinje točno nakon postojećeg', () => {
    const existing = appointment({})
    expect(conflictingAppointments(
      '2026-07-27',
      '13:45',
      'Šišanje',
      [existing],
      '',
      60,
    )).toEqual([])
  })

  it('i dalje prijavljuje stvarno vremensko preklapanje', () => {
    const existing = appointment({})
    expect(conflictingAppointments(
      '2026-07-27',
      '13:30',
      'Šišanje',
      [existing],
      '',
      60,
    )).toEqual([existing])
  })

  it('dopušta drugi aktivni termin tijekom faze čekanja boje', () => {
    const coloring = appointment({
      service: 'Bojanje',
      dateTime: '2026-07-27T13:00',
      serviceDuration: 120,
    })
    expect(conflictingAppointments(
      '2026-07-27',
      '13:30',
      'Muško šišanje',
      [coloring],
      '',
      30,
    )).toEqual([])
  })
})
