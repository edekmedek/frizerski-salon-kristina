import { describe, expect, it } from 'vitest'
import type { Appointment, Client } from '../types'
import type { ClientNotification } from '../portalTypes'
import {
  remindersForAppointment,
  replaceAppointmentReminders,
  runDueDemoReminders,
  type ReminderProvider,
} from './reminders'

const client: Client = {
  id: 'c1', firstName: 'Ana', lastName: 'Kovač', phone: '0911111111',
  note: '', createdAt: '2026-01-01', updatedAt: '2026-01-01',
}

const appointment: Appointment = {
  id: 'a1', clientId: 'c1', dateTime: '2026-08-20T10:00:00',
  service: 'Feniranje', status: 'zakazan', note: '', assignedBy: 'Kristina',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
}

describe('portal reminders', () => {
  it('izrađuje podsjetnik dan i sat prije potvrđenog termina', () => {
    const reminders = remindersForAppointment(appointment, client)
    expect(reminders.map((item) => item.kind)).toEqual(['day_before', 'hour_before'])
    expect(reminders.every((item) => item.clientId === 'c1')).toBe(true)
  })

  it('uklanja stare podsjetnike nakon promjene termina i izrađuje nove', () => {
    const old = remindersForAppointment(appointment, client)
    const changed = { ...appointment, dateTime: '2026-08-22T12:00:00' }
    const next = replaceAppointmentReminders(old, changed, client)
    expect(next).toHaveLength(2)
    expect(next.every((item) => item.scheduledFor.includes('2026-08'))).toBe(true)
    expect(next.map((item) => item.id)).not.toEqual(old.map((item) => item.id))
  })

  it('ne izrađuje podsjetnike za otkazan termin', () => {
    const cancelled = { ...appointment, status: 'otkazan' as const }
    expect(replaceAppointmentReminders([], cancelled, client)).toEqual([])
  })

  it('demo provider izvršava samo dospjele podsjetnike', async () => {
    const notification: ClientNotification = {
      id: 'n1', clientId: 'c1', appointmentId: 'a1', kind: 'manual',
      title: 'Poruka', text: 'Test', scheduledFor: '2026-01-01T10:00:00Z',
      status: 'scheduled', createdAt: '2026-01-01',
    }
    const provider: ReminderProvider = {
      deliver: async (item) => ({ ...item, status: 'delivered' }),
    }
    const result = await runDueDemoReminders([notification], provider, Date.parse('2026-01-02'))
    expect(result[0].status).toBe('delivered')
  })
})
