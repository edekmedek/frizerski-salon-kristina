export const SALON_COMPANION_DOOR_LINK = 'salonkristina://door/live'
export const COMPANION_UNAVAILABLE_MESSAGE = 'Companion aplikacija nije instalirana.'

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
