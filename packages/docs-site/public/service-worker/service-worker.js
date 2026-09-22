import { CACHE_VERSION, handleAsset } from "./cache.js";
import { handleApi } from "./api.js";
import { matchSandboxOverride } from "./sandbox.js";
import { seedTodos } from "./todos.js";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      );
      await seedTodos();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // never cache or intercept the worker script itself
  if (url.pathname.startsWith("/service-worker/")) return;
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApi(event.request));
    return;
  }
  if (event.request.method !== "GET") return;
  // `/sandbox/<app>` preview documents see edited `/views/*` files
  event.respondWith(
    matchSandboxOverride(event).then(
      (override) => override ?? handleAsset(event.request),
    ),
  );
});
