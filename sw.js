const CACHE = 'sarfiyat-v2';
const FILES = ['./', './index.html', './core.js', './app.js', './style.css', './manifest.json', './icon-192.png', './icon-512.png', './vendor/xlsx.full.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Dropbox وغيره: مباشرة للشبكة
  // الشبكة أولاً (عشان التحديثات تصل)، وإذا ما فيه نت نرجع للمخزن
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html'))));
});
