import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetSupabaseTrafficGuardForTests, startSupabaseRefreshLoop, trackSupabaseCall } from './supabaseTrafficGuard'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  resetSupabaseTrafficGuardForTests()
})

describe('supabaseTrafficGuard', () => {
  it('warns in development for excessive endpoint frequency', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (let index = 0; index < 121; index += 1) {
      trackSupabaseCall('client.refresh', 0)
    }
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('refresh loop skips hidden state and runs when visible', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn().mockResolvedValue(true)
    const documentTarget = new EventTarget() as EventTarget & {
      visibilityState: DocumentVisibilityState
      addEventListener: Document['addEventListener']
      removeEventListener: Document['removeEventListener']
    }
    Object.defineProperty(documentTarget, 'visibilityState', { value: 'hidden', writable: true })

    const stop = startSupabaseRefreshLoop({
      label: 'client.loop',
      refresh,
      baseIntervalMs: 100,
      hiddenIntervalMs: 1_000,
      documentTarget,
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(refresh).toHaveBeenCalledTimes(0)

    documentTarget.visibilityState = 'visible'
    documentTarget.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(refresh).toHaveBeenCalledTimes(1)
    stop()
  })

  it('uses exponential backoff after failures', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const documentTarget = new EventTarget() as EventTarget & {
      visibilityState: DocumentVisibilityState
      addEventListener: Document['addEventListener']
      removeEventListener: Document['removeEventListener']
    }
    Object.defineProperty(documentTarget, 'visibilityState', { value: 'visible', writable: true })

    const stop = startSupabaseRefreshLoop({
      label: 'admin.loop',
      refresh,
      baseIntervalMs: 100,
      maxBackoffMs: 1_000,
      documentTarget,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(200)
    expect(refresh).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(400)
    expect(refresh).toHaveBeenCalledTimes(3)
    stop()
  })
})
