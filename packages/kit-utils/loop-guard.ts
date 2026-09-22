/**
 * Cuts runaway write cycles after a fixed hop count. Shared by Quark,
 * Neutron, and any other DOM writer. Depth is carried by address, so
 * neither engine needs to know about the other.
 *
 * - **context**: a reaction (`run(inherited, fn)` at `max(current(), inherited)`).
 * - **write**: `write(target, name, fn)` at `current() + 1`, stamped on
 *   `(target, name)` (attribute, property, binding, or `"content"`).
 * - **trigger**: the next reaction inherits `depthOf(target, name)`.
 *
 * Stamps last this task + its microtasks. A later external write (input,
 * timer, fetch, app JS) starts over at depth 0. Past `limit` the write is
 * dropped and reported once; the document is left as-is.
 *
 * Unguarded writes (`setAttribute` in app JS) neither stamp nor drop.
 * A loop that never hits `write()` is invisible; one that does is cut there.
 */

export type LoopGuardTripKind = "depth" | "batch";

export interface LoopGuardTrip {
  /**
   * `"depth"`: a causal chain of writes exceeded `limit` hops (the write
   * was dropped). `"batch"`: one `BatchManager` handler re-ran more than
   * `limit` times inside a single synchronous flush (the queue was
   * dropped).
   */
  kind: LoopGuardTripKind;
  /** The element / object the dropped write targeted. */
  target: object;
  /** Attribute, property or binding name (`"content"` for child insertions). */
  name: string;
  /** Depth (or run count) that crossed the limit. */
  depth: number;
  limit: number;
  /** Human-readable summary, also passed to the log function. */
  message: string;
}

export type LoopGuardListener = (trip: LoopGuardTrip) => void;
export type LoopGuardLog = (message: string, trip: LoopGuardTrip) => void;

interface Stamp {
  depth: number;
  epoch: number;
}

const DEFAULT_LIMIT = 50;
const defaultLog: LoopGuardLog = (message) => console.error(message);

const STAMPS = new WeakMap<object, Map<string, Stamp>>();
const stack: number[] = [];
const listeners = new Set<LoopGuardListener>();
/** name → epoch of its last report; one report per name per task. */
const reported = new Map<string, number>();
let epoch = 1;
let bumpScheduled = false;
let limit = DEFAULT_LIMIT;
let log: LoopGuardLog = defaultLog;

/** Stamps expire at the next macrotask; one timer per task, only when something was stamped. */
const scheduleEpochBump = () => {
  if (bumpScheduled) return;
  bumpScheduled = true;
  setTimeout(() => {
    bumpScheduled = false;
    epoch++;
  }, 0);
};

const describeTarget = (target: object) =>
  target instanceof Element
    ? `<${target.localName}${target.id ? `#${target.id}` : ""}>`
    : (target?.constructor?.name ?? typeof target);

export const LoopGuard = {
  /** Maximum causal depth (and maximum handler re-runs per batch flush). */
  get limit(): number {
    return limit;
  },

  /** Adjust the limit and/or the log function (defaults: 50, `console.error`). */
  configure(options: { limit?: number; log?: LoopGuardLog } = {}): void {
    if (typeof options.limit === "number" && options.limit > 0) {
      limit = Math.floor(options.limit);
    }
    if (options.log) log = options.log;
  },

  /** Depth of the innermost open context (0 outside any context). */
  current(): number {
    return stack.length ? stack[stack.length - 1] : 0;
  },

  /**
   * Depth stamped on `(target, name)` by a guarded write earlier in this
   * task, or 0 when nothing (or something in an earlier task) wrote it.
   * Triggers call this to inherit the chain they continue.
   */
  depthOf(target: object, name: string): number {
    const stamp = STAMPS.get(target)?.get(name);
    return stamp && stamp.epoch === epoch ? stamp.depth : 0;
  },

  /**
   * Open a context at `max(current(), inherited)` for the duration of `fn`.
   * Pass a depth captured with `current()` to carry a context across an
   * async boundary the engine itself introduces (a deferred paint, a
   * `setTimeout(0)` effect).
   */
  run<T>(inherited: number, fn: () => T): T {
    stack.push(Math.max(LoopGuard.current(), inherited));
    try {
      return fn();
    } finally {
      stack.pop();
    }
  },

  /**
   * Record that `(target, name)` was written at `depth` (default: the depth
   * a `write()` would use) without applying a limit. For writers that want
   * to be *visible* to the chain but never dropped.
   */
  stamp(target: object, name: string, depth = LoopGuard.current() + 1): void {
    let names = STAMPS.get(target);
    if (!names) STAMPS.set(target, (names = new Map()));
    names.set(name, { depth, epoch });
    scheduleEpochBump();
  },

  /**
   * Perform a write as the next hop of the current chain: stamps
   * `(target, name)` at `current() + 1`, then runs `fn` and returns its
   * result. Past the limit the write is **not** performed, the trip is
   * reported, and `false` is returned.
   */
  write<T>(target: object, name: string, fn: () => T): T | false {
    const depth = LoopGuard.current() + 1;
    if (depth > limit) {
      LoopGuard.report({
        kind: "depth",
        target,
        name,
        depth,
        limit,
        message: `Loop guard: a chain of ${depth} dependent writes reached "${name}" on ${describeTarget(target)} — likely an infinite loop between rules, element effects or events; the write was dropped.`,
      });
      return false;
    }
    LoopGuard.stamp(target, name, depth);
    return fn();
  },

  /**
   * Report a trip: logs once per name per task and notifies listeners
   * (every time). Engines use listeners to publish to DevTools.
   */
  report(trip: LoopGuardTrip): void {
    if (reported.get(trip.name) !== epoch) {
      reported.set(trip.name, epoch);
      scheduleEpochBump();
      log(trip.message, trip);
    }
    listeners.forEach((listener) => listener(trip));
  },

  /** Subscribe to trips; returns the unsubscribe function. */
  onTrip(listener: LoopGuardListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Test helper: forget open contexts and stamps, restore the default
   * limit and log. Listeners are kept (engines register theirs once).
   */
  reset(): void {
    stack.length = 0;
    reported.clear();
    epoch++;
    limit = DEFAULT_LIMIT;
    log = defaultLog;
  },
};
