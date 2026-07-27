export interface BadgeNavigator {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export interface ClientBadgeMessage {
  sender: string
  client_read_at: string | null
}

export interface AdminBadgeMessage {
  sender: string
  read: boolean
  archivedAt?: string
}

export interface AdminBadgeRequest {
  status: string
  readAt?: string
}

export function countClientUnreadMessages(messages: ClientBadgeMessage[]) {
  return messages.filter(message => message.sender === 'admin' && !message.client_read_at).length
}

export function countAdminUnreadItems(messages: AdminBadgeMessage[], requests: AdminBadgeRequest[]) {
  const unreadMessages = messages.filter(message =>
    message.sender === 'client' && !message.read && !message.archivedAt).length
  const unreadRequests = requests.filter(request =>
    (request.status === 'pending' || request.status === 'in_review') && !request.readAt).length
  return unreadMessages + unreadRequests
}

export async function updateAppBadge(unreadCount: number, badgeNavigator: BadgeNavigator = navigator) {
  try {
    if (unreadCount > 0) await badgeNavigator.setAppBadge?.(unreadCount)
    else await badgeNavigator.clearAppBadge?.()
  } catch {
    // Badging is an optional progressive enhancement and must never break the portal.
  }
}
