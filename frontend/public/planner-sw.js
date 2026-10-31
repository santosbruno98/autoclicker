/* Cache the application shell, never authentication/API responses. */

importScripts('/planner-precache.js');

const PREFIX = 'myplatform-planner-';
const CACHE = PREFIX + self.PLANNER_BUILD;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(
      (cache) => cache.addAll(self.PLANNER_ASSETS)
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(PREFIX) &&
              key !== CACHE
          )
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/')
  ) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request);

          if (response.ok) {
            return response;
          }
        } catch {
          // Use the cached application shell.
        }

        const cache = await caches.open(CACHE);
        return cache.match('/index.html');
      })()
    );

    return;
  }

  if (self.PLANNER_ASSETS.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(event.request);

        return cached || fetch(event.request);
      })()
    );
  }
});