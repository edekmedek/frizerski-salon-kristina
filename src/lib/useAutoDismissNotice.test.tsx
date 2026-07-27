import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoDismissNotice } from './useAutoDismissNotice'

describe('useAutoDismissNotice', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('clears a notice after 3000 ms', () => {
    const setNotice = vi.fn()
    renderHook(() => useAutoDismissNotice('Poruka je poslana klijentu.', setNotice))
    vi.advanceTimersByTime(2999)
    expect(setNotice).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('restarts the countdown for a new notice and clears the timer on unmount', () => {
    const setNotice = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ notice }) => useAutoDismissNotice(notice, setNotice),
      { initialProps: { notice: 'Prva obavijest' } },
    )
    vi.advanceTimersByTime(2000)
    rerender({ notice: 'Nova obavijest' })
    vi.advanceTimersByTime(1000)
    expect(setNotice).not.toHaveBeenCalled()
    unmount()
    vi.advanceTimersByTime(3000)
    expect(setNotice).not.toHaveBeenCalled()
  })
})
