import { describe, expect, it } from 'vitest'
import { adminInboxCounts, adminRequestNotificationVersion, hasNewUnreadAdminRequest, mapAdminMessages, mapAdminRequests, requestStatusLabel } from './adminInbox'

describe('Supabase administratorski inbox', () => {
  const requests = mapAdminRequests([
    {
      id: '4ef9f20a-603d-4c8d-955e-91ed2f67d946', client_id: 'client-1',
      client_first_name: 'TEST', client_last_name: 'Klijent', client_phone: '0999302468',
      kind: 'appointment', service: 'Svečana frizura duga kosa',
      preferred_dates: ['2026-07-27'], day_period: 'any', client_message: 'Napomena',
      status: 'pending', admin_reply: '', appointment_id: null, admin_read_at: null,
      created_at: '2026-07-25T10:00:00Z', updated_at: '2026-07-25T10:00:00Z',
    },
    {
      id: '75e75f27-9e0e-4685-a380-e0a5b2a96f6b', client_id: 'client-1',
      client_first_name: 'TEST', client_last_name: 'Klijent', client_phone: '0999302468',
      kind: 'appointment', service: 'Šišanje i oblikovanje',
      preferred_dates: ['2026-07-28'], day_period: 'afternoon', client_message: '',
      status: 'pending', admin_reply: '', appointment_id: null, admin_read_at: null,
      created_at: '2026-07-25T11:00:00Z', updated_at: '2026-07-25T11:00:00Z',
    },
  ])

  it('prikazuje oba postojeća pending zahtjeva iz Supabasea', () => {
    expect(requests.map(item => item.id)).toEqual([
      '4ef9f20a-603d-4c8d-955e-91ed2f67d946',
      '75e75f27-9e0e-4685-a380-e0a5b2a96f6b',
    ])
    expect(requestStatusLabel(requests[0].status)).toBe('Zahtjev poslan')
  })

  it('broji samo neotvorene zahtjeve i nepročitane klijentske poruke', () => {
    const messages = mapAdminMessages([{
      id: 'message-1', client_id: 'client-1', client_first_name: 'TEST',
      client_last_name: 'Klijent', client_phone: '0999302468', sender: 'client',
      subject: 'Pitanje', message: 'Cijeli sadržaj', is_read: false, read_at: null,
      archived_at: null, parent_message_id: null, created_at: '2026-07-25T12:00:00Z',
    }])
    expect(adminInboxCounts(requests, messages)).toEqual({ requests: 2, messages: 1 })
    expect(adminInboxCounts([{ ...requests[0], readAt: '2026-07-25T12:30:00Z' }], messages).requests).toBe(0)
  })

  it('ne broji arhiviranu neotvorenu poruku, ali ne mijenja joj read stanje', () => {
    const [message] = mapAdminMessages([{
      id: 'message-1', client_id: 'client-1', client_first_name: 'TEST',
      client_last_name: 'Klijent', client_phone: '0999302468', sender: 'client',
      subject: 'Pitanje', message: 'Cijeli sadržaj', is_read: false, read_at: null,
      archived_at: '2026-07-25T13:00:00Z', parent_message_id: null,
      created_at: '2026-07-25T12:00:00Z',
    }])
    expect(message.read).toBe(false)
    expect(adminInboxCounts([], [message]).messages).toBe(0)
  })

  it('broji nepročitanu potvrdu termina i ponovno upozorava kad se postojeći zahtjev promijeni', () => {
    const confirmed = { ...requests[0], status: 'confirmed' as const, clientReply: 'Termin je potvrđen.', updatedAt: '2026-07-25T14:00:00Z' }
    expect(adminInboxCounts([confirmed], []).requests).toBe(1)
    const oldVersions = new Map([[confirmed.id, '2026-07-25T13:00:00Z|in_review|']])
    expect(hasNewUnreadAdminRequest([confirmed], oldVersions)).toBe(true)
    expect(hasNewUnreadAdminRequest([confirmed], new Map([[confirmed.id, adminRequestNotificationVersion(confirmed)]]))).toBe(false)
  })
})
