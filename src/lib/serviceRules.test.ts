import { describe, expect, it } from 'vitest'
import type { Service, ServiceCategory } from '../types'
import { appointmentServices, appointmentStatusLabel, orderedCategories, orderedServices } from './serviceRules'

const services: Service[] = [
  { id: 'olaplex', categoryId: 'color', categoryName: 'Bojenje i dodaci', name: 'Olaplex 10ml', price: 2, isActive: true, isBookable: false, displayOrder: 3 },
  { id: 'inactive', categoryId: 'cuts', categoryName: 'Šišanje', name: 'Stara usluga', price: 9, isActive: false, isBookable: true, displayOrder: 1 },
  { id: 'haircut', categoryId: 'cuts', categoryName: 'Šišanje', name: 'Šišanje kose', price: 10, isActive: true, isBookable: true, displayOrder: 2 },
]
const categories: ServiceCategory[] = [
  { id: 'cuts', name: 'Šišanje', isActive: true, displayOrder: 2 },
  { id: 'color', name: 'Bojenje i dodaci', isActive: true, displayOrder: 1 },
]

describe('pravila cjenika', () => {
  it('zadržava sve stavke cjenika u zadanom redoslijedu', () => {
    expect(orderedServices(services).map(service => service.id)).toEqual(['inactive', 'haircut', 'olaplex'])
  })

  it('za termin nudi samo aktivne samostalne usluge', () => {
    expect(appointmentServices(services).map(service => service.id)).toEqual(['haircut'])
    expect(appointmentServices(services, 'color')).toEqual([])
    expect(appointmentServices(services, 'cuts').map(service => service.id)).toEqual(['haircut'])
  })

  it('zadržava podesivi redoslijed kategorija', () => {
    expect(orderedCategories(categories).map(category => category.id)).toEqual(['color', 'cuts'])
  })

  it('ne mijenja status Zakazan u Potvrđeno', () => {
    expect(appointmentStatusLabel('zakazan')).toBe('Zakazan')
    expect(appointmentStatusLabel('otkazan')).toBe('Otkazano')
  })
})
