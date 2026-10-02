// The service worker as the build ships it (one classic script, bundled as heft-rig's site build bundles it), run in a
// fake worker scope: in-memory IndexedDB, a recorded lock, no latency.
import vm from "node:vm";
import { build } from "@excom/heft-rig/node_modules/esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORIGIN, ROOT } from "./worker.mjs";

const bundle = async () => {
  const { outputFiles } = await build({
    entryPoints: [join(ROOT, "service-worker/service-worker.js")],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
  });
  return outputFiles[0].text;
};

/** IndexedDB with one database of object stores, structured clones in and out, requests answered a microtask later. */
const fakeIndexedDb = () => {
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
    get: (key) => request(() => structuredClone(data.get(key))),
    put: (value, key) => request(() => (data.set(key, structuredClone(value)), key)),
  };
  const db = { createObjectStore: () => objectStore, transaction: () => ({ objectStore: () => objectStore }) };
  const opened = [];
  return {
    opened,
    data,
    open: (name, version) => {
      opened.push([name, version]);
      const req = {};
      setTimeout(() => {
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
};

/**
 * Loads the worker script: `fetch(url, init)` dispatches a fetch event and resolves to its Response, or null when
 * the worker leaves the request to the network; `dispatch(type, data)` an install, activate or message event, and
 * resolves once the work it extended the event with is done.
 */
export const loadWorkerScript = async () => {
  const listeners = {};
  const indexedDB = fakeIndexedDb();
  const locks = [];
  const calls = [];
  const context = vm.createContext({
    URL,
    Request,
    Response,
    structuredClone,
    crypto,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    console,
    Math,
    setTimeout: (fn) => setTimeout(fn, 0),
    queueMicrotask,
    indexedDB,
    navigator: { locks: { request: async (name, task) => (locks.push(name), task()) } },
    fetch: async (url) => (calls.push(String(url)), new Response(readFileSync(join(ROOT, new URL(url, ORIGIN).pathname)))),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: async () => calls.push("skipWaiting"),
    clients: { claim: async () => calls.push("claim") },
    location: new URL(`${ORIGIN}/service-worker/service-worker.js`),
  });
  context.self = context;
  vm.runInContext(await bundle(), context, { filename: "service-worker.js" });

  const fetch = async (url, init) => {
    let pending = null;
    listeners.fetch({ request: new Request(url, init), respondWith: (response) => (pending = response) });
    return pending && (await pending);
  };
  const dispatch = async (type, data) => {
    const waits = [];
    listeners[type]({ data, waitUntil: (promise) => waits.push(promise) });
    await Promise.all(waits);
  };
  return { fetch, dispatch, indexedDB, locks, calls };
};
