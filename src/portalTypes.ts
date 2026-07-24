export type PortalRole = 'administrator' | 'client'
export type RequestStatus = 'novo' | 'u_razgovoru' | 'potvrđeno' | 'odbijeno'
export type RequestKind = 'termin' | 'promjena' | 'otkazivanje'
export type DayPeriod = 'prijepodne' | 'poslijepodne' | 'svejedno'

export interface ClientRequest {
  id: string
  clientId: string
  kind: RequestKind
  service: string
  preferredDates: string[]
  dayPeriod: DayPeriod
  message: string
  status: RequestStatus
  adminReply: string
  appointmentId?: string
  createdAt: string
  updatedAt: string
}

export interface ClientInvitation {
  id: string
  clientId: string
  tokenHash: string
  expiresAt: string
  consumedAt?: string
}

export interface ClientCredential {
  clientId: string
  phoneVerifiedAt: string
  pinSalt?: string
  pinHash?: string
}

export type ReminderKind = 'day_before' | 'hour_before' | 'manual'
export type ReminderStatus = 'scheduled' | 'delivered' | 'cancelled'

export interface ClientNotification {
  id: string
  clientId: string
  appointmentId?: string
  kind: ReminderKind
  title: string
  text: string
  scheduledFor: string
  status: ReminderStatus
  createdAt: string
}

export interface PortalData {
  requests: ClientRequest[]
  invitations: ClientInvitation[]
  credentials: ClientCredential[]
  notifications: ClientNotification[]
}

export interface PortalSession {
  role: PortalRole
  clientId?: string
}
