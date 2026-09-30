// Service worker: cache-first de todo o app → funciona 100% offline depois da 1ª visita.
const VERSION = 'croqui-v3';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/editor.js', 'js/export.js', 'js/freehand.js', 'js/geometry.js',
  'js/model.js', 'js/render.js', 'js/solver.js', 'js/textures.js', 'js/ui.js', 'js/units.js', 'js/util.js',
  'js/motion.js', 'js/fan.js', 'js/markup.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Cache primeiro (abre instantâneo e offline); em paralelo busca a versão nova para a próxima abertura.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      if (res) return res;
      if (e.request.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }),
  );
});
