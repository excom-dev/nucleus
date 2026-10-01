importScripts(
  ...["config", "shop", "bag", "checkout", "account", "passkeys"].map(
    (name) => `/backend/${name}.js`
  )
);

const CATALOG_URL = "/data/catalog.json";
const DB_NAME = "wrenfield";
const LATENCY_MS = [80, 250];

// An update returns (or resolves to) the state keys it changes; the view builds the response from the new state.
const ROUTES = Object.entries({
  "GET /me": { view: me },
  "PATCH /session": { update: setTrade, view: me },
  "GET /home": { view: home },
  "GET /products": { view: listing },
  "GET /products/:slug": { update: recordRecent, view: productPage },
  "PUT /saved/:sku": { update: addSaved, view: saved },
  "DELETE /saved/:sku": { update: removeSaved, view: saved },
  "GET /bag": { view: bag },
  "POST /bag": { update: addLine, view: bag, status: 201 },
  "PATCH /bag/:lineId": { update: setQty, view: bag },
  "DELETE /bag/:lineId": { update: removeLine, view: bag },
  "GET /checkout": { view: checkout },
  "PATCH /checkout": { update: updateCheckout, view: checkout },
  "POST /orders": { update: placeOrder, view: latestOrder, status: 201 },
  "GET /orders": { view: orders },
  "GET /orders/latest": { view: latestOrder },
  "GET /orders/:id": { view: orderById },
  "DELETE /demo": { update: () => DEFAULT_STATE, view: () => ({ ok: true }) },
  "POST /passkeys/register/options": {
    update: beginRegistration,
    view: registrationOptions,
  },
  "POST /passkeys/register/verify": {
    update: verifyRegistration,
    view: signedIn,
  },
  "POST /passkeys/authenticate/options": {
    update: beginAuthentication,
    view: authenticationOptions,
  },
  "POST /passkeys/authenticate/verify": {
    update: verifyAuthentication,
    view: signedIn,
  },
  "DELETE /passkeys/session": {
    update: signOut,
    view: (ctx) => ({ user: currentUser(ctx) }),
  },
}).map(([route, handlers]) => {
  const [method, path] = route.split(" ");
  return {
    ...handlers,
    method,
    pattern: new RegExp(`^/api${path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}/?$`),
  };
});

const fail = (status, message, field) => {
  throw Object.assign(new Error(message), { status, field });
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const done = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const memo = {};

const openDb = () => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore("state");
  return done(request);
};

const store = async (mode) =>
  (await (memo.db ??= openDb()))
    .transaction("state", mode)
    .objectStore("state");
const get = async (key) => done((await store("readonly")).get(key));
const set = async (key, value) =>
  done((await store("readwrite")).put(value, key));

const readState = async () => {
  const entries = Object.entries(DEFAULT_STATE).map(async ([key, initial]) => [
    key,
    (await get(key)) ?? initial,
  ]);
  return Object.fromEntries(await Promise.all(entries));
};

const writeState = (changes) =>
  Promise.all(Object.entries(changes).map(([key, value]) => set(key, value)));

const loadCatalog = async () => {
  const response = await fetch(CATALOG_URL);
  return response.ok
    ? response.json()
    : fail(503, "The catalogue is unavailable.");
};

const catalog = async () => (memo.catalog ??= await loadCatalog());

const readBody = async (request) => {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
};

const handle = async (request) => {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = decodeURIComponent(url.pathname);
  const route =
    ROUTES.find(
      (candidate) => candidate.method === method && candidate.pattern.test(path)
    ) ?? fail(404, `No route for ${method} ${path}.`);
  const ctx = {
    params: path.match(route.pattern).groups ?? {},
    query: url.searchParams,
    body: await readBody(request),
    now: Date.now(),
    catalog: await catalog(),
    state: await readState(),
  };
  const changes = (await route.update?.(ctx)) ?? {};
  await writeState(changes);
  return json(
    route.view({ ...ctx, state: { ...ctx.state, ...changes } }),
    route.status
  );
};

const respond = async (request) => {
  const [min, max] = LATENCY_MS;
  await sleep(min + Math.random() * (max - min));
  try {
    return await navigator.locks.request(DB_NAME, () => handle(request));
  } catch (error) {
    return json(
      { message: error.message, field: error.field },
      error.status ?? 500
    );
  }
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
);
self.addEventListener("fetch", (event) => {
  const { origin, pathname } = new URL(event.request.url);
  if (origin === self.location.origin && pathname.startsWith("/api/"))
    event.respondWith(respond(event.request));
});
