import { describe, expect, it } from 'vitest'
import {
  detectNotificationPlatform,
  getLastSuccessfulPushTest,
  saveLastSuccessfulPushTest,
} from './notificationSetup'

describe('guided notification setup', () => {
  it('recognizes Samsung Android and installed PWA mode', () => {
    expect(detectNotificationPlatform({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S921B)',
      standalone: true,
    })).toEqual({ android: true, samsung: true, ios: false, installed: true })
  })

  it('recognizes iPhone browser mode', () => {
    expect(detectNotificationPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      standalone: false,
    })).toEqual({ android: false, samsung: false, ios: true, installed: false })
  })

  it('stores only the local timestamp of a successful device test', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    saveLastSuccessfulPushTest('2026-07-27T15:00:00.000Z', storage)
    expect(getLastSuccessfulPushTest(storage)).toBe('2026-07-27T15:00:00.000Z')
  })
})
