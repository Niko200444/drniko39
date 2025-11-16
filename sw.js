const CACHE_NAME = "ets-quiz-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./ux.json",
  "./tecili.json",
  "./torakal.json",
  "./plastik.json",
  "./patfiz2.json",
  "./patan1a.json",
  "./patan2a.json",
  "./patandyes.json",
  "./mikrob1.json",
  "./mikrob2.json",
  "./norfiz1.json",
  "./norfiz2.json",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((resp) => resp || fetch(event.request))
  );
});
