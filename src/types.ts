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
  serviceId?: string
  serviceCategoryId?: string
  servicePrice?: number
  serviceDuration?: number
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
  visibleToClient?: boolean
}

export interface Service {
  id: string
  sourceCode?: number
  name: string
  categoryId: string
  categoryName: string
  price: number
  durationMinutes?: number
  isActive: boolean
  isBookable: boolean
  displayOrder: number
}

export interface ServiceCategory {
  id: string
  code?: string
  name: string
  isActive: boolean
  displayOrder: number
}

export interface SalonData {
  clients: Client[]
  appointments: Appointment[]
  messages: ClientMessage[]
  hairstyles: HairstyleArchiveEntry[]
}
