import type { AppointmentStatus, Service, ServiceCategory } from '../types'

export function orderedServices(services: Service[]) {
  return [...services].sort((left, right) =>
    left.displayOrder - right.displayOrder || left.name.localeCompare(right.name, 'hr'),
  )
}

export function appointmentServices(services: Service[], categoryId?: string) {
  return orderedServices(services).filter(service =>
    service.isActive && service.isBookable && (!categoryId || service.categoryId === categoryId),
  )
}

export function orderedCategories(categories: ServiceCategory[]) {
  return [...categories].sort((left, right) =>
    left.displayOrder - right.displayOrder || left.name.localeCompare(right.name, 'hr'),
  )
}

export function appointmentStatusLabel(status: AppointmentStatus) {
  if (status === 'zakazan') return 'Zakazan'
  if (status === 'zavrsen') return 'Završen'
  return 'Otkazano'
}
