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
})
