import { describe, expect, it, vi } from "@excom/heft-rig/node_modules/vitest";
import { createDom, type DomWindow, whenIdle } from "../../index";

/** Node's own timer: test waits never run on the window under test. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A window whose requests wait `ms`, then answer "ok" (`/down`: a network error). */
const slowServer = (ms: number) =>
  createDom({
    settings: {
      fetch: {
        interceptor: {
          beforeAsyncRequest: async ({ request, window }) => {
            await sleep(ms);
            return request.url.endsWith("/down") ? window.Response.error() : new window.Response("ok");
          },
        },
      },
    },
  });

describe("whenIdle", () => {
  it("waits for requests, timers and animation frames", async () => {
    const { window, dispose } = slowServer(30);
    const done: string[] = [];
    window.setTimeout(() => done.push("timer"), 40);
    window.requestAnimationFrame(() => done.push("frame"));
    void window.fetch("/data.json").then(async (response) => done.push(await response.text()));
    const work = await whenIdle(window);
    expect(done.sort()).toEqual(["frame", "ok", "timer"]);
    expect(work).toEqual({ requests: [], timers: [], frames: 0, held: [] });
    await dispose();
  });

  it("waits out a chain of zero-delay timeouts", async () => {
    const { window, dispose } = createDom();
    const ticks: number[] = [];
    const tick = (n: number) => window.setTimeout(() => (ticks.push(n), n < 5 && tick(n + 1)));
    tick(1);
    await whenIdle(window, { quiet: 1 });
    expect(ticks).toEqual([1, 2, 3, 4, 5]);
    await dispose();
  });

  it("counts a running interval and drops cleared timers and frames", async () => {
    const { window, dispose } = createDom();
    const interval = window.setInterval(() => {}, 5);
    await expect(whenIdle(window, { timeout: 30 })).rejects.toMatchObject({ pending: { timers: [5] } });
    window.clearInterval(interval);
    window.clearTimeout(window.setTimeout(() => {}, 1000));
    window.cancelAnimationFrame(window.requestAnimationFrame(() => {}));
    expect(await whenIdle(window)).toEqual({ requests: [], timers: [], frames: 0, held: [] });
    await dispose();
  });

  it("rejects after its timeout, naming what is pending", async () => {
    const { window, dispose } = slowServer(200);
    window.setTimeout(() => {}, 5000);
    const loop = () => window.requestAnimationFrame(loop);
    loop();
    void window.fetch("/slow", { method: "POST", body: "x" });
    const error = await whenIdle(window, { timeout: 50 }).catch((error: Error & { pending: unknown }) => error);
    expect(error.message).toBe(
      "whenIdle: busy after 50 ms (requests: POST http://localhost/slow; timers: 5000 ms; animation frames: 1)",
    );
    expect(error.pending).toEqual({ requests: ["POST http://localhost/slow"], timers: [5000], frames: 1, held: [] });
    await dispose();
  });

  it("reports no work for a closed window and refuses one createDom() did not make", async () => {
    const { window, dispose } = createDom({ holdTimersAbove: 100 });
    window.setTimeout(() => {}, 50);
    window.setTimeout(() => {}, 1000);
    await dispose();
    expect(await whenIdle(window)).toEqual({ requests: [], timers: [], frames: 0, held: [] });
    await expect(whenIdle(globalThis as DomWindow)).rejects.toThrow("whenIdle: not a createDom() window");
  });

  it("checks at least once, whatever quiet asks", async () => {
    const { window, dispose } = createDom();
    const ran = vi.fn();
    window.setTimeout(ran, 30);
    await whenIdle(window, { quiet: 0 });
    expect(ran).toHaveBeenCalledOnce();
    await dispose();
  });

  it("times AbortSignal.timeout() apart from the page: never pending, never held", async () => {
    const { window, dispose } = createDom({ holdTimersAbove: 50 });
    const held = window.AbortSignal.timeout(80);
    const started = Date.now();
    expect(await whenIdle(window)).toEqual({ requests: [], timers: [], frames: 0, held: [] });
    expect(Date.now() - started).toBeLessThan(80);
    await sleep(120);
    expect([held.aborted, (held.reason as DOMException).name]).toEqual([true, "TimeoutError"]);
    await dispose();
  });
});

describe("window fetch()", () => {
  it("rejects on a network error, takes a Request and keeps the window's errors", async () => {
    const { window, dispose } = slowServer(0);
    await expect(window.fetch("/down")).rejects.toThrow(new TypeError("Failed to fetch http://localhost/down"));
    const request = new window.Request("/data.json", { method: "POST", body: "x" });
    expect(await (await window.fetch(request)).text()).toBe("ok");
    expect(await (await window.fetch(request.clone(), { method: "PUT" })).text()).toBe("ok");
    await dispose();
    await expect(window.fetch("/data.json")).rejects.toThrow("The window is closed");
  });

  it("tracks each call of one Request, and leaves another runtime's Request to happy-dom", async () => {
    const delays = [10, 100];
    const { window, dispose } = createDom({
      settings: {
        fetch: {
          interceptor: {
            beforeAsyncRequest: async ({ window: page }) => {
              await sleep(delays.shift()!);
              return new page.Response("ok");
            },
          },
        },
      },
    });
    const request = new window.Request("/data.json");
    const [first, second] = [window.fetch(request), window.fetch(request)];
    await first;
    await expect(whenIdle(window, { timeout: 30 })).rejects.toMatchObject({
      pending: { requests: ["GET http://localhost/data.json"] },
    });
    await second;
    const foreign = { url: "https://cdn.test/x", method: "GET", [Symbol.toStringTag]: "Request" };
    await expect(window.fetch(foreign as unknown as Request)).rejects.toThrow("Unknown request object");
    await dispose();
  });

  it("swallows a refused beacon instead of leaving a rejection unhandled", async () => {
    const { window, dispose } = slowServer(0);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      expect(window.navigator.sendBeacon("/down", "event")).toBe(true);
      await whenIdle(window);
      await sleep(10);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
    await dispose();
  });
});

describe("createDom({ holdTimersAbove })", () => {
  it("holds a 3 s timeout: it never fires and whenIdle does not wait for it", async () => {
    const { window, dispose } = createDom({ holdTimersAbove: 1000 });
    const held = vi.fn();
    const due = vi.fn();
    const started = Date.now();
    window.setTimeout(held, 3000);
    window.setTimeout(due, 1000, "arg");
    expect(await whenIdle(window)).toEqual({ requests: [], timers: [], frames: 0, held: [3000] });
    expect(Date.now() - started).toBeLessThan(2000);
    expect([held.mock.calls, due.mock.calls]).toEqual([[], [["arg"]]]);
    await dispose();
  });

  it("never fires a held timeout or interval, and clears either", async () => {
    const { window, dispose } = createDom({ holdTimersAbove: 10 });
    const callback = vi.fn();
    const timeout = window.setTimeout(callback, 50);
    const interval = window.setInterval(callback, 20);
    window.setTimeout(callback, 30);
    expect((await whenIdle(window)).held).toEqual([50, 20, 30]);
    window.clearTimeout(timeout);
    window.clearInterval(interval);
    await sleep(80);
    expect(callback).not.toHaveBeenCalled();
    expect((await whenIdle(window)).held).toEqual([30]);
    await dispose();
  });
});
