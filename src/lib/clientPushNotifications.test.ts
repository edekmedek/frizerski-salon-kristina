import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_MESSAGE_NOTIFICATION_TAG,
  closeReadClientMessageNotifications,
} from './clientPush'

describe('client message system notifications', () => {
  it('asks the service worker to close only salon message notifications', async () => {
    const postMessage = vi.fn()
    await closeReadClientMessageNotifications({
      ready: Promise.resolve({ active: { postMessage } }),
    })
    expect(postMessage).toHaveBeenCalledWith({
      type: 'CLIENT_MESSAGES_READ',
      tag: CLIENT_MESSAGE_NOTIFICATION_TAG,
    })
  })

  it('continues safely without a service worker notification API', async () => {
    await expect(closeReadClientMessageNotifications(undefined)).resolves.toBeUndefined()
    await expect(closeReadClientMessageNotifications({
      ready: Promise.resolve({ active: null }),
    })).resolves.toBeUndefined()
  })
})
