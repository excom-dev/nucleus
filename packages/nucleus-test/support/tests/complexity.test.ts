import {
  afterEach,
  type ComplexityMetric,
  describe,
  type EngineMeter,
  expect,
  fixture,
  it,
  measureComplexity,
  trackComplexity,
  vi,
} from "../../index";

/** A stand-in engine: counts it is handed, `reset()` zeroes them. */
const stubEngine = (
  counts: Record<string, number> = {},
  scopeSelectors?: string[]
) => ({
  counts,
  reset: vi.fn(() =>
    Object.keys(counts).forEach((key) => {
      counts[key] = 0;
    })
  ),
  ...(scopeSelectors ? { scopeSelectors: () => scopeSelectors } : {}),
});

/** Own descriptors of every member `measureComplexity` spies. */
const spiedMembers = () =>
  (
    [
      [Element.prototype, "querySelectorAll"],
      [Element.prototype, "matches"],
      [Element.prototype, "closest"],
      [Node.prototype, "parentElement"],
      [Node.prototype, "parentNode"],
      [Element.prototype, "setAttribute"],
      [Element.prototype, "removeAttribute"],
      [Element.prototype, "textContent"],
      [document, "importNode"],
    ] as const
  ).map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));

/** Before any spy: what every `stop()` must leave behind. */
const pristine = spiedMembers();

// no `vi.restoreAllMocks()`: each meter must restore what it spied
afterEach(() => {
  document.body.innerHTML = "";
});

describe("measureComplexity", () => {
  it("resets the engine and reads its counts, 0 for any it lacks", () => {
    const engine = stubEngine({ quarkRuns: 5, getVar: 2 });
    const meter = measureComplexity(engine);
    expect(engine.reset).toHaveBeenCalledOnce();
    engine.counts.quarkRuns = 3;
    const budget = meter.take();
    meter.stop();
    expect(Object.keys(budget)).toEqual([
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
    ]);
    expect(budget).toMatchObject({ quarkRuns: 3, getVar: 0, ruleRuns: 0 });
  });

  it.each<[ComplexityMetric, (p: Element) => unknown]>([
    ["setAttribute", (p) => p.setAttribute("a", "")],
    ["removeAttribute", (p) => p.removeAttribute("a")],
    ["textContent", (p) => (p.textContent = "x")],
    ["importNode", (p) => document.importNode(p, true)],
    ["parentElement", (p) => p.parentElement],
    ["parentNode", (p) => p.parentNode],
    ["matches", (p) => p.matches("p")],
    ["closest", (p) => p.closest("div")],
    ["querySelectorAll", (p) => p.querySelectorAll("b")],
  ])("counts %s calls", (metric, call) => {
    const p = fixture("<div><p></p></div>").querySelector("p") as Element;
    const meter = measureComplexity(stubEngine());
    call(p);
    const count = meter.take()[metric];
    meter.stop();
    expect(count).toBe(1);
  });

  it("counts the calls the code makes, not the climbing that answers a selector", () => {
    const root = fixture("<section><ul><li></li><li></li></ul></section>");
    const li = root.querySelector("li") as Element;
    const meter = measureComplexity(stubEngine());
    const answers = [
      li.matches("section li"),
      li.closest("ul > li") === li,
      root.querySelectorAll("li ~ li").length,
    ];
    const budget = meter.take();
    meter.stop();
    expect(answers).toEqual([true, true, 1]);
    expect(budget).toMatchObject({
      matches: 1,
      closest: 1,
      querySelectorAll: 1,
      parentElement: 0,
      parentNode: 0,
    });
  });

  it("weighs the engine's scope queries by subtree size at take()", () => {
    const root = fixture(
      `<section><ul><li></li><li></li></ul><p></p></section>`
    );
    const ul = root.querySelector("ul") as Element;
    const meter = measureComplexity(stubEngine({}, ["li"]));
    root.querySelectorAll("li");
    ul.querySelectorAll("li");
    root.querySelectorAll("p");
    // rendered after the query, still in the scanned scope
    ul.append(document.createElement("li"));
    const budget = meter.take();
    meter.stop();
    expect(budget).toMatchObject({
      querySelectorAll: 3,
      queryScopeCost: 5 + 3,
    });
  });

  it("has no scope cost when the engine names no scope queries", () => {
    const root = fixture("<section><p></p></section>");
    const meter = measureComplexity(stubEngine());
    root.querySelectorAll("p");
    const budget = meter.take();
    meter.stop();
    expect(budget).toMatchObject({ querySelectorAll: 1, queryScopeCost: 0 });
  });

  it("stop() restores every member it spied", () => {
    const before = spiedMembers();
    const meter = measureComplexity(stubEngine() satisfies EngineMeter);
    expect(vi.isMockFunction(Element.prototype.setAttribute)).toBe(true);
    meter.stop();
    expect(spiedMembers()).toEqual(before);
    expect(vi.isMockFunction(Element.prototype.setAttribute)).toBe(false);
    expect(Object.hasOwn(document, "importNode")).toBe(false);
  });
});

describe("trackComplexity", () => {
  // registered first, so it runs after trackComplexity's hook
  afterEach(() => {
    expect(spiedMembers()).toEqual(pristine);
  });
  const engine = stubEngine({ quarkRuns: 0 });
  // settle runs before the snapshot: its write is counted
  const settle = vi.fn(async () => document.body.setAttribute("settled", ""));
  trackComplexity(engine, { settle });

  it("snapshots each test's work", () => {
    engine.counts.quarkRuns = 2;
    fixture("<p></p>").setAttribute("a", "");
  });

  it("starts every test from zero", () => {
    expect(engine.reset).toHaveBeenCalledTimes(2);
    expect(settle).toHaveBeenCalledOnce();
  });
});

describe("trackComplexity on a failed test", () => {
  const settle = vi.fn(async () => {});

  describe("tracked", () => {
    trackComplexity(stubEngine(), { settle });
    it.fails("fails on purpose", () => {
      throw new Error("fails on purpose");
    });
  });

  it("skips the snapshot and still restores the DOM", () => {
    // the hook returns before `settle`, the step ahead of the snapshot
    expect(settle).not.toHaveBeenCalled();
    expect(spiedMembers()).toEqual(pristine);
  });
});
