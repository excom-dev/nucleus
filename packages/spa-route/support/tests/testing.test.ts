import {
  afterEach,
  describe,
  expect,
  fixture,
  getEventListeners,
  it,
  vi,
  wait,
} from "@excom/nucleus-test";
import { installViewTransition, navigate, trackUnhandledRejections } from "../../testing";

const doc = document as unknown as { startViewTransition?: unknown };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("navigate", () => {
  it("resolves a task after spa-manager-rendered, leaving no listener or timer", async () => {
    vi.useFakeTimers();
    const manager = fixture("<div></div>");
    let isDone = false;
    const done = navigate(manager, () =>
      manager.dispatchEvent(new Event("spa-manager-rendered")),
    ).then(() => (isDone = true));
    await Promise.resolve();
    expect(isDone).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(getEventListeners(manager)).toEqual({});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects after 1 s without spa-manager-rendered", async () => {
    vi.useFakeTimers();
    const manager = fixture("<div></div>");
    const trigger = vi.fn();
    const outcome = navigate(manager, trigger).then(
      () => "resolved",
      (error: Error) => error.message,
    );
    expect(trigger).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(999);
    expect(getEventListeners(manager)["spa-manager-rendered"]).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("navigate: no spa-manager-rendered within 1 s");
    expect(getEventListeners(manager)).toEqual({});
  });
});

describe("installViewTransition", () => {
  it("skips a transition started on a hidden page, still running the update", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const vt = installViewTransition();
    const update = vi.fn();
    const transition = (document as Document).startViewTransition({ update }) as ViewTransition;
    expect(vt.calls[0].isSkipped).toBe(true);
    await expect(transition.ready).rejects.toMatchObject({ name: "AbortError" });
    await transition.updateCallbackDone;
    expect(update).toHaveBeenCalledOnce();
    expect(vt.calls[0].phase).toBe("updated");
    vt.restore();
  });

  it("restore() puts back the previous startViewTransition, or none", () => {
    const own = () => {};
    doc.startViewTransition = own;
    installViewTransition().restore();
    expect(doc.startViewTransition).toBe(own);
    delete doc.startViewTransition;
    installViewTransition().restore();
    expect(Object.hasOwn(document, "startViewTransition")).toBe(false);
  });
});

describe("trackUnhandledRejections", () => {
  it("records unhandled rejections until stop()", async () => {
    // Vitest's own handler would report the rejection as a test error
    const others = process.rawListeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    try {
      const tracker = trackUnhandledRejections();
      const reason = new Error("leaked");
      Promise.reject(reason);
      await wait(0);
      tracker.stop();
      expect(tracker.reasons).toEqual([reason]);
      expect(process.listenerCount("unhandledRejection")).toBe(0);
    } finally {
      for (const listener of others) process.on("unhandledRejection", listener as never);
    }
  });
});
