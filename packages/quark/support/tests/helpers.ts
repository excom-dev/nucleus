import { Quark } from "../../index";
import * as paint from "../../src/paint";
import { QuarkRegistry } from "../../src/quark";
import { isQuarkBusy } from "../../src/settle";
import { Attribute, Listener, Variable } from "../../src/properties";
import { QuarkInternal } from "../../src/quark-internal";
import type { QuarkOptions } from "../../src/types";
import {
  expect,
  fixture,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";

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

export type ComplexityBudget = {
  quarkRuns: number;
  ruleRuns: number;
  variableRuns: number;
  attributeRuns: number;
  listenerRuns: number;
  setVar: number;
  getVar: number;
  schedulePaint: number;
  querySelectorAll: number;
  /**
   * Weighted cost of rule fan-out queries
   * (`ancestor.querySelectorAll(sel)` in Rule._run): each call adds the
   * number of elements in the scanned subtree. Lower means the
   * nearest-common-ancestor logic rooted queries deeper.
   */
  queryScopeCost: number;
  matches: number;
  closest: number;
  parentElement: number;
  setAttribute: number;
  removeAttribute: number;
  textContent: number;
  importNode: number;
};

/**
 * Count Quark work units (not wall-clock). Snapshots are the regression
 * baseline.
 *
 * Start measuring before the work under test; call `take()` after it
 * settles. For observer-driven cases, apply triggering DOM writes
 * *before* measuring so harness mutations are not counted.
 *
 * Do not spy `queueRunRules` after `register()`: MutationObserver
 * closes over the original function at observe time.
 */
/** Elements in `el`'s subtree, the scan breadth of a query rooted there. */
const countDescendants = (el: Element): number => {
  let count = 0;
  for (const child of el.children) count += 1 + countDescendants(child);
  return count;
};

export const measureComplexity = (quark: Quark) => {
  const ruleRunsBefore = quark.rules.reduce((n, r) => n + r.numberOfRuns, 0);
  /*
   * Fan-out queries are identifiable by selector: scoped rules query
   * with their `[q-scope="<id>"]`-prefixed selector (id exists only
   * after register, so collect lazily in take()); unscoped with the
   * bare one.
   */
  const ruleSelectors = () =>
    new Set(quark.rules.flatMap((r) => [r.matchSelector, r.scopedSelector()]));

  const runSpy = vi.spyOn(quark, "run");
  // Property executions by kind, the primary "work done" regression signal.
  const variableRunSpy = vi.spyOn(Variable.prototype, "_run");
  const attributeRunSpy = vi.spyOn(Attribute.prototype, "_run");
  const listenerRunSpy = vi.spyOn(Listener.prototype, "_run");
  // Element-state traffic (_q_): variable binding writes and reads.
  const setVarSpy = vi.spyOn(QuarkInternal.prototype, "setVar");
  const getVarSpy = vi.spyOn(QuarkInternal.prototype, "getVar");
  const paintSpy = vi.spyOn(paint, "schedulePaint");
  const qsaSpy = vi.spyOn(Element.prototype, "querySelectorAll");
  const matchesSpy = vi.spyOn(Element.prototype, "matches");
  const closestSpy = vi.spyOn(Element.prototype, "closest");
  // upward traversal cost, binding resolution walks ancestors via
  // `el.parentElement` (findBindingOwner in src/bindings.ts)
  const parentElementSpy = vi.spyOn(Node.prototype, "parentElement", "get");
  const setAttrSpy = vi.spyOn(Element.prototype, "setAttribute");
  const removeAttrSpy = vi.spyOn(Element.prototype, "removeAttribute");
  const textContentSpy = vi.spyOn(Element.prototype, "textContent", "set");
  const importNodeSpy = vi.spyOn(document, "importNode");

  return {
    take: (): ComplexityBudget => ({
      quarkRuns: runSpy.mock.calls.length,
      ruleRuns:
        quark.rules.reduce((n, r) => n + r.numberOfRuns, 0) - ruleRunsBefore,
      variableRuns: variableRunSpy.mock.calls.length,
      attributeRuns: attributeRunSpy.mock.calls.length,
      listenerRuns: listenerRunSpy.mock.calls.length,
      setVar: setVarSpy.mock.calls.length,
      getVar: getVarSpy.mock.calls.length,
      schedulePaint: paintSpy.mock.calls.length,
      querySelectorAll: qsaSpy.mock.calls.length,
      // subtree sizes are sampled at take() time (post-settle), so rendered
      // rows count toward the scope they were rendered into
      queryScopeCost: (() => {
        const selectors = ruleSelectors();
        return qsaSpy.mock.calls.reduce(
          (total, [selector], i) =>
            selectors.has(selector as string)
              ? total + countDescendants(qsaSpy.mock.contexts[i] as Element)
              : total,
          0
        );
      })(),
      matches: matchesSpy.mock.calls.length,
      closest: closestSpy.mock.calls.length,
      parentElement: parentElementSpy.mock.calls.length,
      setAttribute: setAttrSpy.mock.calls.length,
      removeAttribute: removeAttrSpy.mock.calls.length,
      textContent: textContentSpy.mock.calls.length,
      importNode: importNodeSpy.mock.calls.length,
    }),
    stop: () => {
      runSpy.mockRestore();
      variableRunSpy.mockRestore();
      attributeRunSpy.mockRestore();
      listenerRunSpy.mockRestore();
      setVarSpy.mockRestore();
      getVarSpy.mockRestore();
      paintSpy.mockRestore();
      qsaSpy.mockRestore();
      matchesSpy.mockRestore();
      closestSpy.mockRestore();
      parentElementSpy.mockRestore();
      setAttrSpy.mockRestore();
      removeAttrSpy.mockRestore();
      textContentSpy.mockRestore();
      importNodeSpy.mockRestore();
    },
  };
};

export const expectComplexity = (budget: ComplexityBudget) => {
  expect(budget).toMatchSnapshot("complexity");
};

/**
 * happy-dom caches `matches()` / `querySelectorAll()` per node and only
 * drops the cache when that node, or a node the match walked through,
 * changes. A `:has()` or sibling-combinator result goes stale after a
 * descendant / sibling changes on its own. Browsers do not cache. Call
 * from `beforeAll` in suites that rely on those selectors; returns the
 * restore function for `afterAll`.
 */
export const bypassSelectorCache = () => {
  const cacheOf = (node: Node) => {
    const sym = Object.getOwnPropertySymbols(node).find(
      (s) => s.description === "cache"
    );
    return sym
      ? (
          node as unknown as Record<
            symbol,
            Record<string, Map<string, unknown>>
          >
        )[sym]
      : undefined;
  };
  const patch = <T extends Node>(
    proto: T,
    name: "matches" | "querySelectorAll"
  ) => {
    const original = (proto as unknown as Record<string, Function>)[name];
    (proto as unknown as Record<string, Function>)[name] = function (
      this: Node,
      selector: string
    ) {
      cacheOf(this)?.[name]?.delete(selector);
      return original.call(this, selector);
    };
    return () => {
      (proto as unknown as Record<string, Function>)[name] = original;
    };
  };
  const restores = [
    patch(Element.prototype, "matches"),
    patch(Element.prototype, "querySelectorAll"),
    patch(Document.prototype, "querySelectorAll"),
  ];
  return () => restores.forEach((restore) => restore());
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