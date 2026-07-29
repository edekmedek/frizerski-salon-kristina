export const TAPO_ANDROID_INTENT = 'intent://#Intent;package=com.tplink.iot;end'
export const TAPO_PWA_FALLBACK = 'Otvori aplikaciju Tapo s početnog zaslona.'

type TapoLaunchOptions = {
  userAgent?: string
  standalone?: boolean
  navigate?: (url: string) => void
  onUnavailable: () => void
  document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
  setTimeout?: (callback: () => void, delay: number) => number
}

function isStandalonePwa() {
  const iosNavigator = navigator as Navigator & { standalone?: boolean }
  return iosNavigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

export function openTapoAndroidApp({
  userAgent = navigator.userAgent,
  standalone = isStandalonePwa(),
  navigate = url => { window.location.href = url },
  onUnavailable,
  document: page = document,
  setTimeout: schedule = window.setTimeout.bind(window),
}: TapoLaunchOptions) {
  if (!/Android/i.test(userAgent) || standalone) {
    onUnavailable()
    return
  }

  let appOpened = false
  const detectAppOpen = () => {
    if (page.hidden) appOpened = true
  }
  page.addEventListener('visibilitychange', detectAppOpen)

  try {
    navigate(TAPO_ANDROID_INTENT)
  } catch {
    page.removeEventListener('visibilitychange', detectAppOpen)
    onUnavailable()
    return
  }

  schedule(() => {
    page.removeEventListener('visibilitychange', detectAppOpen)
    if (!appOpened) onUnavailable()
  }, 1500)
}
