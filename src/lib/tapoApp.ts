export const SALON_COMPANION_DOOR_LINK = 'salonkristina://door/live'
export const SALON_COMPANION_STATUS_LINK = 'salonkristina://door/status'
export const COMPANION_UNAVAILABLE_MESSAGE = 'Companion aplikacija nije instalirana.'
const COMPANION_STATUS_MAX_AGE_MS = 15_000
const COMPANION_STATUS_KEY = 'salon-companion-ready-at'

export function isAndroidBrowser() {
  const navigatorWithData = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const platform = navigatorWithData.userAgentData?.platform ?? navigator.platform
  return /android/i.test(platform) || /android/i.test(navigator.userAgent)
}

export function consumeCompanionStatus() {
  const url = new URL(window.location.href)
  const status = url.searchParams.get('companion_status')
  if (!status) return null
  if (status === 'ready') {
    localStorage.setItem(COMPANION_STATUS_KEY, String(Date.now()))
  } else {
    localStorage.removeItem(COMPANION_STATUS_KEY)
  }
  url.searchParams.delete('companion_status')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  return status === 'ready'
}

export function hasRecentCompanionStatus() {
  const checkedAt = Number(localStorage.getItem(COMPANION_STATUS_KEY))
  return Number.isFinite(checkedAt) && Date.now() - checkedAt < COMPANION_STATUS_MAX_AGE_MS
}

export function requestCompanionStatus() {
  window.location.href = SALON_COMPANION_STATUS_LINK
}

type CompanionLaunchOptions = {
  navigate?: (url: string) => void
  onUnavailable: () => void
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
  setTimeout?: (callback: () => void, delay: number) => number
}

export function openSalonDoorCompanion({
  navigate = url => { window.location.href = url },
  onUnavailable,
  document: page = document,
  setTimeout: schedule = window.setTimeout.bind(window),
}: CompanionLaunchOptions) {
  console.info('Door button pressed')
  let companionOpened = false
  const detectCompanionOpen = () => {
    if (page.hidden) companionOpened = true
  }
  page.addEventListener('visibilitychange', detectCompanionOpen)

  try {
    navigate(SALON_COMPANION_DOOR_LINK)
    console.info('Deep link launched')
  } catch {
    page.removeEventListener('visibilitychange', detectCompanionOpen)
    onUnavailable()
    return
  }

  schedule(() => {
    page.removeEventListener('visibilitychange', detectCompanionOpen)
    if (!companionOpened) onUnavailable()
  }, 1500)
}
