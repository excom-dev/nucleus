import { addSaved, latestOrder, me, orderById, orders, removeSaved, saved, setTrade } from "./account.js";
import { addLine, bag, removeLine, setQty } from "./bag.js";
import { checkout, placeOrder, updateCheckout } from "./checkout.js";
import { DEFAULT_STATE } from "./config.js";
import { fail } from "./fail.js";
import {
  authenticationOptions,
  beginAuthentication,
  beginRegistration,
  currentUser,
  registrationOptions,
  signedIn,
  signOut,
  verifyAuthentication,
  verifyRegistration,
} from "./passkeys.js";
import { home, listing, productPage, recordRecent } from "./shop.js";

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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const readBody = async (request) => {
  try {
    return (await request.json()) ?? {};
  } catch {
    return {};
  }
};

/** Whether the API answers `url`: `/api/*` on `origin`. The rest goes to the network. */
export const isApiRequest = (url, origin) => {
  const { origin: from, pathname } = new URL(url);
  return from === origin && pathname.startsWith("/api/");
};

/** The state in memory, cloned in and out as IndexedDB clones it: the default state until written. */
export const memoryStore = () => {
  const data = new Map();
  return {
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => void data.set(key, structuredClone(value)),
  };
};

/**
 * The mock API: `(request) => Response` for an `/api/*` request to `origin`,
 * from what it is given. `store` holds the state, one key per `DEFAULT_STATE`
 * entry (`get(key)`, `set(key, value)`); `fetchCatalog()` answers the
 * catalogue, asked again until it is ok (a 503 meanwhile); `now()` is the
 * clock; `lock(task)` runs one request at a time. An error answers its status
 * and message.
 */
export const createApi = ({ store, fetchCatalog, now = Date.now, origin, lock = (task) => task() }) => {
  const site = new URL(origin);
  const memo = {};

  const readState = async () => {
    const entries = Object.entries(DEFAULT_STATE).map(async ([key, initial]) => [key, (await store.get(key)) ?? initial]);
    return Object.fromEntries(await Promise.all(entries));
  };

  const writeState = (changes) => Promise.all(Object.entries(changes).map(([key, value]) => store.set(key, value)));

  const loadCatalog = async () => {
    const response = await fetchCatalog();
    return response.ok ? response.json() : fail(503, "The catalogue is unavailable.");
  };

  const catalog = async () => (memo.catalog ??= await loadCatalog());

  const handle = async (request) => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = decodeURIComponent(url.pathname);
    const route =
      ROUTES.find((candidate) => candidate.method === method && candidate.pattern.test(path)) ??
      fail(404, `No route for ${method} ${path}.`);
    const ctx = {
      params: path.match(route.pattern).groups ?? {},
      query: url.searchParams,
      body: await readBody(request),
      now: now(),
      catalog: await catalog(),
      state: await readState(),
      site,
    };
    const changes = (await route.update?.(ctx)) ?? {};
    await writeState(changes);
    return json(route.view({ ...ctx, state: { ...ctx.state, ...changes } }), route.status);
  };

  return async (request) => {
    try {
      return await lock(() => handle(request));
    } catch (error) {
      return json({ message: error.message, field: error.field }, error.status ?? 500);
    }
  };
};
