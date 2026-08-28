// Service worker for the Teacher Profile PWA.
// Network-first with cache fallback: teachers always get the newest app when
// online, and the last-used version still opens from the home screen offline.
// API calls are never cached.

const CACHE = "teacher-profile-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE)
            .then((c) => c.put(event.request, copy).then(() => trim(c)))
            .catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: event.request.mode === "navigate" }).then((hit) => {
          if (hit) return hit;
          // start_url may carry a query string (shared links) — ignore it.
          if (event.request.mode === "navigate") return caches.match("/", { ignoreSearch: true });
          return Response.error();
        })
      )
  );
});

// Old hashed bundles would otherwise accumulate across deploys — keep the
// runtime cache bounded (oldest entries go first).
const MAX_ENTRIES = 80;
function trim(cache) {
  return cache.keys().then((keys) => {
    if (keys.length <= MAX_ENTRIES) return undefined;
    return Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)));
  }).catch(() => {});
}
