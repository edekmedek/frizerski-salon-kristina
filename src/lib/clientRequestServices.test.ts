import { describe, expect, it } from 'vitest'
import { mapAdminRequests } from './adminInbox'

describe('normalized client request services', () => {
  const legacyRow = {
    id: 'request-1',
    client_id: 'client-1',
    client_first_name: 'TEST',
    client_last_name: 'Klijent',
    client_phone: '0999302468',
    kind: 'appointment' as const,
    service: 'Legacy usluga',
    preferred_dates: ['2026-07-29'],
    day_period: 'any' as const,
    client_message: '',
    status: 'pending' as const,
    admin_reply: '',
    appointment_id: null,
    admin_read_at: null,
    created_at: '2026-07-25T10:00:00Z',
    updated_at: '2026-07-25T10:00:00Z',
  }

  it('orders normalized treatments by display order', () => {
    const [request] = mapAdminRequests([legacyRow], [{
      request_id: 'request-1',
      service_id: 'service-2',
      service_name_snapshot: 'Feniranje',
      service_price_snapshot: 12,
      service_duration_snapshot: 45,
      display_order: 1,
    }, {
      request_id: 'request-1',
      service_id: 'service-1',
      service_name_snapshot: 'Pranje',
      service_price_snapshot: 5,
      service_duration_snapshot: 15,
      display_order: 0,
    }])

    expect(request.treatments.map(item => item.name)).toEqual(['Pranje', 'Feniranje'])
  })

  it('keeps legacy service text when no normalized rows exist', () => {
    const [request] = mapAdminRequests([legacyRow])
    expect(request.treatments).toEqual([])
    expect(request.service).toBe('Legacy usluga')
  })
})
