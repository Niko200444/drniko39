const CACHE_NAME = "ets-quiz-v1";

// Burada JSON fayllarının adlarını öz siyahına uyğun doldur
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./ux.json",
  "./tecili.json",
  "./farm.json",
  "./patfiz.json",
  "./patfiz2.json",
  "./patan1a.json",
  "./patan2a.json",
  "./patandyes.json",
  "./mikrob1.json",
  "./mikrob2.json",
  "./norfiz1.json",
  "./norfiz2.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((resp) => {
      return resp || fetch(event.request);
    })
  );
});
