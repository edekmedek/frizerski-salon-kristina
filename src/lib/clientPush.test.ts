import { describe, expect, it } from 'vitest'
import {
  CLIENT_MESSAGES_HASH,
  CLIENT_NOTIFICATIONS_HASH,
  isClientNotificationsLocation,
  isClientMessagesLocation,
  parseClientPushResult,
  savedMessagePushNotice,
} from './clientPush'

describe('client push result', () => {
  it('recognizes a successfully sent notification', () => {
    const outcome = parseClientPushResult({ subscriptionsFound: 1, sent: 1, failed: 0 })
    expect(outcome.status).toBe('sent')
    expect(savedMessagePushNotice(outcome)).toContain('push obavijest je poslana')
  })

  it('reports sent: 0 as a missing active subscription', () => {
    const outcome = parseClientPushResult({ subscriptionsFound: 0, sent: 0, failed: 0 })
    expect(outcome.status).toBe('no-subscription')
    expect(savedMessagePushNotice(outcome)).toContain('nema aktivne obavijesti')
  })

  it('reports an Edge Function error without losing the saved-message status', () => {
    const outcome = parseClientPushResult(null, true)
    expect(outcome.status).toBe('failed')
    expect(savedMessagePushNotice(outcome)).toBe('Poruka je spremljena, ali push obavijest nije poslana.')
  })

  it('uses the direct client messages target', () => {
    expect(CLIENT_MESSAGES_HASH).toBe('#/client/messages')
    expect(isClientMessagesLocation('#/client/messages')).toBe(true)
    expect(isClientMessagesLocation('#/client/appointments')).toBe(false)
  })

  it('uses a direct notification-check target', () => {
    expect(CLIENT_NOTIFICATIONS_HASH).toBe('#/client/notifications')
    expect(isClientNotificationsLocation(CLIENT_NOTIFICATIONS_HASH)).toBe(true)
  })
})
