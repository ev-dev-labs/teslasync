// Self-destructing service worker.
// Immediately takes over, clears all caches, and unregisters itself.
// This ensures any previously cached production SW is killed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  );
});
// No fetch handler — all requests go directly to network
