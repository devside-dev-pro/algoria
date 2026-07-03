// Service worker de la PWA membre : installabilité + NOTIFICATIONS PUSH (wins, recap, alerte live).
// Le réseau reste la source de vérité (pas de cache offline — tout est temps réel).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // passthrough

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* payload non-JSON → défauts */ }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Algoria', {
      body: d.body || '',
      icon: '/icons/member-192.png',
      badge: '/icons/member-192.png',
      tag: d.tag || undefined,
      data: { url: d.url || '/member' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/member';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.navigate(url); return c.focus(); }
      return clients.openWindow(url);
    }),
  );
});
