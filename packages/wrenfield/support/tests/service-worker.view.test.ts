import { describe, expect, it } from "@excom/nucleus-test";
import { openApp } from "./app";

describe("desktop", () => {
  // The page's fetch reaches the worker's API through the stand-in, not a registered worker: the scenarios, not worker control.
  it("backend scenarios pass in the service worker", async () => {
    const { worker } = await openApp("/", { allow: [/^\w+ \/api\/\S* -> 4\d\d$/] });
    const call = async (method: string, path: string, body?: unknown) => {
      const json = body !== undefined && { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
      const response = await fetch(`/api${path}`, { method, ...json });
      return { status: response.status, body: await response.json() };
    };
    const { failed, total } = await worker.runScenario(call);
    expect(failed).toEqual([]);
    expect(total).toBeGreaterThanOrEqual(166);
  });
});
