import { macrotask } from "./node";
import type { DomWindow } from "./window";

const ACTIVITY = Symbol.for("@excom/nucleus-dom/activity");

/** What a window still waits on, and the timers it holds. */
export interface PendingWork {
  /** Requests in flight: `"GET https://shop.test/api/cart"`. */
  requests: string[];
  /** Delay in ms of each due timeout and running interval. */
  timers: number[];
  /** Animation frames due. */
  frames: number;
  /** Delay in ms of each held timer: never fires, never pending. */
  held: number[];
}

export interface WhenIdleOptions {
  /**
   * Consecutive quiet macrotask checks needed (at least 1).
   * @default 2
   */
  quiet?: number;
  /**
   * Rejects after this many ms, listing the work still pending.
   * @default 2000
   */
  timeout?: number;
}

/** A window's live work, keyed by request / timer / frame handle. */
export interface Activity {
  requests: Map<object, string>;
  timers: Map<unknown, number>;
  frames: Set<unknown>;
  held: Map<unknown, number>;
  /** Cancels every timer, interval and frame; requests in flight finish untracked. */
  cancel(): void;
}

type Callback = (...args: unknown[]) => void;
type Native = (this: DomWindow, ...args: unknown[]) => unknown;

/** The work `createDom()` tracks on `win`, if it made it. */
export const activityOf = (win: object): Activity | undefined =>
  (win as { [ACTIVITY]?: Activity })[ACTIVITY];

/**
 * Tracks `win`'s `fetch()` calls, timers and animation frames. Timers longer
 * than `holdAbove` ms are held: clearable, never fired, never pending. A
 * `fetch()` answered with a network error (`Response.error()`) rejects.
 */
export function trackActivity(win: DomWindow, holdAbove = Infinity): void {
  const {
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    requestAnimationFrame,
    cancelAnimationFrame,
    fetch,
  } = win as unknown as Record<string, Native>;
  const activity: Activity = {
    requests: new Map(),
    timers: new Map(),
    frames: new Set(),
    held: new Map(),
    cancel: () => {
      // happy-dom's clearTimeout also ends intervals
      timers.forEach((_, handle) => clearTimeout.call(win, handle));
      frames.forEach((handle) => cancelAnimationFrame.call(win, handle));
      [requests, timers, frames, held].forEach((work) => work.clear());
    },
  };
  Object.defineProperty(win, ACTIVITY, { value: activity });
  const { requests, timers, frames, held } = activity;
  const schedule =
    (set: Native, once: boolean) =>
    (handler: unknown, delay?: unknown, ...args: unknown[]) => {
      const ms = Number(delay) || 0;
      if (ms > holdAbove) {
        const token = Object.freeze({});
        held.set(token, ms);
        return token;
      }
      const handle = set.call(
        win,
        once
          ? (...params: unknown[]) => {
              timers.delete(handle);
              (handler as Callback)(...params);
            }
          : handler,
        delay,
        ...args
      );
      timers.set(handle, ms);
      return handle;
    };
  const cancel = (clear: Native) => (handle: unknown) => {
    if (held.delete(handle)) return;
    timers.delete(handle);
    clear.call(win, handle);
  };
  // happy-dom's own Request, which every window's extends
  const HappyRequest = Object.getPrototypeOf(win.Request);
  Object.assign(win, {
    setTimeout: schedule(setTimeout, true),
    setInterval: schedule(setInterval, false),
    clearTimeout: cancel(clearTimeout),
    clearInterval: cancel(clearInterval),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const handle = requestAnimationFrame.call(win, (time: number) => {
        frames.delete(handle);
        callback(time);
      });
      frames.add(handle);
      return handle;
    },
    cancelAnimationFrame: (handle: unknown) => {
      frames.delete(handle);
      cancelAnimationFrame.call(win, handle);
    },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      // a fresh Request per call; another runtime's is left for happy-dom to refuse
      const foreign =
        Object.prototype.toString.call(input) === "[object Request]" &&
        !(input instanceof HappyRequest);
      const request = (
        foreign ? input : new win.Request(input, init)
      ) as Request;
      requests.set(request, `${request.method} ${request.url}`);
      try {
        const response = (await fetch.call(win, request)) as Response;
        // a network error rejects, as in browsers
        if (response.type === "error")
          throw new TypeError(`Failed to fetch ${request.url}`);
        return response;
      } finally {
        requests.delete(request);
      }
    },
  });
  // happy-dom's beacon never catches its `fetch()`: a refused one would go unhandled
  win.navigator.sendBeacon = (url, data) => {
    win.fetch(url, { method: "POST", body: data }).catch(() => {});
    return true;
  };
  // on the window's own timer: neither page work nor held
  win.AbortSignal.timeout = (ms) => {
    const controller = new win.AbortController();
    setTimeout.call(
      win,
      () =>
        controller.abort(
          new win.DOMException("signal timed out", "TimeoutError")
        ),
      ms
    );
    return controller.signal;
  };
}

const pendingWork = (win: DomWindow): PendingWork => {
  const activity = activityOf(win);
  if (!activity) throw new TypeError("whenIdle: not a createDom() window");
  // a closed window runs nothing more
  return win.closed
    ? { requests: [], timers: [], frames: 0, held: [] }
    : {
        requests: [...activity.requests.values()],
        timers: [...activity.timers.values()],
        frames: activity.frames.size,
        held: [...activity.held.values()],
      };
};

const summarize = ({ requests, timers, frames }: PendingWork): string =>
  [
    requests.length && `requests: ${requests.join(", ")}`,
    timers.length && `timers: ${timers.map((ms) => `${ms} ms`).join(", ")}`,
    frames && `animation frames: ${frames}`,
  ]
    .filter(Boolean)
    .join("; ");

/**
 * Resolves once `win` is idle: no request in flight, no timer or animation
 * frame due, `quiet` macrotask checks running. Settle a page before reading
 * its HTML (server-side rendering, SSR) or asserting on it in a test.
 * Resolves the last check's `PendingWork` (its `held` timers); rejects after
 * `timeout` ms with an error naming what is pending (`error.pending`).
 * Requests count from `fetch()`, plus `<link>` / `<script>` loads `serve()`
 * answers.
 */
export async function whenIdle(
  win: DomWindow,
  { quiet = 2, timeout = 2000 }: WhenIdleOptions = {}
): Promise<PendingWork> {
  const deadline = Date.now() + timeout;
  for (let calm = 0; ; ) {
    await macrotask();
    const work = pendingWork(win);
    const busy =
      work.requests.length > 0 || work.timers.length > 0 || work.frames > 0;
    calm = busy ? 0 : calm + 1;
    if (calm >= Math.max(1, quiet)) return work;
    if (Date.now() >= deadline)
      throw Object.assign(
        new Error(`whenIdle: busy after ${timeout} ms (${summarize(work)})`),
        { pending: work }
      );
  }
}
