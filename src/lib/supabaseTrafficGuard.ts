type TrafficWindow = {
  startedAt: number
  calls: number
}

const trafficWindows = new Map<string, TrafficWindow>()
const WINDOW_MS = 60_000
const WARN_AFTER_CALLS = 120

export function trackSupabaseCall(label: string, now = Date.now()) {
  if (!import.meta.env.DEV) return
  const current = trafficWindows.get(label)
  if (!current || now - current.startedAt >= WINDOW_MS) {
    trafficWindows.set(label, { startedAt: now, calls: 1 })
    return
  }
  current.calls += 1
  if (current.calls === WARN_AFTER_CALLS + 1) {
    console.warn('[supabase-traffic]', {
      label,
      callsInLastMinute: current.calls,
      windowMs: WINDOW_MS,
      message: 'High call frequency detected. Check polling, listeners, and retries.',
    })
  }
}

export type SupabaseRefreshLoopOptions = {
  label: string
  refresh: () => Promise<boolean>
  baseIntervalMs?: number
  hiddenIntervalMs?: number
  maxBackoffMs?: number
  maxConsecutiveFailures?: number
  onError?: (error: unknown) => void
  documentTarget?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
}

export function startSupabaseRefreshLoop(options: SupabaseRefreshLoopOptions) {
  const {
    label,
    refresh,
    baseIntervalMs = 60_000,
    hiddenIntervalMs = 5 * 60_000,
    maxBackoffMs = 15 * 60_000,
    maxConsecutiveFailures = 5,
    onError,
    documentTarget = document,
  } = options

  let stopped = false
  let timer = 0
  let running = false
  let pending = false
  let backoffMs = baseIntervalMs
  let consecutiveFailures = 0

  const schedule = (delayMs: number) => {
    if (stopped) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      void tick()
    }, delayMs)
  }

  const tick = async () => {
    if (stopped) return
    if (running) {
      pending = true
      return
    }
    if (documentTarget.visibilityState !== 'visible') {
      schedule(hiddenIntervalMs)
      return
    }

    running = true
    let successful = false
    try {
      trackSupabaseCall(label)
      successful = await refresh()
    } catch (error) {
      onError?.(error)
    } finally {
      running = false
    }

    if (successful) {
      consecutiveFailures = 0
      backoffMs = baseIntervalMs
      if (pending) {
        pending = false
        schedule(0)
      } else {
        schedule(baseIntervalMs)
      }
      return
    }

    consecutiveFailures += 1
    backoffMs = Math.min(backoffMs * 2, maxBackoffMs)
    if (import.meta.env.DEV && consecutiveFailures === maxConsecutiveFailures) {
      console.warn('[supabase-refresh-loop]', {
        label,
        consecutiveFailures,
        backoffMs,
        message: 'Refresh keeps failing; requests will slow down with exponential backoff.',
      })
    }
    schedule(backoffMs)
  }

  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === 'visible') {
      schedule(0)
    }
  }

  documentTarget.addEventListener('visibilitychange', onVisibilityChange)
  schedule(baseIntervalMs)

  return () => {
    stopped = true
    window.clearTimeout(timer)
    documentTarget.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

export function resetSupabaseTrafficGuardForTests() {
  trafficWindows.clear()
}
