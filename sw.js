// Service worker: cache-first de todo o app → funciona 100% offline depois da 1ª visita.
const VERSION = 'croqui-v7';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/areas.js', 'js/brand.js', 'js/db.js', 'js/editor.js', 'js/export.js', 'js/freehand.js', 'js/geometry.js',
  'js/ctxmenu.js', 'js/markup.js', 'js/measure.js', 'js/objects.js', 'js/model.js', 'js/motion.js', 'js/palette.js', 'js/render.js', 'js/settings.js',
  'js/solver.js', 'js/textures.js', 'js/theme.js', 'js/ui.js', 'js/units.js', 'js/util.js',
  'brand/logo-on-light.png', 'brand/logo-on-dark.png', 'brand/shield.png',
  'icons/icon-192.png', 'icons/icon-192-light.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
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
