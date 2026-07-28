import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_MESSAGE_NOTIFICATION_TAG,
  closeReadClientMessageNotifications,
  registerSalonPushWorker,
} from './clientPush'

describe('client message system notifications', () => {
  it('closes salon notifications through the registration without a controller', async () => {
    const postMessage = vi.fn()
    const salonNotification = { tag: CLIENT_MESSAGE_NOTIFICATION_TAG, close: vi.fn() }
    const unrelatedNotification = { tag: 'other-app-event', close: vi.fn() }
    const clearAppBadge = vi.fn().mockResolvedValue(undefined)
    await closeReadClientMessageNotifications({
      ready: Promise.resolve({
        active: { postMessage },
        getNotifications: vi.fn().mockResolvedValue([salonNotification, unrelatedNotification]),
        clearAppBadge,
      }),
    })
    expect(salonNotification.close).toHaveBeenCalledOnce()
    expect(unrelatedNotification.close).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledWith({
      type: 'CLIENT_MESSAGES_READ',
      tag: CLIENT_MESSAGE_NOTIFICATION_TAG,
    })
    expect(clearAppBadge).toHaveBeenCalledOnce()
  })

  it('still closes through the registration when no active worker is available', async () => {
    const salonNotification = {
      tag: '',
      data: { salonKristina: true, notificationType: 'client-message' },
      close: vi.fn(),
    }
    await closeReadClientMessageNotifications({
      ready: Promise.resolve({
        active: null,
        getNotifications: vi.fn().mockResolvedValue([salonNotification]),
      }),
    })
    expect(salonNotification.close).toHaveBeenCalledOnce()
  })

  it('continues safely without a service worker notification API', async () => {
    await expect(closeReadClientMessageNotifications(undefined)).resolves.toBeUndefined()
    await expect(closeReadClientMessageNotifications({
      ready: Promise.resolve({ active: null }),
    })).resolves.toBeUndefined()
  })

  it('forces a fresh service-worker check without relying on HTTP cache', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const registration = { active: null, update }
    const register = vi.fn().mockResolvedValue(registration)
    await registerSalonPushWorker({
      register,
      ready: Promise.resolve(registration),
    })
    expect(register).toHaveBeenCalledWith(
      expect.stringContaining('push-sw.js?v=3'),
      { updateViaCache: 'none' },
    )
    expect(update).toHaveBeenCalledOnce()
  })
})
