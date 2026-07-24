import type { PortalData, PortalSession } from '../portalTypes'

const PORTAL_KEY = 'frizerski-salon-kristina/portal/v1'
const SESSION_KEY = 'frizerski-salon-kristina/session/v1'

const emptyPortalData: PortalData = {
  requests: [],
  invitations: [],
  credentials: [],
  notifications: [],
}

export function loadPortalData(): PortalData {
  try {
    const parsed = JSON.parse(localStorage.getItem(PORTAL_KEY) || '{}') as Partial<PortalData>
    return {
      requests: parsed.requests ?? [],
      invitations: parsed.invitations ?? [],
      credentials: parsed.credentials ?? [],
      notifications: parsed.notifications ?? [],
    }
  } catch {
    return structuredClone(emptyPortalData)
  }
}

export function savePortalData(data: PortalData) {
  localStorage.setItem(PORTAL_KEY, JSON.stringify(data))
  window.dispatchEvent(new CustomEvent('salon-portal-updated'))
}

export function getPortalSession(): PortalSession | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') as PortalSession | null
  } catch {
    return null
  }
}

export function setPortalSession(session: PortalSession | null) {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else sessionStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new CustomEvent('salon-session-updated'))
}
