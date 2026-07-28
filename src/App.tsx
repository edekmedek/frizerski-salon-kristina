import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import AdminApp from './AdminApp'
import { ClientPortal } from './ClientPortal'
import { AccessScreen } from './AccessScreen'
import type { PortalSession } from './portalTypes'
import { setPortalSession } from './lib/portalStorage'
import { useKeyboardViewport } from './lib/useKeyboardViewport'
import { supabase } from './lib/supabase'
import { updateAppBadge } from './lib/appBadge'
import { registerSalonPushWorker } from './lib/clientPush'
import './KeyboardViewport.css'

function App() {
  useKeyboardViewport()
  const [session, setSession] = useState<PortalSession | null>(null)
  const [restoringSession, setRestoringSession] = useState(true)
  const [accessIssue, setAccessIssue] = useState('')
  const authRequestRef = useRef(0)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void registerSalonPushWorker()
    }
  }, [])

  useEffect(() => {
    if (!restoringSession && !session) void updateAppBadge(0)
  }, [restoringSession, session])

  useEffect(() => {
    if (!supabase) {
      queueMicrotask(() => setRestoringSession(false))
      return
    }
    const supabaseClient = supabase
    let active = true

    async function restoreSupabaseSession(authSession: Session | null, source: string) {
      const requestId = ++authRequestRef.current
      const user = authSession?.user
      console.info('[auth]', source, {
        event: source,
        hasSession: Boolean(authSession),
        userId: user?.id ?? null,
      })
      if (!user) {
        if (!active || requestId !== authRequestRef.current) return
        setPortalSession(null, false)
        setSession(null)
        setAccessIssue('')
        setRestoringSession(false)
        return
      }
      const roleResult = await supabaseClient
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      console.info('[auth] administrator role lookup', {
        userId: user.id,
        found: Boolean(roleResult.data),
        status: roleResult.status,
      })
      if (roleResult.error) {
        console.error('[auth] administrator role lookup failed', roleResult.error)
      }
      if (!roleResult.error && roleResult.data?.role === 'admin') {
        if (!active || requestId !== authRequestRef.current) return
        setPortalSession({ role: 'administrator' }, false)
        setSession({ role: 'administrator' })
        setAccessIssue('')
        setRestoringSession(false)
        return
      }
      const clientResult = await supabaseClient
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()
      console.info('[auth] client account lookup', {
        userId: user.id,
        found: Boolean(clientResult.data?.id),
        status: clientResult.status,
      })
      if (clientResult.error) {
        console.error('[auth] client account lookup failed', clientResult.error)
      }
      if (!active || requestId !== authRequestRef.current) return
      if (clientResult.error) {
        setSession(null)
        setAccessIssue(`Prijava je obnovljena, ali ovlasti nije moguće provjeriti (${clientResult.error.message}).`)
      } else if (clientResult.data?.id) {
        const nextSession: PortalSession = { role: 'client', clientId: clientResult.data.id }
        setPortalSession(nextSession, false)
        setSession(nextSession)
        setAccessIssue('')
      } else {
        setPortalSession(null, false)
        setSession(null)
        setAccessIssue('Prijavljeni račun nije povezan s klijentskim portalom.')
      }
      setRestoringSession(false)
    }

    const { data: authListener } = supabaseClient.auth.onAuthStateChange((event, authSession) => {
      console.info('[auth] state change', {
        event,
        hasSession: Boolean(authSession),
        userId: authSession?.user.id ?? null,
      })
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
        window.setTimeout(() => void restoreSupabaseSession(authSession, event), 0)
      }
    })

    const refresh = () => {
      setRestoringSession(true)
      void supabaseClient.auth.getSession().then(({ data, error }) => {
        if (error) {
          console.error('[auth] getSession failed', error)
          if (active) {
            setAccessIssue(`Spremljenu prijavu nije moguće obnoviti (${error.message}).`)
            setRestoringSession(false)
          }
          return
        }
        void restoreSupabaseSession(data.session, 'SESSION_UPDATED')
      })
    }
    window.addEventListener('salon-session-updated', refresh)
    void supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('[auth] initial getSession failed', error)
        if (active) {
          setAccessIssue(`Spremljenu prijavu nije moguće obnoviti (${error.message}).`)
          setRestoringSession(false)
        }
        return
      }
      void restoreSupabaseSession(data.session, 'GET_SESSION')
    })
    return () => {
      active = false
      window.removeEventListener('salon-session-updated', refresh)
      authListener.subscription.unsubscribe()
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
  if (accessIssue) {
    return <main className="access-page"><section className="access-card"><h1>Prijavu nije moguće potvrditi</h1><p>{accessIssue}</p><button className="primary" onClick={()=>window.location.reload()}>Pokušaj ponovno</button><button className="link" onClick={()=>void logout()}>Odjava</button></section></main>
  }
  if (session?.role === 'administrator') return <AdminApp onLogout={() => void logout()} />
  if (session?.role === 'client' && session.clientId) {
    return <ClientPortal clientId={session.clientId} onLogout={() => void logout()} />
  }
  return <AccessScreen />
}

export default App
