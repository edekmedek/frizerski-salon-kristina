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
  const priceWasManual = appointment.priceWasManuallyAdjusted === true
    || (appointment.servicePrice != null && appointment.servicePrice !== previous.price)
  return {
    ...appointment,
    treatments: nextTreatments,
    service: nextTreatments.map(item => item.name).join(' + '),
    serviceId: nextTreatments[0]?.serviceId,
    serviceDuration: durationWasManual ? appointment.serviceDuration : next.duration,
    servicePrice: appointment.noCharge ? 0 : priceWasManual ? appointment.servicePrice : next.price,
    priceWasManuallyAdjusted: priceWasManual,
  }
}

export function removeTreatmentPreservingOverrides(appointment: Appointment, serviceId: string) {
  const treatments = appointment.treatments ?? []
  const previous = treatmentTotals(treatments)
  const nextTreatments = treatments.filter(item => item.serviceId !== serviceId)
  const next = treatmentTotals(nextTreatments)
  const durationWasManual = appointment.serviceDuration != null && appointment.serviceDuration !== previous.duration
  const priceWasManual = appointment.priceWasManuallyAdjusted === true
    || (appointment.servicePrice != null && appointment.servicePrice !== previous.price)
  return {
    ...appointment,
    treatments: nextTreatments,
    service: nextTreatments.map(item => item.name).join(' + '),
    serviceId: nextTreatments[0]?.serviceId,
    serviceDuration: durationWasManual ? appointment.serviceDuration : next.duration,
    servicePrice: appointment.noCharge ? 0 : priceWasManual ? appointment.servicePrice : next.price,
    priceWasManuallyAdjusted: priceWasManual,
  }
}

export function finalAppointmentPrice(appointment: Pick<Appointment, 'noCharge' | 'servicePrice'>) {
  return appointment.noCharge ? 0 : appointment.servicePrice ?? 0
}

export function normalizeAppointmentTreatmentTotals(appointment: Appointment) {
  const totals = treatmentTotals(appointment.treatments ?? [])
  const invalidZeroPrice = !appointment.noCharge && appointment.servicePrice === 0 && totals.price > 0
  const invalidZeroDuration = appointment.serviceDuration === 0 && totals.duration > 0
  const normalizedPrice = appointment.noCharge
    ? 0
    : invalidZeroPrice
      ? totals.price
      : appointment.servicePrice ?? totals.price
  return {
    ...appointment,
    servicePrice: normalizedPrice,
    serviceDuration: invalidZeroDuration ? totals.duration : appointment.serviceDuration ?? totals.duration,
    priceWasManuallyAdjusted: !appointment.noCharge
      && normalizedPrice !== totals.price,
  }
}

export function toggleAppointmentNoCharge(appointment: Appointment, noCharge: boolean) {
  const totals = treatmentTotals(appointment.treatments ?? [])
  if (noCharge) {
    const currentPrice = appointment.servicePrice ?? totals.price
    return {
      ...appointment,
      noCharge: true,
      priceBeforeNoCharge: currentPrice,
      priceWasManuallyAdjusted: currentPrice !== totals.price,
      servicePrice: 0,
    }
  }
  const restoredPrice = appointment.priceWasManuallyAdjusted
    && appointment.priceBeforeNoCharge != null
    ? appointment.priceBeforeNoCharge
    : totals.price
  return {
    ...appointment,
    noCharge: false,
    servicePrice: restoredPrice,
    priceBeforeNoCharge: undefined,
  }
}

export function setManualAppointmentPrice(appointment: Appointment, price: number) {
  return {
    ...appointment,
    servicePrice: price,
    priceWasManuallyAdjusted: true,
  }
}
