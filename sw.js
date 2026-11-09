// Haalt eerst de nieuwste versie op, zodat updates direct doorkomen,
// en valt zonder internet terug op de laatst bewaarde versie.
const CACHE = 'kilometertracker-v1';
const BESTANDEN = [
  './', 'index.html', 'styles.css', 'app.js', 'logic.js', 'data.js', 'ocr.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((antwoord) => {
        if (antwoord.ok) {
          const kopie = antwoord.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
        }
        return antwoord;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
