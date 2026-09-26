// Guarda las pantallas en el teléfono para que la app abra sin señal.
// Los datos NO pasan por aquí: los registros van en la cola de app.js.
// Al cambiar cualquier archivo, subir VERSION para que los teléfonos la bajen.
const VERSION = "qdc-v15";
const ARCHIVOS = ["./", "index.html", "app.css", "app.js", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "factura.js", "reportes.js", "stock.js", "logo.jpg", "vendor/jspdf.umd.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Solo las pantallas (mismo origen, GET). Primero la red para agarrar la versión
// nueva; si no hay señal, lo guardado.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
