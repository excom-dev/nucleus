import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import catalogJson from "../../data/catalog.json?raw";
import { loadWorker, ORIGIN } from "./backend/worker.mjs";

describe("backend", () => {
  it("passes every scenario check against sw.js and backend/", async () => {
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
});
