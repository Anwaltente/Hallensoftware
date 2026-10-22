/**
 * HALLE//OS Service Worker (v5.3): schlank, damit die App als Vollbild auf dem Homescreen läuft.
 *
 *  - Seiten, JavaScript und CSS: immer zuerst vom Server (neueste Version), Cache nur als Notfall ohne Netz
 *  - Icons und Manifest: aus dem Cache (ändern sich praktisch nie)
 *  - /api und /files: NIE zwischengespeichert (Daten kommen immer live aus der Datenbank)
 *  - fremde Server (Tailwind, Schriften): nicht angefasst
 */
const VERSION = 'halle-v5.3.0';
const CORE = [
  '/',
  '/style.css',
  '/biz.css',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(CORE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('halle-') && k !== VERSION).map((k) => caches.delete(k))))
      // bewusst kein clients.claim(): offene Seiten laufen ungestört weiter, ab dem nächsten Aufruf übernimmt der neue Worker
  );
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return;
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === 'navigate' || /\.(js|css|html)$/.test(url.pathname)) {
    event.respondWith(networkFirst(req));
  }
});
