import { describe, expect, it, vi } from 'vitest'
import {
  openSalonDoorCompanion,
  SALON_COMPANION_DOOR_LINK,
} from './tapoApp'

describe('Salon Companion launcher', () => {
  it('opens the Companion door deep link directly', () => {
    const navigate = vi.fn()
    const onUnavailable = vi.fn()
    openSalonDoorCompanion({
      navigate,
      onUnavailable,
      document: { hidden: true, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      setTimeout: vi.fn(),
    })
    expect(navigate).toHaveBeenCalledWith(SALON_COMPANION_DOOR_LINK)
    expect(SALON_COMPANION_DOOR_LINK).toBe('salonkristina://door/live')
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('shows the fallback when the deep link does not leave the PWA', () => {
    const onUnavailable = vi.fn()
    let fallback: (() => void) | undefined
    openSalonDoorCompanion({
      navigate: vi.fn(),
      onUnavailable,
      document: { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      setTimeout: callback => {
        fallback = callback
        return 1
      },
    })
    fallback?.()
    expect(onUnavailable).toHaveBeenCalledOnce()
  })

  it('shows the fallback when navigation is rejected', () => {
    const onUnavailable = vi.fn()
    openSalonDoorCompanion({
      navigate: () => { throw new Error('unsupported scheme') },
      onUnavailable,
    })
    expect(onUnavailable).toHaveBeenCalledOnce()
  })
})
