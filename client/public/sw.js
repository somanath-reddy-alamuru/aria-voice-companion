// Aria service worker — caches the app shell (HTML/JS/CSS/icons) so the app
// opens instantly from the home screen, even on a flaky connection. It does
// NOT cache API calls (/api/*, /health) — those always need to actually
// reach your server, since that's where the AI, memory, and conversation
// history live.
const CACHE_NAME = "aria-shell-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API/health calls or cross-origin requests (the AI
  // server, YouTube, weather APIs, etc.) — those must always hit the network.
  if (url.pathname.startsWith("/api/") || url.pathname === "/health" || url.origin !== self.location.origin) {
    return;
  }

  // App shell: network-first so you always get the latest build when
  // online, falling back to cache when offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
  );
});
