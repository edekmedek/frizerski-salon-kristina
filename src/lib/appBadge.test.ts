import { describe, expect, it, vi } from 'vitest'
import {
  countAdminUnreadItems,
  countClientUnreadMessages,
  subscribeToAppForeground,
  updateAppBadge,
} from './appBadge'

describe('app badge', () => {
  it('increases the client count when a new salon message arrives', () => {
    const existing = [{ sender: 'admin', client_read_at: '2026-07-27T08:00:00Z' }]
    expect(countClientUnreadMessages(existing)).toBe(0)
    expect(countClientUnreadMessages([
      ...existing,
      { sender: 'admin', client_read_at: null },
    ])).toBe(1)
  })

  it('decreases the client count after the message is read', () => {
    expect(countClientUnreadMessages([
      { sender: 'admin', client_read_at: null },
      { sender: 'client', client_read_at: null },
    ])).toBe(1)
    expect(countClientUnreadMessages([
      { sender: 'admin', client_read_at: '2026-07-27T09:00:00Z' },
      { sender: 'client', client_read_at: null },
    ])).toBe(0)
  })

  it('clears the badge when the count reaches zero', async () => {
    const clearAppBadge = vi.fn().mockResolvedValue(undefined)
    await updateAppBadge(0, { clearAppBadge })
    expect(clearAppBadge).toHaveBeenCalledOnce()
  })

  it('does nothing safely when Badging API is unsupported', async () => {
    await expect(updateAppBadge(3, {})).resolves.toBeUndefined()
  })

  it('counts client and administrator unread state separately', () => {
    const clientCount = countClientUnreadMessages([
      { sender: 'admin', client_read_at: null },
      { sender: 'client', client_read_at: null },
    ])
    const adminCount = countAdminUnreadItems(
      [
        { sender: 'client', read: false },
        { sender: 'admin', read: false },
      ],
      [
        { status: 'pending' },
        { status: 'confirmed' },
      ],
    )
    expect(clientCount).toBe(1)
    expect(adminCount).toBe(2)
  })

  it('sets the current unread number', async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined)
    await updateAppBadge(4, { setAppBadge })
    expect(setAppBadge).toHaveBeenCalledWith(4)
  })

  it('keeps the exact remaining count when only some messages are read', async () => {
    const messages = [
      { sender: 'admin', client_read_at: '2026-07-27T09:00:00Z' },
      { sender: 'admin', client_read_at: null },
      { sender: 'client', client_read_at: null },
    ]
    const setAppBadge = vi.fn().mockResolvedValue(undefined)
    const unreadCount = countClientUnreadMessages(messages)
    await updateAppBadge(unreadCount, { setAppBadge })
    expect(unreadCount).toBe(1)
    expect(setAppBadge).toHaveBeenCalledWith(1)
  })

  it('refreshes badge state when the app returns to the foreground', () => {
    const refresh = vi.fn()
    const windowTarget = new EventTarget()
    const documentTarget = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState }
    Object.defineProperty(documentTarget, 'visibilityState', { value: 'visible', configurable: true })
    const unsubscribe = subscribeToAppForeground(
      refresh,
      windowTarget as unknown as Window,
      documentTarget as unknown as Document,
    )

    windowTarget.dispatchEvent(new Event('focus'))
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)

    unsubscribe()
    windowTarget.dispatchEvent(new Event('focus'))
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
