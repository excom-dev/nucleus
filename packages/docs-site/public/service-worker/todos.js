import { openDB } from "idb";

const SEED = [
  { userId: 1, id: 1, title: "Pick up groceries  🛒", completed: false },
  { userId: 1, id: 2, title: "Meal prep  🍔", completed: false },
  { userId: 1, id: 3, title: "Organize desk  📁", completed: false },
];

/* Reseed on every worker activation, and whenever the seed is older
 * than this, so a tab left open for days still starts from the seed. */
const SEED_TTL_MS = 24 * 60 * 60 * 1000;

const db = () =>
  openDB("docs-site", 2, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("todos")) {
        database.createObjectStore("todos", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("meta")) {
        database.createObjectStore("meta");
      }
    },
  });

export async function seedTodos(database) {
  database ??= await db();
  const tx = database.transaction(["todos", "meta"], "readwrite");
  await tx.objectStore("todos").clear();
  for (const todo of SEED) await tx.objectStore("todos").put(todo);
  await tx.objectStore("meta").put(Date.now(), "seededAt");
  await tx.done;
}

/** Reseeds when the stored seed is missing or older than `SEED_TTL_MS`. */
async function ensureFreshSeed(database) {
  const seededAt = await database.get("meta", "seededAt");
  if (!seededAt || Date.now() - seededAt > SEED_TTL_MS) await seedTodos(database);
}

export async function handleTodos(request) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/todos(?:\/(\d+))?$/);
  if (!match) return json({ message: "not found" }, 404);

  const id = match[1] ? Number(match[1]) : null;
  const database = await db();
  await ensureFreshSeed(database);
  const method = request.method.toUpperCase();

  if (method === "GET" && id == null) {
    const limit = Number(url.searchParams.get("_limit"));
    const todos = await database.getAll("todos");
    return json(limit ? todos.slice(0, limit) : todos);
  }
  if (method === "GET") {
    const todo = await database.get("todos", id);
    return todo ? json(todo) : json({ message: "not found" }, 404);
  }
  if (method === "POST") {
    const body = await readJson(request);
    const keys = await database.getAllKeys("todos");
    const todo = {
      userId: Number(body.userId) || 1,
      id: keys.length ? Math.max(...keys) + 1 : 1,
      title: String(body.title ?? ""),
      completed: Boolean(body.completed),
    };
    await database.put("todos", todo);
    return json(todo, 201);
  }
  if (method === "PUT" || method === "PATCH") {
    const existing = await database.get("todos", id);
    if (!existing) return json({ message: "not found" }, 404);
    const body = await readJson(request);
    const todo =
      method === "PUT"
        ? {
            userId: Number(body.userId) || 1,
            id,
            title: String(body.title ?? ""),
            completed: Boolean(body.completed),
          }
        : { ...existing, ...body, id };
    await database.put("todos", todo);
    return json(todo);
  }
  if (method === "DELETE") {
    await database.delete("todos", id);
    return json({});
  }
  return json({ message: "method not allowed" }, 405);
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

const readJson = (request) => request.json().catch(() => ({}));
