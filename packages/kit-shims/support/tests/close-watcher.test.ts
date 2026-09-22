import { CloseWatcher, requestIdleCb } from "../../index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

/** Dispatch a keydown that the polyfill treats as user-triggered. */
const pressKey = (key: string, { prevent = false } = {}) => {
  const evt = new KeyboardEvent("keydown", { key, cancelable: true });
  // happy-dom does not model `isTrusted`; the polyfill only honours trusted keydowns.
  Object.defineProperty(evt, "isTrusted", { value: true });
  if (prevent) {
    document.addEventListener("keydown", (e) => e.preventDefault(), {
      once: true,
    });
  }
  document.dispatchEvent(evt);
  return evt;
};

describe("index", () => {
  it("re-exports the shims", () => {
    expect(typeof CloseWatcher).toBe("function");
    expect(typeof requestIdleCb).toBe("function");
  });
});

describe("CloseWatcher", () => {
  const live: CloseWatcher[] = [];
  const make = (opts?: { signal?: AbortSignal }) => {
    const w = new CloseWatcher(opts);
    live.push(w);
    return w;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Empty the module-level stack so tests stay independent.
    while (live.length) live.pop()!.destroy();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is an EventTarget", () => {
    const w = make();
    expect(w).toBeInstanceOf(EventTarget);
  });

  it("close() fires close once and then deactivates", () => {
    const w = make();
    const onClose = vi.fn();
    w.addEventListener("close", onClose);
    w.close();
    w.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("requestClose() fires cancel then close", () => {
    const w = make();
    const order: string[] = [];
    w.addEventListener("cancel", () => order.push("cancel"));
    w.addEventListener("close", () => order.push("close"));
    w.requestClose();
    expect(order).toEqual(["cancel", "close"]);
    // Deactivated: subsequent calls are no-ops.
    w.requestClose();
    w.close();
    expect(order).toEqual(["cancel", "close"]);
  });

  it("cancel event is cancelable and preventDefault() stops close", () => {
    const w = make();
    const onClose = vi.fn();
    let cancelable = false;
    w.addEventListener("cancel", (e) => {
      cancelable = e.cancelable;
      e.preventDefault();
    });
    w.addEventListener("close", onClose);
    w.requestClose();
    expect(cancelable).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    // Still active: a later requestClose without preventDefault closes.
    w.addEventListener("cancel", (e) => e.stopImmediatePropagation(), {
      capture: true,
    });
    w.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("re-entrant requestClose() from inside cancel is ignored", () => {
    const w = make();
    const onCancel = vi.fn(() => w.requestClose());
    const onClose = vi.fn();
    w.addEventListener("cancel", onCancel);
    w.addEventListener("close", onClose);
    w.requestClose();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("destroy() deactivates without firing events", () => {
    const w = make();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    w.addEventListener("cancel", onCancel);
    w.addEventListener("close", onClose);
    w.destroy();
    w.requestClose();
    w.close();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an already-aborted signal creates an inactive watcher", () => {
    const ac = new AbortController();
    ac.abort();
    const w = make({ signal: ac.signal });
    const onClose = vi.fn();
    w.addEventListener("close", onClose);
    w.requestClose();
    w.close();
    expect(onClose).not.toHaveBeenCalled();
    // Not on the stack: Escape reaches nobody.
    pressKey("Escape");
    vi.runAllTimers();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("aborting the signal later destroys the watcher", () => {
    const ac = new AbortController();
    const w = make({ signal: ac.signal });
    const onClose = vi.fn();
    w.addEventListener("close", onClose);
    ac.abort();
    w.close();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape keydown requests close on the top-most watcher only", () => {
    const first = make();
    const second = make();
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    first.addEventListener("close", firstClose);
    second.addEventListener("close", secondClose);

    pressKey("Escape");
    // Delivered on a queued task so other keydown listeners run first.
    expect(secondClose).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(secondClose).toHaveBeenCalledTimes(1);
    expect(firstClose).not.toHaveBeenCalled();

    // The stack unwinds: next Escape hits the first watcher.
    pressKey("Escape");
    vi.runAllTimers();
    expect(firstClose).toHaveBeenCalledTimes(1);
  });

  it("destroying a watcher mid-stack removes it from the stack", () => {
    const bottom = make();
    const middle = make();
    const top = make();
    const closes = { bottom: vi.fn(), middle: vi.fn(), top: vi.fn() };
    bottom.addEventListener("close", closes.bottom);
    middle.addEventListener("close", closes.middle);
    top.addEventListener("close", closes.top);

    middle.destroy();
    pressKey("Escape");
    vi.runAllTimers();
    pressKey("Escape");
    vi.runAllTimers();
    expect(closes.top).toHaveBeenCalledTimes(1);
    expect(closes.bottom).toHaveBeenCalledTimes(1);
    expect(closes.middle).not.toHaveBeenCalled();
  });

  it("ignores Escape when another listener prevented default", () => {
    const w = make();
    const onClose = vi.fn();
    w.addEventListener("close", onClose);
    pressKey("Escape", { prevent: true });
    vi.runAllTimers();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores non-Escape keys and untrusted keydowns", () => {
    const w = make();
    const onClose = vi.fn();
    w.addEventListener("close", onClose);
    pressKey("Enter");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    vi.runAllTimers();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape with an empty stack is a no-op", () => {
    expect(() => {
      pressKey("Escape");
      vi.runAllTimers();
    }).not.toThrow();
  });

  it("oncancel / onclose accessors", () => {
    const w = make();
    const handler = () => {};
    expect(w.oncancel).toBeNull();
    expect(w.onclose).toBeNull();
    w.oncancel = handler as any;
    w.onclose = handler as any;
    w.oncancel = null;
    w.onclose = null;
    expect(w.oncancel).toBeNull();
    expect(w.onclose).toBeNull();
  });
});
