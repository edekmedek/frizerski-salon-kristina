import { useEffect, useState } from 'react'
import AdminApp from './AdminApp'
import { ClientPortal } from './ClientPortal'
import { AccessScreen } from './AccessScreen'
import type { PortalSession } from './portalTypes'
import { getPortalSession, setPortalSession } from './lib/portalStorage'

function App() {
  const [session, setSession] = useState<PortalSession | null>(() => getPortalSession())

  useEffect(() => {
    const refresh = () => setSession(getPortalSession())
    window.addEventListener('salon-session-updated', refresh)
    window.addEventListener('hashchange', refresh)
    return () => {
      window.removeEventListener('salon-session-updated', refresh)
      window.removeEventListener('hashchange', refresh)
    }
  }, [])

  function logout() {
    setPortalSession(null)
    window.location.hash = '/'
  }

  if (session?.role === 'administrator') return <AdminApp onLogout={logout} />
  if (session?.role === 'client' && session.clientId) {
    return <ClientPortal clientId={session.clientId} onLogout={logout} />
  }
  return <AccessScreen />
}

export default App
