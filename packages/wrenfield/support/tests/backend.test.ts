import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import catalogJson from "../../public/data/catalog.json?raw";
import { loadWorker, ORIGIN } from "./backend/worker.mjs";
import { loadWorkerScript } from "./backend/worker-script.mjs";

describe("backend", () => {
  it("passes every scenario check against the service worker's API", async () => {
    const { failed, total } = await loadWorker().runScenario();
    expect(failed).toEqual([]);
    // A floor, not an exact count: checks loop over the catalogue and the scenario grows. Catches one that runs nothing.
    expect(total).toBeGreaterThanOrEqual(166);
  });

  it("leaves requests outside its own /api/ to the network", async () => {
    const { dispatch } = loadWorker();
    for (const url of [`${ORIGIN}/index.html`, `${ORIGIN}/apix/me`, "https://example.com/api/me"]) {
      expect(await dispatch(url, { method: "GET" })).toBeNull();
    }
    expect((await dispatch(`${ORIGIN}/api/me`, { method: "GET" })).status).toBe(200);
  });

  it("answers 503 while the catalogue is unavailable, and recovers once it is back", async () => {
    const catalogue = { down: true };
    const { api } = loadWorker({
      fetch: async () => (catalogue.down ? new Response("gone", { status: 404 }) : new Response(catalogJson)),
    });
    expect(await api("GET", "/me")).toEqual({ status: 503, body: { message: "The catalogue is unavailable." } });
    catalogue.down = false;
    expect((await api("GET", "/me")).status).toBe(200);
  });

  it("ships as one script that keeps the state in IndexedDB, one request at a time, and takes control at once", async () => {
    const worker = await loadWorkerScript();
    await worker.dispatch("install");
    await worker.dispatch("activate");
    expect(worker.calls).toEqual(["skipWaiting", "claim"]);
    const json = { "content-type": "application/json" };
    const added = await worker.fetch(`${ORIGIN}/api/bag`, { method: "POST", headers: json, body: '{"sku":"WF-1014"}' });
    expect(added.status).toBe(201);
    expect((await (await worker.fetch(`${ORIGIN}/api/me`, { method: "GET" })).json()).bag.count).toBe(1);
    expect(worker.indexedDB.opened).toEqual([["wrenfield", 1]]);
    expect(worker.indexedDB.data.get("bag")).toMatchObject([{ sku: "WF-1014", qty: 1 }]);
    expect(worker.locks).toEqual(["wrenfield", "wrenfield"]);
    // the catalogue once, from the site
    expect(worker.calls.slice(2)).toEqual([`/data/catalog.json`]);
    for (const url of [`${ORIGIN}/index.html`, `${ORIGIN}/api`, "https://example.com/api/me"])
      expect(await worker.fetch(url, { method: "GET" })).toBeNull();
  });

  it("claims a page that asks, as one a hard reload left uncontrolled does", async () => {
    const worker = await loadWorkerScript();
    await worker.dispatch("message", "hello");
    expect(worker.calls).toEqual([]);
    await worker.dispatch("message", "claim");
    expect(worker.calls).toEqual(["claim"]);
  });
});
