/**
 * Quiescence: whether Quark still has work queued, and a promise for the
 * moment it has none.
 *
 * Busy sources register a predicate (`paint.ts`: queued paints or a
 * pending commit; `quark.ts`: registered sheets with a queued / running
 * rule pass or `@use` modules still loading). `trackPending` covers
 * promises whose settlement schedules Quark work (async `content`), for
 * as long as the element they render into is connected.
 *
 * `whenSettled` polls once per macrotask, the engine's own cadence (rule
 * passes debounce on `setTimeout(0)`, paints commit on one): a write's
 * MutationObserver records deliver as microtasks and mark the sheet busy
 * before the next check, so "idle at a macrotask boundary" is settled.
 * Used inside a view transition's `update` (see `paint.ts`) and exposed
 * as `Quark.whenSettled()` for tests and tools; sheets have no
 * after-render hook.
 */
import { tc } from "@excom/kit-utils";

const busyChecks: Array<() => boolean> = [];
const pendingWork = new Set<{ ref?: WeakRef<Element> }>();

/** Register a predicate that reports queued Quark work. */
export const addBusyCheck = (check: () => boolean): void => {
  busyChecks.push(check);
};

/**
 * Count `promise` as pending Quark work until it settles. With `element`,
 * only while that element is connected (a detached target cannot paint
 * anything visible, and must not pin the engine busy forever).
 */
export const trackPending = (
  promise: PromiseLike<unknown>,
  element?: Element
): void => {
  const entry = { ref: element ? new WeakRef(element) : undefined };
  pendingWork.add(entry);
  const done = () => {
    pendingWork.delete(entry);
  };
  promise.then(done, done);
};

const hasPendingWork = (): boolean => {
  for (const entry of pendingWork) {
    if (!entry.ref) return true;
    const element = entry.ref.deref();
    if (!element) pendingWork.delete(entry);
    else if (element.isConnected) return true;
  }
  return false;
};

/** True while any Quark work is queued, running or awaited. */
export const isQuarkBusy = (): boolean =>
  hasPendingWork() || busyChecks.some((check) => check());

/** What a settle wait also waits for (`@view-transition (until: …)`). */
export type SettleUntil =
  /** `owner` matches `selector` (or leaves the document). */
  | { selector: string; owner: WeakRef<Element> }
  /** The thenable settles, either way. */
  | { thenable: PromiseLike<unknown> };

export interface SettleOptions {
  /** Cap in milliseconds; the promise resolves `"timeout"` after it. */
  timeout?: number;
  until?: SettleUntil;
}

/** `"until"` when an `until` condition was met and Quark then settled. */
export type SettleResult = "settled" | "until" | "timeout";

export const DEFAULT_SETTLE_TIMEOUT = 1000;

/**
 * Resolve once Quark is idle (and `until`, when given, is met), or when
 * `timeout` elapses. Never rejects.
 */
export const whenSettled = ({
  timeout = DEFAULT_SETTLE_TIMEOUT,
  until,
}: SettleOptions = {}): Promise<SettleResult> =>
  new Promise((resolve) => {
    let isMet = !until;
    let isDone = false;
    const finish = (result: SettleResult) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(cap);
      resolve(result);
    };
    const cap = setTimeout(() => finish("timeout"), timeout);
    if (until && "thenable" in until) {
      const met = () => {
        isMet = true;
      };
      Promise.resolve(until.thenable).then(met, met);
    }
    const check = () => {
      if (isDone) return;
      if (!isMet && until && "selector" in until) {
        const owner = until.owner.deref();
        isMet =
          !owner?.isConnected ||
          tc(() => owner.matches(until.selector)) === true;
      }
      if (isMet && !isQuarkBusy()) {
        finish(until ? "until" : "settled");
        return;
      }
      setTimeout(check, 0);
    };
    setTimeout(check, 0);
  });
