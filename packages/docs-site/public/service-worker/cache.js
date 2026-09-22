export const CACHE_VERSION = "docs-site-v1";

const HASHED = /^\/assets\//;
const NEVER = /^\/(service-worker\/|api\/)/;

export async function handleAsset(request) {
  const path = new URL(request.url).pathname;
  if (NEVER.test(path)) return fetch(request);

  const cache = await caches.open(CACHE_VERSION);
  if (HASHED.test(path)) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  }

  try {
    const res = await fetch(request);
    if (res.ok && isCacheable(path, res)) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

/* Offline by path: Quark sheets have no reliable content-type, and
 * package metas are the only JSON worth keeping (`/api/*` is excluded). */
const OFFLINE_BY_PATH = /(\.quark$|^\/package-metas\/)/;

function isCacheable(path, res) {
  if (NEVER.test(path) || path.endsWith(".html") || path === "/") return false;
  if (OFFLINE_BY_PATH.test(path)) return true;
  return /javascript|css|image|font|svg|wasm/.test(
    res.headers.get("content-type") ?? "",
  );
}
