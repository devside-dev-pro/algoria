// Service worker minimal — rend la PWA installable ; le réseau reste la source de vérité (données live).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // passthrough — pas de cache offline en V1 (tout est temps réel)
