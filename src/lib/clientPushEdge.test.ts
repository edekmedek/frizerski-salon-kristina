import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const edgeSource = readFileSync('supabase/functions/send-web-push/index.ts', 'utf8')
const workerSource = readFileSync('public/push-sw.js', 'utf8')
const subscriptionMigrationSource = readFileSync(
  'supabase/migrations/20260729_web_push_subscriptions.sql',
  'utf8',
)

describe('send-web-push payload', () => {
  it('contains only the neutral client-facing message', () => {
    expect(edgeSource).toContain('Imate novu poruku iz Salona Kristina.')
    expect(edgeSource).not.toContain('body,')
  })

  it('opens the production client messages route', () => {
    expect(edgeSource).toContain('https://frizerskisalonkristina.hr/#/client/messages')
    expect(workerSource).toContain("'./#/client/messages'")
  })

  it('returns structured delivery counters', () => {
    expect(edgeSource).toContain('subscriptionsFound')
    expect(edgeSource).toContain('failed')
  })

  it('sends only to the newest subscription for a client', () => {
    expect(edgeSource).toContain(".order('updated_at', { ascending: false })")
    expect(edgeSource).toContain('.limit(1)')
  })

  it('removes only older subscriptions owned by the authenticated client', () => {
    expect(edgeSource).toContain("requestBody.action === 'deduplicate-client-subscriptions'")
    expect(edgeSource).toContain(".eq('user_id', userData.user.id)")
    expect(edgeSource).toContain(".eq('client_id', ownClient.id)")
    expect(edgeSource).toContain('const staleIds = (ownSubscriptions ?? []).slice(1)')
  })

  it('offers an authenticated client test push without changing message delivery', () => {
    expect(edgeSource).toContain("requestBody.action === 'test-client-push'")
    expect(edgeSource).toContain('Probna obavijest uspješno je uključena.')
    expect(edgeSource).toContain("notificationType: 'notification-test'")
    expect(edgeSource).toContain("tag: 'salon-kristina-notification-test'")
  })

  it('prevents duplicate rows for the same push endpoint', () => {
    expect(subscriptionMigrationSource).toContain('endpoint text not null unique')
    expect(subscriptionMigrationSource).toContain('on conflict (endpoint) do update')
  })

  it('uses one stable tag for the client message conversation', () => {
    expect(edgeSource).toContain("tag ?? 'salon-kristina-message'")
    expect(workerSource).toContain("tag: payload.tag ?? 'salon-kristina-message'")
  })

  it('closes only salon message notifications after confirmed reading', () => {
    expect(workerSource).toContain("event.data?.type !== 'CLIENT_MESSAGES_READ'")
    expect(workerSource).toContain("notification.tag === 'salon-kristina-message'")
    expect(workerSource).toContain("notification.data?.notificationType === 'client-message'")
    expect(workerSource).toContain('notification.close()')
    expect(workerSource).toContain('self.registration.clearAppBadge')
  })

  it('returns the complete production CORS contract', () => {
    expect(edgeSource).toContain("'Access-Control-Allow-Origin': 'https://frizerskisalonkristina.hr'")
    expect(edgeSource).toContain("'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'")
    expect(edgeSource).toContain("'Access-Control-Allow-Methods': 'POST, OPTIONS'")
    expect(edgeSource).toContain("new Response(null, { status: 204, headers: corsHeaders })")
    expect(edgeSource.split("headers: { ...corsHeaders, 'Content-Type': 'application/json' }")).toHaveLength(7)
  })
})
