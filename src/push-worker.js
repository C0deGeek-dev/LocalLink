// Static shell only. No takeover, private response caching or mutation replay.
/* global self, caches, fetch */
const cacheName = 'locallink-shell-__SHELL_GENERATION__';
const shellFiles = /* __SHELL_FILES__ */ [];
const shellPaths = new Set(shellFiles.map((file) => file.url));
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const responses = await Promise.all(shellFiles.map(async (file) => {
        const response = await fetch(file.url, { integrity: file.integrity, credentials: 'omit', cache: 'no-store', redirect: 'error' });
        if (!response.ok) throw new Error('Shell unavailable');
        return [file.url, response];
      }));
      const cache = await caches.open(cacheName);
      await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
    } catch (error) { await caches.delete(cacheName); throw error; }
  })());
});
self.addEventListener('activate', (event) => {
  // Natural activation waits for every old controlled window to close.
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('locallink-shell-') && name !== cacheName) await caches.delete(name);
    }
  })());
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const navigation = request.mode === 'navigate' && request.destination === 'document' && ['/', '/index.html'].includes(url.pathname);
  // HTML is only ever returned to a document navigation, never an API fetch.
  if (!navigation && (url.pathname === '/index.html' || !shellPaths.has(url.pathname))) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const response = await cache.match(navigation ? '/index.html' : url.pathname);
    // A missing pinned file must not fall back to bytes from another generation.
    if (!response) throw new Error('Offline shell incomplete. Reopen online to repair.');
    return response;
  })());
});
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('LocalLink', {
    body: 'There is an update on your PC. Open LocalLink to check.', tag: 'locallink-update',
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/');
    if (client) { client.postMessage({ type: 'notification-open' }); await client.focus(); }
    else await self.clients.openWindow('/#attention');
  })());
});
