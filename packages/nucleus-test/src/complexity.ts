import { afterEach, beforeEach, expect, vi } from "vitest";

/** Fixes `take()`'s key order: engine counters, then DOM calls. */
const METRICS = [
  "quarkRuns",
  "ruleRuns",
  "variableRuns",
  "attributeRuns",
  "listenerRuns",
  "setVar",
  "getVar",
  "schedulePaint",
  "querySelectorAll",
  "queryScopeCost",
  "matches",
  "closest",
  "parentElement",
  "parentNode",
  "setAttribute",
  "removeAttribute",
  "textContent",
  "importNode",
] as const;

export type ComplexityMetric = (typeof METRICS)[number];

/**
 * Units of work (not time) done while measuring. Engine metrics come from
 * the `EngineMeter` (0 when it has no such count); DOM metrics count the
 * calls the code under test makes on the prototypes, not what the DOM
 * emulation does to answer a selector (browsers match natively, reading no
 * `parentNode`). `queryScopeCost`: each of the engine's per-rule subtree
 * queries adds the number of elements it scanned, sampled at `take()`.
 */
export type ComplexityBudget = Record<ComplexityMetric, number>;

/**
 * An engine's own work counters (`Quark.meter` is one). `scopeSelectors()`
 * names the engine's per-rule subtree queries, the only queries whose scan
 * size means something; without it, `queryScopeCost` is 0.
 */
export interface EngineMeter {
  readonly counts: Readonly<Record<string, number>>;
  reset(): void;
  scopeSelectors?(): Iterable<string>;
}

/** Elements in `el`'s subtree, the scan breadth of a query rooted there. */
const countDescendants = (el: Element): number =>
  [...el.children].reduce((n, child) => n + 1 + countDescendants(child), 0);

/**
 * Count work from now: resets the engine's counters and spies the DOM.
 * `take()` after the work settles; `stop()` restores the prototypes. For
 * observer-driven cases, make the triggering DOM writes before measuring
 * so the harness's own mutations are not counted.
 */
export const measureComplexity = (engine: EngineMeter) => {
  engine.reset();
  const spies = {
    querySelectorAll: vi.spyOn(Element.prototype, "querySelectorAll"),
    matches: vi.spyOn(Element.prototype, "matches"),
    closest: vi.spyOn(Element.prototype, "closest"),
    // upward traversal (binding resolution walks ancestors)
    parentElement: vi.spyOn(Node.prototype, "parentElement", "get"),
    parentNode: vi.spyOn(Node.prototype, "parentNode", "get"),
    setAttribute: vi.spyOn(Element.prototype, "setAttribute"),
    removeAttribute: vi.spyOn(Element.prototype, "removeAttribute"),
    textContent: vi.spyOn(Element.prototype, "textContent", "set"),
    importNode: vi.spyOn(document, "importNode"),
  };
  // subtrees sampled post-settle: rendered rows count toward their scope
  const queryScopeCost = () => {
    const selectors = new Set(engine.scopeSelectors?.());
    const { calls, contexts } = spies.querySelectorAll.mock;
    return calls.reduce(
      (total, [selector], i) =>
        selectors.has(selector)
          ? total + countDescendants(contexts[i] as Element)
          : total,
      0
    );
  };
  return {
    take: (): ComplexityBudget => {
      const { counts } = engine;
      return Object.fromEntries(
        METRICS.map((metric) => [
          metric,
          metric === "queryScopeCost"
            ? queryScopeCost()
            : metric in spies
              ? spies[metric as keyof typeof spies].mock.calls.length
              : (counts[metric] ?? 0),
        ])
      ) as ComplexityBudget;
    },
    stop: () => Object.values(spies).forEach((spy) => spy.mockRestore()),
  };
};

/** Match the test's `complexity` snapshot. */
export const expectComplexity = (budget: ComplexityBudget) => {
  expect(budget).toMatchSnapshot("complexity");
};

/**
 * Snapshot the complexity of every passing test in the file (or
 * `describe`), measured from `beforeEach` to `afterEach` after `settle`.
 * It shares and resets the engine's counters with `measureComplexity`: use
 * one or the other in a file.
 */
export const trackComplexity = (
  engine: EngineMeter,
  { settle }: { settle?: () => Promise<unknown> } = {}
) => {
  let meter: ReturnType<typeof measureComplexity>;
  beforeEach(() => {
    meter = measureComplexity(engine);
  });
  // after hooks run last-registered first: call this after DOM teardown hooks
  afterEach(async ({ task }) => {
    try {
      // a failed test would record a broken baseline
      if (task.result?.state === "fail") return;
      await settle?.();
      expectComplexity(meter.take());
    } finally {
      meter.stop();
    }
  });
};
