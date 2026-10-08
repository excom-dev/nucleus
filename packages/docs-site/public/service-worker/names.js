import { openDB } from "idb";

export const SEED = [
  { id: 1, name: "Hans", surname: "Emil" },
  { id: 2, name: "Max", surname: "Mustermann" },
  { id: 3, name: "Roman", surname: "Tisch" },
];

/* Same reseed rule as the todos: on every worker activation, and when
 * the seed is older than this. */
const SEED_TTL_MS = 24 * 60 * 60 * 1000;

/* A database of its own: a new store in the todos' database would need a
 * version bump (and an upgrade path) there. */
const db = () =>
  openDB("docs-site-names", 1, {
    upgrade(database) {
      database.createObjectStore("names", { keyPath: "id" });
      database.createObjectStore("meta");
    },
  });

export async function seedNames(database) {
  database ??= await db();
  const tx = database.transaction(["names", "meta"], "readwrite");
  await tx.objectStore("names").clear();
  for (const entry of SEED) await tx.objectStore("names").put(entry);
  await tx.objectStore("meta").put(Date.now(), "seededAt");
  await tx.done;
}

async function ensureFreshSeed(database) {
  const seededAt = await database.get("meta", "seededAt");
  if (!seededAt || Date.now() - seededAt > SEED_TTL_MS) await seedNames(database);
}

/** `GET|POST /api/names`, `GET|PUT|PATCH|DELETE /api/names/:id`. */
export async function handleNames(request) {
  const match = new URL(request.url).pathname.match(/^\/api\/names(?:\/(\d+))?$/);
  if (!match) return json({ message: "not found" }, 404);

  const id = match[1] ? Number(match[1]) : null;
  const database = await db();
  await ensureFreshSeed(database);
  const method = request.method.toUpperCase();

  if (method === "GET" && id == null) return json(await database.getAll("names"));
  if (method === "GET") {
    const entry = await database.get("names", id);
    return entry ? json(entry) : json({ message: "not found" }, 404);
  }
  if (method === "POST" && id == null) {
    const keys = await database.getAllKeys("names");
    const entry = {
      ...pick(await readJson(request)),
      id: keys.length ? Math.max(...keys) + 1 : 1,
    };
    await database.put("names", entry);
    return json(entry, 201);
  }
  if ((method === "PUT" || method === "PATCH") && id != null) {
    const existing = await database.get("names", id);
    if (!existing) return json({ message: "not found" }, 404);
    const body = await readJson(request);
    const entry =
      method === "PUT" ? { ...pick(body), id } : { ...existing, ...pick(body, existing), id };
    await database.put("names", entry);
    return json(entry);
  }
  if (method === "DELETE" && id != null) {
    await database.delete("names", id);
    return json({});
  }
  return json({ message: "method not allowed" }, 405);
}

/* Only `name` and `surname` are the client's to set; a form may send more. */
const pick = (body, base = {}) => ({
  name: String(body.name ?? base.name ?? ""),
  surname: String(body.surname ?? base.surname ?? ""),
});

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const readJson = (request) => request.json().catch(() => ({}));
