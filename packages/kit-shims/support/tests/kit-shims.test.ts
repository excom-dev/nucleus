import { requestIdleCb } from "../../index";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/node_modules/vitest";

describe("requestIdleCb", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("falls back to setTimeout when requestIdleCallback is missing", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const id = requestIdleCb(cb, 10);
    expect(id).toBeTruthy();
    vi.advanceTimersByTime(10);
    expect(cb).toHaveBeenCalled();
  });

  it("provides didTimeout and timeRemaining in fallback", () => {
    vi.useFakeTimers();
    let received: any;
    requestIdleCb((arg) => {
      received = arg;
    }, 5);
    vi.advanceTimersByTime(5);
    expect(received).toBeDefined();
    expect(received.didTimeout).toBe(false);
    expect(typeof received.timeRemaining).toBe("function");
    expect(received.timeRemaining()).toBeGreaterThanOrEqual(0);
    expect(received.timeRemaining()).toBeLessThanOrEqual(50);
  });

  it("uses default fallback delay of 1ms", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    requestIdleCb(cb);
    vi.advanceTimersByTime(0);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalled();
  });

  it("uses native requestIdleCallback when available", () => {
    const nativeCb = vi.fn((cb) => {
      cb();
      return 99;
    });
    vi.stubGlobal("requestIdleCallback", nativeCb);
    const handler = vi.fn();
    requestIdleCb(handler, 17);
    expect(nativeCb).toHaveBeenCalledWith(handler, { timeout: 17 });
    expect(handler).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

