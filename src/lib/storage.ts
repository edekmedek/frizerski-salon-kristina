import type {
  Appointment,
  Client,
  ClientMessage,
  HairstyleArchiveEntry,
  SalonData,
} from '../types'
import { seededData } from './sampleData'

const STORAGE_KEY = 'frizerski-salon-kristina/v1'

function copyData(data: SalonData): SalonData {
  return {
    clients: structuredClone(data.clients),
    appointments: structuredClone(data.appointments),
    messages: structuredClone(data.messages),
    hairstyles: structuredClone(data.hairstyles),
  }
}

export function loadSalonData(): SalonData {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const initial = copyData(seededData)
    saveSalonData(initial)
    return initial
  }

  try {
    const parsed = JSON.parse(raw) as SalonData
    if (!parsed.clients || !parsed.appointments || !parsed.messages || !parsed.hairstyles) {
      throw new Error('Neispravan format lokalnih podataka.')
    }
    return parsed
  } catch {
    const fallback = copyData(seededData)
    saveSalonData(fallback)
    return fallback
  }
}

export function saveSalonData(data: SalonData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}

export function findClientName(clients: Client[], clientId: string): string {
  const client = clients.find((item) => item.id === clientId)
  if (!client) {
    return 'Nepoznat klijent'
  }
  return `${client.firstName} ${client.lastName}`
}

export function upsertClient(clients: Client[], client: Client): Client[] {
  const exists = clients.some((item) => item.id === client.id)
  if (!exists) {
    return [client, ...clients]
  }

  return clients.map((item) => (item.id === client.id ? client : item))
}

export function upsertAppointment(appointments: Appointment[], appointment: Appointment): Appointment[] {
  const exists = appointments.some((item) => item.id === appointment.id)
  if (!exists) {
    return [appointment, ...appointments]
  }

  return appointments.map((item) => (item.id === appointment.id ? appointment : item))
}

export function markMessageRead(messages: ClientMessage[], messageId: string): ClientMessage[] {
  return messages.map((message) =>
    message.id === messageId ? { ...message, read: true } : message,
  )
}

export function addHairstyle(
  styles: HairstyleArchiveEntry[],
  entry: HairstyleArchiveEntry,
): HairstyleArchiveEntry[] {
  return [entry, ...styles]
}
