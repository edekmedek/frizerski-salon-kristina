import type { Appointment, Client } from '../types'
import type { ClientNotification } from '../portalTypes'

export interface ReminderProvider {
  deliver(notification: ClientNotification): Promise<ClientNotification>
}

export class DemoReminderProvider implements ReminderProvider {
  async deliver(notification: ClientNotification) {
    return { ...notification, status: 'delivered' as const }
  }
}

export function remindersForAppointment(
  appointment: Appointment,
  client: Client | undefined,
): ClientNotification[] {
  if (!client || appointment.status !== 'zakazan') return []
  const startsAt = new Date(appointment.dateTime).getTime()
  const now = new Date().toISOString()
  const base = {
    clientId: client.id,
    appointmentId: appointment.id,
    status: 'scheduled' as const,
    createdAt: now,
  }
  return [
    {
      ...base,
      id: crypto.randomUUID(),
      kind: 'day_before',
      title: 'Podsjetnik za termin sutra',
      text: `${appointment.service} sutra u ${appointment.dateTime.slice(11, 16)}.`,
      scheduledFor: new Date(startsAt - 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      ...base,
      id: crypto.randomUUID(),
      kind: 'hour_before',
      title: 'Termin počinje za jedan sat',
      text: `${appointment.service} u ${appointment.dateTime.slice(11, 16)}.`,
      scheduledFor: new Date(startsAt - 60 * 60 * 1000).toISOString(),
    },
  ]
}

export function replaceAppointmentReminders(
  notifications: ClientNotification[],
  appointment: Appointment,
  client: Client | undefined,
) {
  const withoutOld = notifications.filter(
    (item) => item.appointmentId !== appointment.id || item.kind === 'manual',
  )
  return [...withoutOld, ...remindersForAppointment(appointment, client)]
}

export async function runDueDemoReminders(
  notifications: ClientNotification[],
  provider: ReminderProvider,
  now = Date.now(),
) {
  return Promise.all(
    notifications.map((item) =>
      item.status === 'scheduled' && new Date(item.scheduledFor).getTime() <= now
        ? provider.deliver(item)
        : item,
    ),
  )
}
