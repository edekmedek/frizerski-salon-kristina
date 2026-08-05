export type BoilerState = 'on' | 'off' | 'unknown'
export type BoilerCommand = 'status' | 'on' | 'off'
export type BoilerResult = 'on' | 'off' | 'unknown' | 'timeout' | 'error'

export type ConsumedBoilerResult = {
  result: BoilerResult
  detail: string
  elapsedMs: number | null
  clicked: boolean
}

const BOILER_CACHE_KEY = 'salon-boiler-confirmed-state'
const BOILER_CACHE_MAX_AGE_MS = 120_000
const BOILER_AUTO_LAST_REQUEST_KEY = 'salon-boiler-auto-last-request'
const BOILER_AUTO_TRANSACTION_KEY = 'salon-boiler-auto-transaction'
export const BOILER_AUTO_COOLDOWN_MS = 10_000
export const BOILER_AUTO_RETRY_WINDOW_MS = 30_000

export function boilerDeepLink(command: BoilerCommand) {
  return `salonkristina://boiler/${command}`
}

export function boilerIntentLink(command: BoilerCommand) {
  return `intent://boiler/${command}#Intent;scheme=salonkristina;package=hr.salon.kristina.companion;end`
}

export function requestBoilerCommand(command: BoilerCommand) {
  window.location.href = boilerIntentLink(command)
}

export function consumeBoilerResumeSignal() {
  const url = new URL(window.location.href)
  if (url.searchParams.get('boiler_resume') !== '1') return false
  url.searchParams.delete('boiler_resume')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  return true
}

export function supportsAutomaticBoilerStatus(userAgent = navigator.userAgent) {
  return /Android/i.test(userAgent)
}

export function claimAutomaticBoilerStatus(now = Date.now()) {
  const lastRequest = Number(sessionStorage.getItem(BOILER_AUTO_LAST_REQUEST_KEY))
  if (Number.isFinite(lastRequest) && now - lastRequest < BOILER_AUTO_COOLDOWN_MS) return false
  sessionStorage.setItem(BOILER_AUTO_LAST_REQUEST_KEY, String(now))
  sessionStorage.setItem(BOILER_AUTO_TRANSACTION_KEY, JSON.stringify({ startedAt: now, retries: 0 }))
  return true
}

export function consumeAutomaticBoilerRetry(result: BoilerResult, now = Date.now()) {
  const raw = sessionStorage.getItem(BOILER_AUTO_TRANSACTION_KEY)
  if (!raw) return false
  try {
    const transaction = JSON.parse(raw) as { startedAt?: number; retries?: number }
    if (result === 'on' || result === 'off'
      || typeof transaction.startedAt !== 'number'
      || now - transaction.startedAt > BOILER_AUTO_RETRY_WINDOW_MS
      || transaction.retries !== 0) {
      sessionStorage.removeItem(BOILER_AUTO_TRANSACTION_KEY)
      return false
    }
    sessionStorage.setItem(BOILER_AUTO_TRANSACTION_KEY, JSON.stringify({
      startedAt: transaction.startedAt,
      retries: 1,
    }))
    return true
  } catch {
    sessionStorage.removeItem(BOILER_AUTO_TRANSACTION_KEY)
    return false
  }
}

export function consumeBoilerResult(): ConsumedBoilerResult | null {
  const url = new URL(window.location.href)
  const rawResult = url.searchParams.get('boiler_result')
  if (!rawResult) return null
  const result: BoilerResult = ['on', 'off', 'unknown', 'timeout', 'error'].includes(rawResult)
    ? rawResult as BoilerResult
    : 'error'
  const elapsed = Number(url.searchParams.get('boiler_elapsed_ms'))
  const consumed = {
    result,
    detail: url.searchParams.get('boiler_detail') ?? '',
    elapsedMs: Number.isFinite(elapsed) ? elapsed : null,
    clicked: url.searchParams.get('boiler_clicked') === '1',
  }
  if (result === 'on' || result === 'off') {
    localStorage.setItem(BOILER_CACHE_KEY, JSON.stringify({ state: result, confirmedAt: Date.now() }))
  } else {
    localStorage.removeItem(BOILER_CACHE_KEY)
  }
  for (const key of ['boiler_result', 'boiler_detail', 'boiler_elapsed_ms', 'boiler_clicked']) {
    url.searchParams.delete(key)
  }
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  return consumed
}

export function readCachedBoilerState(): BoilerState {
  try {
    const cached = JSON.parse(localStorage.getItem(BOILER_CACHE_KEY) ?? 'null') as {
      state?: string
      confirmedAt?: number
    } | null
    if (!cached || (cached.state !== 'on' && cached.state !== 'off')
      || typeof cached.confirmedAt !== 'number'
      || Date.now() - cached.confirmedAt > BOILER_CACHE_MAX_AGE_MS) {
      return 'unknown'
    }
    return cached.state
  } catch {
    return 'unknown'
  }
}
