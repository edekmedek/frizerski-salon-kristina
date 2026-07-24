export type AppointmentStatus = 'zakazan' | 'otkazan'

export interface ImageAsset {
  full: string
  thumb: string
  storagePath?: string
}

export interface Client {
  id: string
  firstName: string
  lastName: string
  phone: string
  photo?: ImageAsset
  note: string
  createdAt: string
  updatedAt: string
}

export interface Appointment {
  id: string
  clientId: string
  dateTime: string
  service: string
  status: AppointmentStatus
  note: string
  assignedBy: 'Kristina'
  createdAt: string
  updatedAt: string
}

export interface ClientMessage {
  id: string
  clientId: string
  senderName: string
  senderPhone: string
  text: string
  createdAt: string
  read: boolean
}

export interface HairstyleArchiveEntry {
  id: string
  clientId: string
  date: string
  before: ImageAsset
  after?: ImageAsset
  note: string
  createdAt: string
}

export interface SalonData {
  clients: Client[]
  appointments: Appointment[]
  messages: ClientMessage[]
  hairstyles: HairstyleArchiveEntry[]
}
