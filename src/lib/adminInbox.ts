export interface AdminRequest {
  id: string
  clientId: string
  clientName: string
  clientPhone: string
  kind: 'appointment' | 'change' | 'cancellation'
  service: string
  preferredDates: string[]
  dayPeriod: 'morning' | 'afternoon' | 'any'
  message: string
  status: 'pending' | 'in_review' | 'confirmed' | 'rejected'
  adminReply: string
  clientReply?: string
  proposedStartsAt?: string
  proposedDurationMinutes?: number
  appointmentId?: string
  readAt?: string
  clientReadAt?: string
  createdAt: string
  updatedAt: string
}

export interface AdminMessage {
  id: string
  clientId: string
  clientName: string
  clientPhone: string
  sender: 'client' | 'admin'
  subject: string
  message: string
  read: boolean
  readAt?: string
  clientReadAt?: string
  archivedAt?: string
  parentMessageId?: string
  createdAt: string
}

interface RequestRow {
  id: string
  client_id: string
  client_first_name: string
  client_last_name: string
  client_phone: string
  kind: AdminRequest['kind']
  service: string | null
  preferred_dates: string[] | null
  day_period: AdminRequest['dayPeriod']
  client_message: string | null
  status: AdminRequest['status']
  admin_reply: string | null
  client_reply?: string | null
  proposed_starts_at?: string | null
  proposed_duration_minutes?: number | null
  appointment_id: string | null
  admin_read_at: string | null
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  client_id: string
  client_first_name: string
  client_last_name: string
  client_phone: string
  sender: AdminMessage['sender']
  subject: string
  message: string
  is_read: boolean
  read_at: string | null
  client_read_at?: string | null
  archived_at: string | null
  parent_message_id: string | null
  created_at: string
}

export function mapAdminRequests(rows: RequestRow[]): AdminRequest[] {
  return rows.map(row => ({
    id: row.id,
    clientId: row.client_id,
    clientName: `${row.client_first_name} ${row.client_last_name}`.trim(),
    clientPhone: row.client_phone,
    kind: row.kind,
    service: row.service ?? '',
    preferredDates: row.preferred_dates ?? [],
    dayPeriod: row.day_period,
    message: row.client_message ?? '',
    status: row.status,
    adminReply: row.admin_reply ?? '',
    clientReply: row.client_reply ?? '',
    proposedStartsAt: row.proposed_starts_at ?? undefined,
    proposedDurationMinutes: row.proposed_duration_minutes ?? undefined,
    appointmentId: row.appointment_id ?? undefined,
    readAt: row.admin_read_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function mapAdminMessages(rows: MessageRow[]): AdminMessage[] {
  return rows.map(row => ({
    id: row.id,
    clientId: row.client_id,
    clientName: `${row.client_first_name} ${row.client_last_name}`.trim(),
    clientPhone: row.client_phone,
    sender: row.sender,
    subject: row.subject,
    message: row.message,
    read: row.is_read,
    readAt: row.read_at ?? undefined,
    clientReadAt: row.client_read_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    parentMessageId: row.parent_message_id ?? undefined,
    createdAt: row.created_at,
  }))
}

export function adminInboxCounts(requests: AdminRequest[], messages: AdminMessage[]) {
  return {
    requests: requests.filter(item => !item.readAt).length,
    messages: messages.filter(item => item.sender === 'client' && !item.read && !item.archivedAt).length,
  }
}

export function adminRequestNotificationVersion(request: AdminRequest) {
  return `${request.updatedAt}|${request.status}|${request.clientReply ?? ''}`
}

export function hasNewUnreadAdminRequest(requests: AdminRequest[], knownVersions: Map<string, string>) {
  return requests.some(request =>
    !request.readAt
    && knownVersions.get(request.id) !== adminRequestNotificationVersion(request),
  )
}

export function requestStatusLabel(status: AdminRequest['status']) {
  return {
    pending: 'Zahtjev poslan',
    in_review: 'Kristina je predložila drugi termin',
    confirmed: 'Termin potvrđen',
    rejected: 'Zahtjev odbijen',
  }[status]
}

export function dayPeriodLabel(period: AdminRequest['dayPeriod']) {
  return {
    morning: 'Prijepodne',
    afternoon: 'Poslijepodne',
    any: 'Svejedno',
  }[period]
}
