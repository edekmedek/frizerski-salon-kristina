import { describe, expect, it, vi } from 'vitest'
import { openTapoAndroidApp, TAPO_ANDROID_INTENT } from './tapoApp'

describe('Tapo Android launcher', () => {
  it('opens only the Tapo package through an Android intent', () => {
    const navigate = vi.fn()
    const onUnavailable = vi.fn()
    openTapoAndroidApp({
      userAgent: 'Android',
      standalone: false,
      navigate,
      onUnavailable,
      document: { hidden: true, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      setTimeout: vi.fn(),
    })
    expect(navigate).toHaveBeenCalledWith(TAPO_ANDROID_INTENT)
    expect(TAPO_ANDROID_INTENT).toBe('intent://#Intent;package=com.tplink.iot;end')
  })

  it('shows the fallback instead of navigating from an installed PWA', () => {
    const navigate = vi.fn()
    const onUnavailable = vi.fn()
    openTapoAndroidApp({ userAgent: 'Android', standalone: true, navigate, onUnavailable })
    expect(navigate).not.toHaveBeenCalled()
    expect(onUnavailable).toHaveBeenCalledOnce()
  })

  it('shows the fallback on non-Android devices', () => {
    const onUnavailable = vi.fn()
    openTapoAndroidApp({ userAgent: 'iPhone', standalone: false, onUnavailable })
    expect(onUnavailable).toHaveBeenCalledOnce()
  })
})
