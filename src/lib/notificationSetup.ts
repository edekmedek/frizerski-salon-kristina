export interface NotificationPlatform {
  android: boolean
  samsung: boolean
  ios: boolean
  installed: boolean
}

export function detectNotificationPlatform({
  userAgent = navigator.userAgent,
  standalone = window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
}: { userAgent?: string; standalone?: boolean } = {}): NotificationPlatform {
  const android = /Android/i.test(userAgent)
  return {
    android,
    samsung: android && /Samsung|SM-[A-Z0-9]+/i.test(userAgent),
    ios: /iPhone|iPad|iPod/i.test(userAgent),
    installed: standalone,
  }
}

const LAST_TEST_KEY = 'salon-notification-last-test'

export function getLastSuccessfulPushTest(storage: Pick<Storage, 'getItem'> = localStorage) {
  return storage.getItem(LAST_TEST_KEY)
}

export function saveLastSuccessfulPushTest(value: string, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(LAST_TEST_KEY, value)
}
