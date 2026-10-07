import { Quark } from "../../index";
import { QuarkRegistry } from "../../src/quark";
import { isQuarkBusy } from "../../src/settle";
import type { QuarkOptions } from "../../src/types";
import {
  fixture,
  measureComplexity as measureEngine,
  vi,
  wait,
} from "@excom/nucleus-test";

/**
 * Sheet + targets must share a parent (Quark host = sheetElement.parent).
 * Sheets are host-scoped by default (quark-sheet's default). Pass
 * `{ isScoped: false }` for global (root-context) sheets.
 */
export const createSheet = (
  bodyHtml: string,
  src: string,
  modules?: Record<string, unknown>,
  options?: QuarkOptions
) => {
  const root = fixture<HTMLElement>(
    `<section><div id="sheet"></div>${bodyHtml}</section>`
  );
  const sheetElement = root.querySelector("#sheet") as HTMLElement;
  const quark = new Quark({ src, options: { isScoped: true, ...options } });
  const register = () =>
    quark.register({
      sheetElement,
      ...(modules ? { modules: { dfault: modules } } : {}),
    });
  return { root, quark, sheetElement, register };
};

export const mount = (
  bodyHtml: string,
  src: string,
  modules?: Record<string, unknown>,
  options?: QuarkOptions
) => {
  const sheet = createSheet(bodyHtml, src, modules, options);
  sheet.register();
  return sheet;
};

/**
 * Unregister every sheet still registered. Sheets listen for provision /
 * binding events on the document root, so one left registered by an
 * earlier test keeps matching (until its host is GC'd, which makes
 * complexity counts depend on GC timing). Call from `afterEach`.
 */
export const unregisterAll = () => {
  QuarkRegistry.sheets.forEach((ref) => {
    const sheet = ref.deref();
    if (sheet?.isRegistered) sheet.unregister();
  });
};

/**
 * Quark settles across MutationObserver + double setTimeout(0) rule
 * runs + paint commit. Four macrotasks cover most observer-driven
 * updates. A paint queued at the last tick (first-run `iterate()` whose
 * rows then bind their content) needs one more, so keep waiting while
 * the engine reports work (`isQuarkBusy`: queued elements, a run in
 * flight, paints waiting to commit, async content or `@use` modules
 * pending).
 */
export const flush = async () => {
  await wait(0);
  await wait(0);
  await wait(0);
  await wait(0);
  for (let i = 0; i < 16 && isQuarkBusy(); i++) await wait(0);
};

export { type ComplexityBudget, expectComplexity } from "@excom/nucleus-test";

/**
 * `measureComplexity` from `@excom/nucleus-test`, scoped to one sheet.
 * `Quark.meter` is engine-wide, but these snapshots were taken per sheet:
 * `quarkRuns`, `ruleRuns` and the subtree-query selectors stay this sheet's.
 *
 * Do not spy `queueRunRules` after `register()`: MutationObserver
 * closes over the original function at observe time.
 */
export const measureComplexity = (quark: Quark) => {
  const ruleRuns = () => quark.rules.reduce((n, r) => n + r.numberOfRuns, 0);
  const ruleRunsBefore = ruleRuns();
  const runSpy = vi.spyOn(quark, "run");
  const meter = measureEngine({
    get counts() {
      return {
        ...Quark.meter.counts,
        quarkRuns: runSpy.mock.calls.length,
        ruleRuns: ruleRuns() - ruleRunsBefore,
      };
    },
    reset: Quark.meter.reset,
    scopeSelectors: () =>
      quark.rules.flatMap((r) => [r.matchSelector, r.scopedSelector()]),
  });
  return {
    take: meter.take,
    stop: () => {
      runSpy.mockRestore();
      meter.stop();
    },
  };
};

/** One `document.startViewTransition()` call seen by the stub. */
export type StubViewTransition = {
  types: Set<string>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  finished: Promise<void>;
  /** `update` was invoked / its promise settled. */
  isUpdating: boolean;
  isUpdated: boolean;
  isSkipped: boolean;
  skipTransition: () => void;
  /**
   * Invoke `update` (once) and resolve when it settled. Automatic a task
   * after the call unless the stub was installed with `autoUpdate: false`.
   */
  runUpdate: () => Promise<void>;
};

/**
 * Browser-like `document.startViewTransition` for happy-dom (which has
 * none). Like Chromium: `update` runs a task later (after the old-state
 * capture), `updateCallbackDone` / `ready` settle with it, `finished`
 * after `animationMs`; `document.activeViewTransition` is set meanwhile,
 * and starting a transition while one is active skips the active one.
 * Pass `withTypes: false` for an engine that rejects the options object
 * (no transition types), and
 * `autoUpdate: false` to call each transition's `runUpdate()` yourself
 * (to assert the pending phase). `restore()` removes it again.
 */
export const installViewTransitionStub = ({
  animationMs = 0,
  withTypes = true,
  autoUpdate = true,
}: { animationMs?: number; withTypes?: boolean; autoUpdate?: boolean } = {}) => {
  const doc = document as Document & Record<string, any>;
  const calls: StubViewTransition[] = [];
  doc.startViewTransition = (
    arg?: (() => unknown) | { update?: () => unknown; types?: string[] }
  ) => {
    if (typeof arg !== "function" && !withTypes) {
      throw new TypeError("parameter 1 is not of type 'Function'");
    }
    const update = typeof arg === "function" ? arg : arg?.update;
    const types = new Set(typeof arg === "function" ? [] : (arg?.types ?? []));
    let settleUpdate!: (error?: unknown) => void;
    let finish!: () => void;
    const updateCallbackDone = new Promise<void>((resolve, reject) => {
      settleUpdate = (error) => (error ? reject(error) : resolve());
    });
    const finished = new Promise<void>((resolve) => (finish = resolve));
    let updating: Promise<void> | undefined;
    const transition: StubViewTransition = {
      types,
      ready: updateCallbackDone,
      updateCallbackDone,
      finished,
      isUpdating: false,
      isUpdated: false,
      isSkipped: false,
      skipTransition: () => {
        transition.isSkipped = true;
        finish();
      },
      runUpdate: () =>
        (updating ??= (async () => {
          transition.isUpdating = true;
          try {
            await update?.();
            transition.isUpdated = true;
            settleUpdate();
          } catch (error) {
            settleUpdate(error);
          }
          setTimeout(finish, animationMs);
        })()),
    };
    const active = doc.activeViewTransition as StubViewTransition | undefined;
    active?.skipTransition();
    doc.activeViewTransition = transition;
    finished.then(() => {
      if (doc.activeViewTransition === transition) {
        doc.activeViewTransition = null;
      }
    });
    calls.push(transition);
    // the stub never lets a rejected `updateCallbackDone` go unhandled
    updateCallbackDone.catch(() => {});
    if (autoUpdate) setTimeout(transition.runUpdate, 0);
    return transition;
  };
  return {
    calls,
    restore: () => {
      delete doc.startViewTransition;
      delete doc.activeViewTransition;
    },
  };
};