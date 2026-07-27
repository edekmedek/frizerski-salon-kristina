self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  const payload = event.data?.json() ?? {}
  event.waitUntil((async () => {
    if (payload.unreadCount > 0 && self.registration.setAppBadge) {
      await self.registration.setAppBadge(payload.unreadCount)
    } else if (self.registration.clearAppBadge) {
      await self.registration.clearAppBadge()
    }
    await self.registration.showNotification(payload.title ?? 'Salon Kristina', {
      body: 'Imate novu poruku iz Salona Kristina.',
      icon: './favicon.svg',
      badge: './favicon.svg',
      tag: payload.tag ?? 'salon-kristina-message',
      renotify: true,
      vibrate: [180, 80, 180],
      data: { url: payload.url ?? './#/client/messages' },
    })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url ?? './#/client/messages', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => client.url.startsWith(self.location.origin))
    if (existing) {
      await existing.focus()
      return existing.navigate(target)
    }
    return self.clients.openWindow(target)
  })())
})
