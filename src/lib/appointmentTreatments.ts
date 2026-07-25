import type { Appointment, AppointmentTreatment, Service } from '../types'

export function treatmentTotals(treatments: AppointmentTreatment[]) {
  return {
    price: treatments.reduce((sum, item) => sum + item.price, 0),
    duration: treatments.reduce((sum, item) => sum + (item.durationMinutes ?? 0), 0),
  }
}

export function appointmentTreatmentLabel(appointment: Pick<Appointment, 'service' | 'treatments'>) {
  return appointment.treatments?.length
    ? appointment.treatments.map(item => item.name).join(' + ')
    : appointment.service
}

export function addTreatmentPreservingOverrides(appointment: Appointment, service: Service) {
  const treatments = appointment.treatments ?? []
  if (treatments.some(item => item.serviceId === service.id)) return appointment
  const previous = treatmentTotals(treatments)
  const nextTreatments = [...treatments, {
    serviceId: service.id,
    name: service.name,
    price: service.price,
    durationMinutes: service.durationMinutes,
  }]
  const next = treatmentTotals(nextTreatments)
  const durationWasManual = appointment.serviceDuration != null && appointment.serviceDuration !== previous.duration
  const priceWasManual = appointment.servicePrice != null && appointment.servicePrice !== previous.price
  return {
    ...appointment,
    treatments: nextTreatments,
    service: nextTreatments.map(item => item.name).join(' + '),
    serviceId: nextTreatments[0]?.serviceId,
    serviceDuration: durationWasManual ? appointment.serviceDuration : next.duration,
    servicePrice: appointment.noCharge ? 0 : priceWasManual ? appointment.servicePrice : next.price,
  }
}

export function removeTreatmentPreservingOverrides(appointment: Appointment, serviceId: string) {
  const treatments = appointment.treatments ?? []
  const previous = treatmentTotals(treatments)
  const nextTreatments = treatments.filter(item => item.serviceId !== serviceId)
  const next = treatmentTotals(nextTreatments)
  const durationWasManual = appointment.serviceDuration != null && appointment.serviceDuration !== previous.duration
  const priceWasManual = appointment.servicePrice != null && appointment.servicePrice !== previous.price
  return {
    ...appointment,
    treatments: nextTreatments,
    service: nextTreatments.map(item => item.name).join(' + '),
    serviceId: nextTreatments[0]?.serviceId,
    serviceDuration: durationWasManual ? appointment.serviceDuration : next.duration,
    servicePrice: appointment.noCharge ? 0 : priceWasManual ? appointment.servicePrice : next.price,
  }
}

export function finalAppointmentPrice(appointment: Pick<Appointment, 'noCharge' | 'servicePrice'>) {
  return appointment.noCharge ? 0 : appointment.servicePrice ?? 0
}
