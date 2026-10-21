// Guarda o app pra abrir sem internet. Os dados ficam no localStorage (ver app.js).
const CACHE = 'luisa-v1';
const SHELL = ['/', '/app.js', '/app.css', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  const fonte = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !fonte) return;
  // app: rede primeiro (pega atualização), cache se offline. Fonte: cache primeiro.
  e.respondWith(fonte
    ? caches.match(e.request).then(r => r || fetch(e.request).then(res => (caches.open(CACHE).then(c => c.put(e.request, res.clone())), res)))
    : fetch(e.request).then(res => (caches.open(CACHE).then(c => c.put(e.request, res.clone())), res))
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('/'))));
});
