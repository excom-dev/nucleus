import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fixture,
  HTTP_STATUS_TEXT,
  spyFetch,
  wait,
  waitForEvent,
} from "../../profiles/default/config/test-utils";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("fixture / wait", () => {
  it("mounts HTML and returns the first element", () => {
    const el = fixture<HTMLParagraphElement>("<p id=\"a\">a</p><p>b</p>");
    expect(el.tagName).toBe("P");
    expect(el.id).toBe("a");
    expect(el.isConnected).toBe(true);
  });

  it("wait resolves after the delay", async () => {
    vi.useFakeTimers();
    const p = wait(50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBe(true);
    const zero = wait();
    await vi.advanceTimersByTimeAsync(0);
    await expect(zero).resolves.toBe(true);
  });
});

describe("waitForEvent", () => {
  it("resolves when the event fires and removes the listener", async () => {
    const el = fixture<HTMLDivElement>("<div></div>");
    const trigger = vi.fn(() => el.dispatchEvent(new CustomEvent("ping")));
    await waitForEvent(el, "ping", trigger);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(getEventListeners(el)).toEqual({});
  });

  it("waits the extra delay before resolving", async () => {
    vi.useFakeTimers();
    const el = fixture<HTMLDivElement>("<div></div>");
    let settled = false;
    const p = waitForEvent(el, "ping", undefined, 100).then(() => {
      settled = true;
    });
    el.dispatchEvent(new CustomEvent("ping"));
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
  });

  it("rejects after one second without the event and cleans up", async () => {
    vi.useFakeTimers();
    const el = fixture<HTMLDivElement>("<div></div>");
    const p = waitForEvent(el, "never");
    const outcome = p.then(
      () => "resolved",
      (e) => e,
    );
    expect(getEventListeners(el).never).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBe(
      'Waiting for event "never" on element `div` timed out after 1s',
    );
    expect(getEventListeners(el)).toEqual({});
  });
});

describe("spyFetch", () => {
  it("resolves a JSON response with defaults", async () => {
    vi.useFakeTimers();
    const spy = spyFetch({ body: '{"a":1}' });
    const p = fetch("/api");
    await vi.advanceTimersByTimeAsync(0);
    const res = await p;
    expect(spy).toHaveBeenCalledWith("/api");
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("honours a response factory, delay, status, headers and flag overrides", async () => {
    vi.useFakeTimers();
    const factory = vi.fn(() => ({
      status: 404,
      headers: new Headers({ "x-custom": "yes" }),
      ok: false,
      redirected: true,
      type: "opaque" as ResponseType,
      url: "https://example.test/x",
    }));
    spyFetch(factory, 250);
    const p = fetch("/missing");
    await vi.advanceTimersByTimeAsync(249);
    expect(factory).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const res = await p;
    expect(res.status).toBe(404);
    expect(res.statusText).toBe(HTTP_STATUS_TEXT[404]);
    expect(res.headers.get("x-custom")).toBe("yes");
    expect(res.headers.get("content-type")).toBeNull();
    expect(res.ok).toBe(false);
    expect(res.redirected).toBe(true);
    expect(res.type).toBe("opaque");
    expect(res.url).toBe("https://example.test/x");
  });

  it("keeps an explicit statusText and unknown status codes", async () => {
    vi.useFakeTimers();
    spyFetch({ status: 418, statusText: "Teapot", body: null });
    const p = fetch("/tea");
    await vi.advanceTimersByTimeAsync(0);
    const res = await p;
    expect(res.status).toBe(418);
    expect(res.statusText).toBe("Teapot");
    expect(res.body).toBeNull();
  });
});
