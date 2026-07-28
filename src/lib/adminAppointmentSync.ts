import type { Appointment } from '../types'
import { normalizeAppointmentTreatmentTotals } from './appointmentTreatments'

export interface SupabaseAppointmentRow {
  id: string
  client_id: string
  starts_at: string
  service: string | null
  status: string
  notes: string | null
  created_at: string
  updated_at: string
  service_id: string | null
  service_name_snapshot: string | null
  service_price_snapshot: number | string | null
  service_duration_snapshot: number | null
  total_price_snapshot: number | string | null
  total_duration_minutes: number | null
  no_charge: boolean | null
  confirmation_status?: 'pending' | 'confirmed' | null
}

export interface SupabaseAppointmentServiceRow {
  appointment_id: string
  service_id: string
  service_name_snapshot: string
  service_price_snapshot: number | string
  service_duration_snapshot: number | null
}

function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDateTimeValue(value: string) {
  const date = new Date(value)
  return `${localDateString(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function mapSupabaseAppointments(
  appointments: SupabaseAppointmentRow[],
  treatmentRows: SupabaseAppointmentServiceRow[],
): Appointment[] {
  return appointments.map(item => {
    const treatments = treatmentRows
      .filter(row => row.appointment_id === item.id)
      .map(row => ({
        serviceId: row.service_id,
        name: row.service_name_snapshot,
        price: Number(row.service_price_snapshot),
        durationMinutes: row.service_duration_snapshot ?? undefined,
      }))

    return normalizeAppointmentTreatmentTotals({
      id: item.id,
      clientId: item.client_id,
      dateTime: localDateTimeValue(item.starts_at),
      service: `${item.confirmation_status === 'pending' ? '⏳ Čeka potvrdu · ' : ''}${item.service_name_snapshot ?? item.service ?? 'Termin bez tretmana'}`,
      serviceId: item.service_id ?? undefined,
      servicePrice: item.total_price_snapshot == null
        ? item.service_price_snapshot == null ? undefined : Number(item.service_price_snapshot)
        : Number(item.total_price_snapshot),
      serviceDuration: item.total_duration_minutes ?? item.service_duration_snapshot ?? undefined,
      treatments: treatments.length ? treatments : item.service_id ? [{
        serviceId: item.service_id,
        name: item.service_name_snapshot ?? item.service ?? '',
        price: Number(item.service_price_snapshot ?? 0),
        durationMinutes: item.service_duration_snapshot ?? undefined,
      }] : [],
      noCharge: item.no_charge === true,
      confirmationStatus: item.confirmation_status === 'pending' ? 'pending' : 'confirmed',
      status: item.status === 'cancelled' ? 'otkazan' : item.status === 'completed' ? 'zavrsen' : 'zakazan',
      note: item.notes ?? '',
      assignedBy: 'Kristina',
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })
  })
}
