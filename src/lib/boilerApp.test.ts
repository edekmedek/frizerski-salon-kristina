import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BOILER_AUTO_COOLDOWN_MS, boilerDeepLink, boilerIntentLink, claimAutomaticBoilerStatus, consumeAutomaticBoilerRetry, consumeBoilerResult, consumeBoilerResumeSignal, readCachedBoilerState, supportsAutomaticBoilerStatus } from './boilerApp'

describe('boiler companion bridge', () => {
  beforeEach(() => sessionStorage.clear())
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

  it('enables lifecycle status checks only on Android', () => {
    expect(supportsAutomaticBoilerStatus('Mozilla/5.0 (Linux; Android 12; SM-X200)')).toBe(true)
    expect(supportsAutomaticBoilerStatus('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false)
  })

  it('debounces automatic checks across WebAPK remounts', () => {
    expect(claimAutomaticBoilerStatus(10_000)).toBe(true)
    expect(claimAutomaticBoilerStatus(10_000 + BOILER_AUTO_COOLDOWN_MS - 1)).toBe(false)
    expect(claimAutomaticBoilerStatus(10_000 + BOILER_AUTO_COOLDOWN_MS)).toBe(true)
  })

  it('allows exactly one controlled retry for an automatic failed status read', () => {
    expect(claimAutomaticBoilerStatus(10_000)).toBe(true)
    expect(consumeAutomaticBoilerRetry('unknown', 11_000)).toBe(true)
    expect(consumeAutomaticBoilerRetry('timeout', 12_000)).toBe(false)
  })

  it('does not retry an automatic confirmed status read', () => {
    expect(claimAutomaticBoilerStatus(10_000)).toBe(true)
    expect(consumeAutomaticBoilerRetry('on', 11_000)).toBe(false)
  })

  it('consumes the one-time Android return marker without leaving it in the URL', () => {
    window.history.replaceState({}, '', '/?boiler_resume=1#/admin')
    expect(consumeBoilerResumeSignal()).toBe(true)
    expect(window.location.search).toBe('')
    expect(consumeBoilerResumeSignal()).toBe(false)
  })

  it('targets the installed companion from Chrome', () => {
    expect(boilerIntentLink('status')).toBe('intent://boiler/status#Intent;scheme=salonkristina;package=hr.salon.kristina.companion;end')
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
