// Loads sw.js into a fake service worker scope: in-memory IndexedDB, FIFO lock, settable clock, no latency.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The scenarios send a lowercase "patch" on purpose.
process.removeAllListeners("warning").on("warning", (w) => w.code === "UNDICI-FETCH-patch" || console.warn(w));

export const ORIGIN = "http://localhost:3000";
// Not new URL("…", import.meta.url): Vite rewrites that pattern under vitest.
const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "../../..");

const serveFrom = (root) => async (url) => {
  const body = readFileSync(join(root, new URL(url, ORIGIN).pathname));
  return new Response(body, { headers: { "content-type": "application/json" } });
};

export const loadWorker = ({ root = ROOT, now = Date.now(), fetch = serveFrom(root) } = {}) => {
  const clock = { now };
  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }
    static now() {
      return clock.now;
    }
  }

  const data = new Map();
  const request = (fn) => {
    const req = {};
    queueMicrotask(() => {
      try {
        req.result = fn();
        req.onsuccess?.();
      } catch (error) {
        req.error = error;
        req.onerror?.();
      }
    });
    return req;
  };
  const objectStore = {
    get: (key) => request(() => (data.has(key) ? structuredClone(data.get(key)) : undefined)),
    put: (value, key) => request(() => (data.set(key, structuredClone(value)), key)),
  };
  const db = { createObjectStore: () => objectStore, transaction: () => ({ objectStore: () => objectStore }) };
  const indexedDB = {
    open: () => {
      const req = {};
      setTimeout(() => {
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };

  const lockTail = { promise: Promise.resolve() };
  const locks = {
    request: async (_name, task) => {
      const previous = lockTail.promise;
      let release;
      lockTail.promise = new Promise((resolve) => (release = resolve));
      await previous;
      try {
        return await task();
      } finally {
        release();
      }
    },
  };

  // A file:// filename lets V8 coverage attribute the run to the file.
  const runScript = (path) => {
    const file = join(root, path);
    vm.runInContext(readFileSync(file, "utf8"), context, { filename: pathToFileURL(file).href });
  };

  const listeners = {};
  const context = vm.createContext({
    Date: FakeDate,
    URL,
    URLSearchParams,
    Response,
    Request,
    structuredClone,
    console,
    setTimeout: (fn) => setTimeout(fn, 0),
    indexedDB,
    navigator: { locks },
    fetch: (url) => fetch(url),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    location: new URL(`${ORIGIN}/sw.js`),
    importScripts: (...paths) => paths.forEach(runScript),
  });
  context.self = context;
  runScript("sw.js");

  // Resolves to the worker's Response, or null when it leaves the request to the network.
  const dispatch = async (url, init) => {
    let pending = null;
    listeners.fetch({ request: new Request(url, init), respondWith: (response) => (pending = response) });
    return pending && (await pending);
  };

  // body is JSON-encoded; { raw } sends text as is.
  const send = (method, path, body, { raw } = {}) => {
    const text = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const headers = { accept: "application/json", ...(text !== undefined && { "content-type": "application/json" }) };
    return dispatch(`${ORIGIN}/api${path}`, { method, headers, body: text });
  };

  const api = async (method, path, body) => {
    const response = await send(method, path, body);
    return { status: response.status, body: await response.json() };
  };

  const travel = async (ms) => {
    clock.now += ms;
  };

  // Runs scenario.js against this worker; call(method, path, body) defaults to api.
  const runScenario = (call = api) => {
    vm.runInContext(readFileSync(join(HERE, "scenario.js"), "utf8"), context, { filename: "scenario.js" });
    return context.scenario(call, travel);
  };

  return { dispatch, send, api, travel, runScenario };
};
