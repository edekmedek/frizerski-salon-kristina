import { describe, expect, it } from 'vitest'
import { shouldScrollChat } from './lib/chatScroll'

describe('admin chat scroll behavior', () => {
  it('opens a conversation at its newest message', () => {
    expect(shouldScrollChat({
      conversationChanged: true,
      messageChanged: true,
      force: false,
      nearBottom: false,
    })).toBe(true)
  })

  it('shows a newly sent message even if the previous position was higher', () => {
    expect(shouldScrollChat({
      conversationChanged: false,
      messageChanged: true,
      force: true,
      nearBottom: false,
    })).toBe(true)
  })

  it('preserves the position during refresh while older messages are being read', () => {
    expect(shouldScrollChat({
      conversationChanged: false,
      messageChanged: true,
      force: false,
      nearBottom: false,
    })).toBe(false)
  })

  it('follows a received message when already near the bottom', () => {
    expect(shouldScrollChat({
      conversationChanged: false,
      messageChanged: true,
      force: false,
      nearBottom: true,
    })).toBe(true)
  })
})
