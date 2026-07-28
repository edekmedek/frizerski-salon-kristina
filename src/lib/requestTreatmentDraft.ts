import type { Service } from '../types'
import type { AdminRequest, AdminRequestTreatment } from './adminInbox'

export function initialRequestTreatmentDraft(
  request: AdminRequest,
  services: Service[],
): AdminRequestTreatment[] {
  return request.treatments
    .filter(treatment => treatment.serviceId)
    .map((treatment, index) => {
      const catalogService = services.find(service => service.id === treatment.serviceId)
      return {
        ...treatment,
        name: catalogService?.name ?? treatment.name,
        price: treatment.price ?? catalogService?.price,
        durationMinutes: treatment.durationMinutes > 0
          ? treatment.durationMinutes
          : catalogService?.durationMinutes ?? 0,
        displayOrder: index,
      }
    })
}

export function addRequestTreatment(
  treatments: AdminRequestTreatment[],
  service: Service,
): AdminRequestTreatment[] {
  if (treatments.some(treatment => treatment.serviceId === service.id)) return treatments
  return [...treatments, {
    serviceId: service.id,
    name: service.name,
    price: service.price,
    durationMinutes: service.durationMinutes ?? 0,
    displayOrder: treatments.length,
  }]
}

export function removeRequestTreatment(
  treatments: AdminRequestTreatment[],
  serviceId: string,
): AdminRequestTreatment[] {
  return treatments
    .filter(treatment => treatment.serviceId !== serviceId)
    .map((treatment, index) => ({ ...treatment, displayOrder: index }))
}

export function updateRequestTreatmentDuration(
  treatments: AdminRequestTreatment[],
  serviceId: string,
  durationMinutes: number,
): AdminRequestTreatment[] {
  const safeDuration = Math.max(0, Math.round(durationMinutes))
  return treatments.map(treatment => treatment.serviceId === serviceId
    ? { ...treatment, durationMinutes: safeDuration }
    : treatment)
}

export function requestTreatmentDuration(
  treatments: AdminRequestTreatment[],
  emptyRequestDuration: number,
) {
  return treatments.length
    ? treatments.reduce((sum, treatment) => sum + treatment.durationMinutes, 0)
    : emptyRequestDuration
}
