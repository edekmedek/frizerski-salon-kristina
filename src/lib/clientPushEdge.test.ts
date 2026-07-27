import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const edgeSource = readFileSync('supabase/functions/send-web-push/index.ts', 'utf8')
const workerSource = readFileSync('public/push-sw.js', 'utf8')

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

  it('returns the complete production CORS contract', () => {
    expect(edgeSource).toContain("'Access-Control-Allow-Origin': 'https://frizerskisalonkristina.hr'")
    expect(edgeSource).toContain("'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'")
    expect(edgeSource).toContain("'Access-Control-Allow-Methods': 'POST, OPTIONS'")
    expect(edgeSource).toContain("new Response(null, { status: 204, headers: corsHeaders })")
    expect(edgeSource.split("headers: { ...corsHeaders, 'Content-Type': 'application/json' }")).toHaveLength(3)
  })
})
