import { describe, expect, it } from 'vitest'
import { mapSupabaseAppointments } from './adminAppointmentSync'

describe('osvježavanje administratorskog kalendara', () => {
  it('odmah mapira termin koji je RPC stvorio iz zahtjeva', () => {
    const [appointment] = mapSupabaseAppointments([{
      id: 'appointment-1',
      client_id: 'client-1',
      starts_at: '2026-07-28T13:00:00.000Z',
      service: 'Šišanje i oblikovanje',
      status: 'confirmed',
      notes: null,
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      service_id: 'service-1',
      service_name_snapshot: 'Šišanje i oblikovanje',
      service_price_snapshot: 15,
      service_duration_snapshot: 45,
      total_price_snapshot: 15,
      total_duration_minutes: 45,
      no_charge: false,
    }], [{
      appointment_id: 'appointment-1',
      service_id: 'service-1',
      service_name_snapshot: 'Šišanje i oblikovanje',
      service_price_snapshot: 15,
      service_duration_snapshot: 45,
    }])

    expect(appointment.id).toBe('appointment-1')
    expect(appointment.status).toBe('zakazan')
    expect(appointment.treatments).toHaveLength(1)
    expect(appointment.servicePrice).toBe(15)
    expect(appointment.confirmationStatus).toBe('confirmed')
  })

  it('pending potvrda ostaje aktivan termin i zauzima kalendar', () => {
    const [appointment] = mapSupabaseAppointments([{
      id: 'appointment-pending',
      client_id: 'client-1',
      starts_at: '2026-07-28T14:00:00.000Z',
      service: '',
      status: 'confirmed',
      confirmation_status: 'pending',
      notes: null,
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z',
      service_id: null,
      service_name_snapshot: '',
      service_price_snapshot: 0,
      service_duration_snapshot: 30,
      total_price_snapshot: 0,
      total_duration_minutes: 30,
      no_charge: false,
    }], [])
    expect(appointment.status).toBe('zakazan')
    expect(appointment.confirmationStatus).toBe('pending')
    expect(appointment.service).toContain('Čeka potvrdu')
  })
})
