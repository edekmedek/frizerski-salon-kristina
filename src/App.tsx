import { useEffect, useState } from 'react'
import AdminApp from './AdminApp'
import { ClientPortal } from './ClientPortal'
import { AccessScreen } from './AccessScreen'
import type { PortalSession } from './portalTypes'
import { getPortalSession, setPortalSession } from './lib/portalStorage'
import { useKeyboardViewport } from './lib/useKeyboardViewport'
import { supabase } from './lib/supabase'
import { updateAppBadge } from './lib/appBadge'
import './KeyboardViewport.css'

function App() {
  useKeyboardViewport()
  const [session, setSession] = useState<PortalSession | null>(() => getPortalSession())
  const [restoringSession, setRestoringSession] = useState(true)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}push-sw.js`)
    }
  }, [])

  useEffect(() => {
    if (!restoringSession && !session) void updateAppBadge(0)
  }, [restoringSession, session])

  useEffect(() => {
    const refresh = () => setSession(getPortalSession())
    async function restoreSupabaseSession() {
      if (!supabase) { setRestoringSession(false); return }
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user
      if (!user) {
        setPortalSession(null)
        setRestoringSession(false)
        return
      }
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      if (role?.role === 'admin') {
        setPortalSession({ role: 'administrator' })
        setRestoringSession(false)
        return
      }
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()
      setPortalSession(client?.id ? { role: 'client', clientId: client.id } : null)
      setRestoringSession(false)
    }
    window.addEventListener('salon-session-updated', refresh)
    window.addEventListener('hashchange', refresh)
    void restoreSupabaseSession()
    return () => {
      window.removeEventListener('salon-session-updated', refresh)
      window.removeEventListener('hashchange', refresh)
    }
  }, [])

  async function logout() {
    await supabase?.auth.signOut()
    await updateAppBadge(0)
    setPortalSession(null)
    window.location.hash = '/'
  }

  if (restoringSession) {
    return <main className="access-page"><section className="access-card"><h1>Učitavanje…</h1></section></main>
  }
  if (session?.role === 'administrator') return <AdminApp onLogout={() => void logout()} />
  if (session?.role === 'client' && session.clientId) {
    return <ClientPortal clientId={session.clientId} onLogout={() => void logout()} />
  }
  return <AccessScreen />
}

export default App
