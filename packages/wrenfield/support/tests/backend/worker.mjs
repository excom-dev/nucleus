// The service worker's API in Node: its modules as the worker runs them, with an in-memory store, a FIFO lock, a
// settable clock and no latency.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi, isApiRequest, memoryStore } from "../../../public/service-worker/api.js";

// The scenarios send a lowercase "patch" on purpose.
process.removeAllListeners("warning").on("warning", (w) => w.code === "UNDICI-FETCH-patch" || console.warn(w));

export const ORIGIN = "http://localhost:3000";
// Not new URL("…", import.meta.url): Vite rewrites that pattern under vitest.
const HERE = dirname(fileURLToPath(import.meta.url));
// The served files: `public/` (`index.html` and `shell.css` are the build's entries).
export const ROOT = resolve(HERE, "../../../public");

const serveFrom = (root) => async (url) => {
  const body = readFileSync(join(root, new URL(url, ORIGIN).pathname));
  return new Response(body, { headers: { "content-type": "application/json" } });
};

/** One task at a time, in call order: the worker's `navigator.locks`. */
const fifo = () => {
  let tail = Promise.resolve();
  return async (task) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => (release = resolve));
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  };
};

export const loadWorker = ({ root = ROOT, now = Date.now(), fetch = serveFrom(root) } = {}) => {
  const clock = { now };
  const api = createApi({
    store: memoryStore(),
    fetchCatalog: () => fetch("/data/catalog.json"),
    now: () => clock.now,
    origin: ORIGIN,
    lock: fifo(),
  });

  // Resolves to the worker's Response, or null when it leaves the request to the network.
  const dispatch = async (url, init) => {
    const request = new Request(url, init);
    return isApiRequest(request.url, ORIGIN) ? api(request) : null;
  };

  // body is JSON-encoded; { raw } sends text as is.
  const send = (method, path, body, { raw } = {}) => {
    const text = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const headers = { accept: "application/json", ...(text !== undefined && { "content-type": "application/json" }) };
    return dispatch(`${ORIGIN}/api${path}`, { method, headers, body: text });
  };

  const call = async (method, path, body) => {
    const response = await send(method, path, body);
    return { status: response.status, body: await response.json() };
  };

  const travel = async (ms) => {
    clock.now += ms;
  };

  // Runs scenario.js, whose Date is the worker's clock; call(method, path, body) defaults to the API.
  const runScenario = (via = call) => {
    class FakeDate extends Date {
      constructor(...args) {
        super(...(args.length ? args : [clock.now]));
      }
      static now() {
        return clock.now;
      }
    }
    const context = vm.createContext({ Date: FakeDate });
    vm.runInContext(readFileSync(join(HERE, "scenario.js"), "utf8"), context, { filename: "scenario.js" });
    return context.scenario(via, travel);
  };

  return { dispatch, send, api: call, travel, runScenario };
};
