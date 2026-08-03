import { beforeEach, describe, expect, it, vi } from 'vitest'
import { boilerDeepLink, consumeBoilerResult, readCachedBoilerState } from './boilerApp'

describe('boiler companion bridge', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.useRealTimers()
  })

  it('builds only the supported boiler routes', () => {
    expect(boilerDeepLink('status')).toBe('salonkristina://boiler/status')
    expect(boilerDeepLink('on')).toBe('salonkristina://boiler/on')
    expect(boilerDeepLink('off')).toBe('salonkristina://boiler/off')
  })

  it('consumes and caches a confirmed state', () => {
    window.history.replaceState({}, '', '/?boiler_result=on&boiler_detail=confirmed&boiler_elapsed_ms=950&boiler_clicked=1#/admin')
    expect(consumeBoilerResult()).toEqual({ result: 'on', detail: 'confirmed', elapsedMs: 950, clicked: true })
    expect(readCachedBoilerState()).toBe('on')
    expect(window.location.search).toBe('')
  })

  it('clears a stale confirmed state for unknown results', () => {
    localStorage.setItem('salon-boiler-confirmed-state', JSON.stringify({ state: 'off', confirmedAt: Date.now() }))
    window.history.replaceState({}, '', '/?boiler_result=unknown&boiler_detail=unreadable_state')
    expect(consumeBoilerResult()?.result).toBe('unknown')
    expect(readCachedBoilerState()).toBe('unknown')
  })
})
