import { describe, expect, it, vi } from 'vitest'
import {
  countAdminUnreadItems,
  countClientUnreadMessages,
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
})
