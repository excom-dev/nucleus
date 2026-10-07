import { createApi, isApiRequest } from "./api.js";

const DB_NAME = "wrenfield";
const LATENCY_MS = [80, 250];

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

const objectStore = async (mode) => (await (memo.db ??= openDb())).transaction("state", mode).objectStore("state");

// The state lives in IndexedDB, one request at a time across tabs.
const api = createApi({
  store: {
    get: async (key) => done((await objectStore("readonly")).get(key)),
    set: async (key, value) => done((await objectStore("readwrite")).put(value, key)),
  },
  fetchCatalog: () => fetch("/data/catalog.json"),
  origin: self.location.origin,
  lock: (task) => navigator.locks.request(DB_NAME, task),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Real latency, so loading states show.
const respond = async (request) => {
  const [min, max] = LATENCY_MS;
  await sleep(min + Math.random() * (max - min));
  return api(request);
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
// from a page loaded past this worker (a hard reload), which it then controls
self.addEventListener("message", (event) => event.data === "claim" && event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (isApiRequest(event.request.url, self.location.origin)) event.respondWith(respond(event.request));
});
