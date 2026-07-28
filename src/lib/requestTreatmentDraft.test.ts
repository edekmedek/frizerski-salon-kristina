import { describe, expect, it } from 'vitest'
import type { Service } from '../types'
import type { AdminRequest } from './adminInbox'
import {
  addRequestTreatment,
  initialRequestTreatmentDraft,
  removeRequestTreatment,
  requestTreatmentDuration,
  updateRequestTreatmentDuration,
} from './requestTreatmentDraft'

const services: Service[] = [
  { id: 'cut', name: 'Šišanje', categoryId: 'hair', categoryName: 'Šišanje', price: 15, durationMinutes: 30, isActive: true, isBookable: true, displayOrder: 1 },
  { id: 'color', name: 'Bojanje', categoryId: 'color', categoryName: 'Bojanje', price: 40, durationMinutes: 60, isActive: true, isBookable: true, displayOrder: 1 },
]

const request = (treatments: AdminRequest['treatments'], service = ''): AdminRequest => ({
  id: 'request', clientId: 'client', clientName: 'Klijent', clientPhone: '099',
  kind: 'appointment', service, treatments, preferredDates: ['2026-07-30'],
  dayPeriod: 'any', message: '', status: 'pending', adminReply: '',
  createdAt: '2026-07-28T08:00:00Z', updatedAt: '2026-07-28T08:00:00Z',
})

describe('uređivanje tretmana zahtjeva', () => {
  it('dodaje uslugu iz druge kategorije bez duplikata', () => {
    const first = addRequestTreatment([], services[0])
    const second = addRequestTreatment(first, services[1])
    expect(second.map(item => item.serviceId)).toEqual(['cut', 'color'])
    expect(addRequestTreatment(second, services[0])).toBe(second)
  })

  it('uklanja uslugu i ponovno uređuje redoslijed', () => {
    const draft = addRequestTreatment(addRequestTreatment([], services[0]), services[1])
    expect(removeRequestTreatment(draft, 'cut')).toEqual([
      expect.objectContaining({ serviceId: 'color', displayOrder: 0 }),
    ])
  })

  it('mijenja trajanje i izračunava ukupno trajanje', () => {
    const draft = updateRequestTreatmentDuration(
      addRequestTreatment(addRequestTreatment([], services[0]), services[1]),
      'cut',
      45,
    )
    expect(requestTreatmentDuration(draft, 30)).toBe(105)
  })

  it('za zahtjev bez usluge koristi ručno ukupno trajanje', () => {
    expect(requestTreatmentDuration([], 75)).toBe(75)
  })

  it('legacy tekst ostavlja samo kao informaciju bez lažnog ID-a', () => {
    expect(initialRequestTreatmentDraft(request([], 'Stara usluga'), services)).toEqual([])
  })

  it('pri ponovnom otvaranju prednost daje spremljenom snapshot trajanju', () => {
    const draft = initialRequestTreatmentDraft(request([{
      serviceId: 'cut', name: 'Šišanje', durationMinutes: 50, displayOrder: 0,
    }]), services)
    expect(draft[0].durationMinutes).toBe(50)
  })
})
