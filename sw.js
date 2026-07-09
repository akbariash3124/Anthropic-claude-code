/* Service worker — app shell works offline (logging, timer, plate math).
   AI + backup calls are network-only. Bump CACHE to ship updates. */
const CACHE = "coach-shell-v4";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest",
  "./config.js", "./store.js", "./observatory.js", "./brain.js", "./backup.js", "./app.js",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;                       // POSTs (AI, backup) go straight to network
  if (url.origin !== location.origin) return;                   // external APIs untouched
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const refresh = fetch(e.request).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || refresh;                                    // cache-first, refresh in background
    })
  );
});
