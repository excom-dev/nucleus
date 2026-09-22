import { openDB } from "idb";

/**
 * Playground file overlay (`/nucleus/examples/*`) via `/api/sandbox/<path>`:
 *   GET    → override, or the original at `<path>`
 *   PUT    → `{ content }` stores an override
 *   DELETE → drop one file, or a whole app dir
 *            (`/api/sandbox/views/<app>`). Playground does this on mount.
 *
 * Served only to `/sandbox/` (preview iframe). Only `/views/*` is overridable.
 */

const STORE = "files";
const API_PREFIX = "/api/sandbox";
const OVERRIDABLE = /^\/views\/[\w-]+\/[\w.-]+$/;
const DIRECTORY = /^\/views\/[\w-]+$/;
const SANDBOX_CLIENT = /^\/sandbox\//;

const TYPES = {
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
};

const db = () =>
  openDB("docs-site-sandbox", 1, {
    upgrade(database) {
      database.createObjectStore(STORE, { keyPath: "path" });
    },
  });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const text = (content, path, source) =>
  new Response(content, {
    headers: {
      "content-type": `${TYPES[path.split(".").pop()] ?? "text/plain"}; charset=utf-8`,
      "cache-control": "no-store",
      "x-sandbox-source": source,
    },
  });

export async function handleSandbox(request) {
  const url = new URL(request.url);
  const path = url.pathname.slice(API_PREFIX.length);
  const method = request.method.toUpperCase();
  const database = await db();

  if (method === "DELETE" && DIRECTORY.test(path)) {
    const prefix = `${path}/`;
    const keys = await database.getAllKeys(
      STORE,
      IDBKeyRange.bound(prefix, `${prefix}\uffff`),
    );
    const tx = database.transaction(STORE, "readwrite");
    await Promise.all([...keys.map((key) => tx.store.delete(key)), tx.done]);
    return json({ path, source: "original", deleted: keys.length });
  }
  if (!OVERRIDABLE.test(path)) return json({ message: "not found", path }, 404);

  if (method === "GET") {
    const row = await database.get(STORE, path);
    if (row) return text(row.content, path, "override");
    const original = await fetch(url.origin + path);
    if (!original.ok) return json({ message: "not found", path }, original.status);
    return text(await original.text(), path, "original");
  }
  if (method === "PUT") {
    const body = await request.json().catch(() => null);
    if (typeof body?.content !== "string") {
      return json({ message: "expected { content: string }" }, 400);
    }
    await database.put(STORE, { path, content: body.content, updatedAt: Date.now() });
    return json({ path, source: "override", size: body.content.length });
  }
  if (method === "DELETE") {
    await database.delete(STORE, path);
    return json({ path, source: "original" });
  }
  return json({ message: "method not allowed" }, 405);
}

/**
 * Override for a `/sandbox/` GET (or `<path>.js` for extensionless `@use`).
 * `null` → fall through to the network.
 */
export async function matchSandboxOverride(event) {
  const { clientId, request } = event;
  if (!clientId) return null;
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/views/")) return null;
  const client = await self.clients.get(clientId);
  if (!client || !SANDBOX_CLIENT.test(new URL(client.url).pathname)) return null;
  const database = await db();
  const row =
    (await database.get(STORE, path)) ??
    (path.includes(".") ? null : await database.get(STORE, `${path}.js`));
  return row ? text(row.content, row.path, "override") : null;
}
