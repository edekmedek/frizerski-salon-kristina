import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync('src/App.tsx', 'utf8')
const clientPortalSource = readFileSync('src/ClientPortal.tsx', 'utf8')
const pushSource = readFileSync('src/lib/clientPush.ts', 'utf8')
const workerSource = readFileSync('public/push-sw.js', 'utf8')

describe('mobile PWA authentication bootstrap', () => {
  it('waits for Supabase session restoration and observes auth lifecycle events', () => {
    expect(appSource).toContain("event === 'INITIAL_SESSION'")
    expect(appSource).toContain("event === 'TOKEN_REFRESHED'")
    expect(appSource).toContain('supabaseClient.auth.getSession()')
    expect(appSource).toContain('requestId !== authRequestRef.current')
    expect(appSource).not.toContain(
      'useState<PortalSession | null>(() => getPortalSession())',
    )
  })

  it('distinguishes a missing client link from a failed portal data request', () => {
    expect(appSource).toContain(
      'Prijavljeni račun nije povezan s klijentskim portalom.',
    )
    expect(clientPortalSource).toContain(
      "'Pristup nije dopušten':'Portal trenutačno nije moguće učitati'",
    )
    expect(clientPortalSource).toContain(
      "console.error('[client-portal] portal data load failed'",
    )
  })

  it('forces the current worker script without a service-worker response cache', () => {
    expect(pushSource).toContain('push-sw.js?v=3')
    expect(pushSource).toContain("updateViaCache: 'none'")
    expect(workerSource).not.toContain("addEventListener('fetch'")
    expect(workerSource).toContain('self.skipWaiting()')
    expect(workerSource).toContain('self.clients.claim()')
  })
})
