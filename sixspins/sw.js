// Minimal cache-first service worker for player headshots and team logos.
// /img/ slugs are content-stable, so a cached copy never goes stale; everything
// else (HTML, JS, data JSON) passes straight through to the network untouched.
const CACHE = 'img-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (!url.pathname.includes('/img/')) return

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request)
      if (hit) return hit
      const res = await fetch(event.request)
      if (res.ok) cache.put(event.request, res.clone())
      return res
    })
  )
})
