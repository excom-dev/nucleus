/**
 * Small internal modules exercised directly: element state, scope markers,
 * the observer / paint schedulers, AST + selector helpers,
 * logging utils and property construction edge cases.
 */
import { collectUseRules, declarationStrings, viewBlock } from "../../src/ast";
import { Quark } from "../../index";
import { observe, unobserve } from "../../src/observer";
import { PAINT_QUEUES, reqCommit, schedulePaint } from "../../src/paint";
import { Attribute, Variable } from "../../src/properties";
import { getQuarkInternal, QuarkInternal } from "../../src/quark-internal";
import { outermostElements } from "../../src/rule";
import { acquireScopeId, releaseScopeId, SCOPE_ATTR } from "../../src/scope-id";
import { isQuarkBusy, trackPending, whenSettled } from "../../src/settle";
import {
  buildSelectorLine,
  parseCssSelector,
  splitScopePrefix,
} from "../../src/selector-utils";
import { getQuarkHost, getQuarkMin, QuarkLogger } from "../../src/utils";
import { parse } from "@excom/quark-parser";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mount, unregisterAll } from "./helpers";

/** A WeakRef whose target is already gone (GC cannot be forced). */
const deadRef = <T extends object>(): WeakRef<T> => {
  const ref = Object.create(WeakRef.prototype);
  ref.deref = () => undefined;
  return ref;
};

describe("QuarkInternal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs instead of throwing when the element is gone", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getQuarkInternal(deadRef())).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("reuses the existing state object for an element", () => {
    const el = document.createElement("div");
    const internal = getQuarkInternal(el);
    expect(new QuarkInternal(el)).not.toBe(internal);
    expect(getQuarkInternal(el)).toBe(internal);
  });

  it("reports whether a binding write changed the stored value", () => {
    const internal = getQuarkInternal(document.createElement("div"));
    expect(internal.setVar("$a", 1)).toBe(true);
    expect(internal.setVar("$a", 1)).toBe(false);
    expect(internal.setVar("$a", 2)).toBe(true);
    expect(internal.setVar("$o", { x: 1 })).toBe(true);
    expect(internal.setVar("$o", { x: 1 })).toBe(false);
    expect(internal.getVar("$o")).toEqual({ x: 1 });
    expect(internal.deleteVar("$o")).toBe(true);
    expect(internal.deleteVar("$o")).toBe(false);
    expect(internal.hasVar("$o")).toBe(false);
  });

  it("stores modules per sheet, defaulting to the bare bucket", () => {
    const internal = getQuarkInternal(document.createElement("div"));
    internal.setModule("h", undefined, { a: 1 });
    internal.setModule("h", "ns", { b: 2 });
    expect(internal.getModule("h")).toEqual({ a: 1 });
    expect(internal.getModule("h", "ns")).toEqual({ b: 2 });
    expect(internal.getModules("h")).toEqual({
      dfault: { a: 1 },
      ns: { b: 2 },
    });
  });

  it("treats undefined attribute and style values as no-ops", () => {
    const el = document.createElement("div");
    el.setAttribute("data-keep", "1");
    el.style.setProperty("--tone", "warm");
    const internal = getQuarkInternal(el);
    internal.setAttr("h", "data-keep", undefined);
    internal.setStyleProperty("h", "--tone", undefined);
    expect(el.getAttribute("data-keep")).toBe("1");
    expect(el.style.getPropertyValue("--tone")).toBe("warm");
    expect(internal.getAllAttrs("h")).toEqual({});
    internal.setAttr("h", "data-flag", true);
    internal.setAttr("h", "data-keep", false);
    expect(el.getAttribute("data-flag")).toBe("");
    expect(el.hasAttribute("data-keep")).toBe(false);
  });

  it("tracks listeners and attributes per sheet and rule", () => {
    const internal = getQuarkInternal(document.createElement("div"));
    expect(internal.propertyHasBeenSet("h", 1, "variable", "$s")).toBe(false);
    internal.setVar("$s", 1);
    expect(internal.propertyHasBeenSet("h", 1, "variable", "$s")).toBe(true);
    expect(internal.propertyHasBeenSet("h", 1, "listener", "click")).toBe(
      false
    );
    expect(internal.propertyHasBeenSet("h", 1, "attribute", "x")).toBe(false);
  });

  it("swaps, removes and re-adds ordered listeners in place", () => {
    const el = document.createElement("button");
    const internal = getQuarkInternal(el);
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const meta = { eventTypes: ["click"], target: el, options: {} };
    const slot = "@on click";
    internal.setOrderedListeners("h", 1, slot, [a, b], meta);
    el.click();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    // same length: index 1 becomes undefined → listener removed in place
    internal.setOrderedListeners("h", 1, slot, [a, undefined], meta);
    el.click();
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    // index 1 had no listener: nothing to remove, new one added
    internal.setOrderedListeners("h", 1, slot, [a, c], meta);
    el.click();
    expect(c).toHaveBeenCalledTimes(1);
    // different length: everything is torn down and re-added
    internal.setOrderedListeners("h", 1, slot, [c], meta);
    el.click();
    expect(a).toHaveBeenCalledTimes(3);
    expect(c).toHaveBeenCalledTimes(2);
    expect(internal.getListeners("h", 1, slot)).toEqual([c]);
    expect(internal.getListenerMeta("h", 1, slot)).toBe(meta);
    expect(internal.propertyHasBeenSet("h", 1, "listener", slot)).toBe(true);
    // a changed target or option re-registers on the new target
    const other = document.createElement("div");
    const captureMeta = { eventTypes: ["click"], target: other, options: { capture: true } };
    internal.setOrderedListeners("h", 1, slot, [c], captureMeta);
    el.click();
    expect(c).toHaveBeenCalledTimes(2);
    other.click();
    expect(c).toHaveBeenCalledTimes(3);
    // holes in the handler list are kept as slots without a DOM listener
    internal.setOrderedListeners("h", 2, slot, [undefined, a], meta);
    expect(internal.getListeners("h", 2, slot)).toEqual([undefined, a]);
    internal.removeAllListeners("h", 2, slot);
    expect(internal.getListeners("h", 2, slot)).toEqual([]);
    expect(internal.getListenerMeta("h", 2, slot)).toBeUndefined();
    el.click();
    expect(a).toHaveBeenCalledTimes(3);
  });
});

describe("prop subscriptions", () => {
  it("refcounts subscriptions per element and name", async () => {
    const { subscribeProp } = await import("../../src/props");
    const { isObservedProperty } = await import("@excom/kit-utils");
    const el = document.createElement("div");
    const first = subscribeProp(el, "thing");
    const second = subscribeProp(el, "thing");
    expect(isObservedProperty(el, "thing")).toBe(true);
    first();
    expect(isObservedProperty(el, "thing")).toBe(true);
    second();
    expect(isObservedProperty(el, "thing")).toBe(false);
  });
});

describe("scope ids", () => {
  it("reasserts a stripped marker on re-acquire and refcounts release", () => {
    const host = document.createElement("div");
    const id = acquireScopeId(host);
    host.removeAttribute(SCOPE_ATTR);
    expect(acquireScopeId(host)).toBe(id);
    expect(host.getAttribute(SCOPE_ATTR)).toBe(id);
    releaseScopeId(host);
    expect(host.getAttribute(SCOPE_ATTR)).toBe(id);
    releaseScopeId(host);
    expect(host.hasAttribute(SCOPE_ATTR)).toBe(false);
  });

  it("leaves a foreign marker alone and ignores unknown hosts", () => {
    const host = document.createElement("div");
    acquireScopeId(host);
    host.setAttribute(SCOPE_ATTR, "foreign");
    releaseScopeId(host);
    expect(host.getAttribute(SCOPE_ATTR)).toBe("foreign");
    expect(() => releaseScopeId(document.createElement("div"))).not.toThrow();
  });
});

describe("observer", () => {
  it("logs when the host is gone and tolerates a missing observer", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(observe(deadRef<HTMLElement>(), [], () => {})).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    expect(() => unobserve(null, [])).not.toThrow();
  });

  it("reports attribute records and element insertions only", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cb = vi.fn();
    const observer = observe(host, ["data-x"], cb)!;
    host.setAttribute("data-x", "1");
    host.setAttribute("data-other", "1");
    host.appendChild(document.createTextNode("t"));
    host.appendChild(document.createElement("span"));
    await wait(0);
    expect(cb.mock.calls.map(([arg]) => arg.attribute)).toEqual([
      "data-x",
      "content",
    ]);
    observer.disconnect();
    host.remove();
  });

  it("reports a class record only when a named class token flips", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cb = vi.fn();
    const observer = observe(host, ["class"], cb, {
      classNames: new Set(["is-on"]),
    })!;
    host.className = "fade";
    host.classList.add("highlight");
    host.setAttribute("class", host.getAttribute("class")!);
    await wait(0);
    expect(cb).not.toHaveBeenCalled();

    host.classList.add("is-on");
    await wait(0);
    expect(cb).toHaveBeenCalledTimes(1);

    // removed and re-added in one batch: conservative, the re-add's record
    // still differs from the current value (a rule re-run is harmless)
    host.classList.remove("is-on");
    host.classList.add("is-on");
    await wait(0);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(host.className).toBe("fade highlight is-on");
    observer.disconnect();

    const all = vi.fn();
    const unfiltered = observe(host, ["class"], all)!;
    host.classList.add("other");
    await wait(0);
    expect(all).toHaveBeenCalledTimes(1);
    unfiltered.disconnect();
    host.remove();
  });
});

describe("paint scheduler", () => {
  // one test below fakes timers; make sure a failure there cannot leak them
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedupes commit callbacks and runs them once per tick", async () => {
    const a = vi.fn();
    const b = vi.fn();
    reqCommit(a);
    reqCommit(b);
    reqCommit(a);
    await wait(0);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("runs high-priority paints before low-priority ones", async () => {
    const order: string[] = [];
    schedulePaint(() => order.push("low"));
    schedulePaint(() => order.push("high"), 0);
    await wait(0);
    expect(order).toEqual(["high", "low"]);
    expect(PAINT_QUEUES.every((q) => q.size === 0)).toBe(true);
  });

  it("commits a paint scheduled during a commit in the next commit", async () => {
    const order: string[] = [];
    schedulePaint(() => {
      order.push("first");
      schedulePaint(() => order.push("nested"));
    });
    await wait(0);
    expect(order).toEqual(["first"]);
    await wait(0);
    expect(order).toEqual(["first", "nested"]);
  });

  it("logs a throwing paint and still commits the others", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    schedulePaint(() => order.push("before"));
    schedulePaint(() => {
      throw new Error("boom");
    });
    schedulePaint(() => order.push("after"));
    await wait(0);
    expect(order).toEqual(["before", "after"]);
    expect(PAINT_QUEUES.every((q) => q.size === 0)).toBe(true);
    expect(error).toHaveBeenCalled();
    // the failed paint is not retried on the next commit
    schedulePaint(() => order.push("next"));
    await wait(0);
    expect(order).toEqual(["before", "after", "next"]);
    error.mockRestore();
  });

  // Fake timers: the held paint is asserted to still be held after the plain
  // one commits, which a real `wait(0)` can outlive once the 20ms delay does.
  it("holds a paint with a transition delay back, then commits it", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    schedulePaint(() => order.push("delayed"), 1, {
      transition: { types: [], timeout: 50, delay: 20, ifActive: "skip", source: "@view-transition" },
    });
    schedulePaint(() => order.push("plain"));
    // a held paint is not queued: nothing is busy on its behalf
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["plain"]);
    expect(isQuarkBusy()).toBe(false);
    await vi.advanceTimersByTimeAsync(30);
    expect(order).toEqual(["plain", "delayed"]);
    vi.useRealTimers();
  });
});

describe("settle", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
  });

  it("resolves settled once nothing is queued, and reports queued paints as busy", async () => {
    expect(await whenSettled()).toBe("settled");
    let painted = false;
    schedulePaint(() => {
      painted = true;
    });
    expect(isQuarkBusy()).toBe(true);
    expect(await whenSettled()).toBe("settled");
    expect(painted).toBe(true);
    expect(isQuarkBusy()).toBe(false);
    expect(Quark.whenSettled).toBe(whenSettled);
  });

  it("waits for tracked async work on a connected element, and ignores it once detached", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    let release!: () => void;
    const work = new Promise<void>((resolve) => (release = resolve));
    trackPending(work, host);
    expect(isQuarkBusy()).toBe(true);
    const settled = whenSettled({ timeout: 500 });
    await wait(5);
    release();
    expect(await settled).toBe("settled");
    // a never-settling promise stops counting when its element leaves
    trackPending(new Promise(() => {}), host);
    expect(isQuarkBusy()).toBe(true);
    host.remove();
    expect(isQuarkBusy()).toBe(false);
  });

  it("counts element-less work until it settles", async () => {
    let release!: () => void;
    trackPending(new Promise<void>((resolve) => (release = resolve)));
    expect(isQuarkBusy()).toBe(true);
    release();
    await wait(0);
    expect(isQuarkBusy()).toBe(false);
  });

  it("resolves timeout when Quark stays busy past the cap", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    trackPending(new Promise(() => {}), host);
    const start = Date.now();
    expect(await whenSettled({ timeout: 30 })).toBe("timeout");
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it("waits until the owner matches a selector, or leaves the document", async () => {
    const owner = document.createElement("div");
    document.body.append(owner);
    const matched = whenSettled({
      timeout: 500,
      until: { selector: "[is-success]", owner: new WeakRef(owner) },
    });
    await wait(10);
    owner.setAttribute("is-success", "");
    expect(await matched).toBe("until");
    const never = whenSettled({
      timeout: 30,
      until: { selector: "[is-error]", owner: new WeakRef(owner) },
    });
    expect(await never).toBe("timeout");
    const removed = whenSettled({
      timeout: 500,
      until: { selector: "[is-error]", owner: new WeakRef(owner) },
    });
    owner.remove();
    expect(await removed).toBe("until");
  });

  it("waits until a thenable settles either way", async () => {
    let reject!: (reason: unknown) => void;
    const thenable = new Promise((_, r) => (reject = r));
    const settled = whenSettled({ timeout: 500, until: { thenable } });
    await wait(10);
    reject(new Error("nope"));
    expect(await settled).toBe("until");
  });

  it("is busy while a registered sheet loads its @use modules", async () => {
    const original = Quark.moduleLoader;
    let release!: (mod: Record<string, unknown>) => void;
    Quark.moduleLoader = () => new Promise((resolve) => (release = resolve));
    try {
      const { root } = mount(`<p id="out"></p>`, `@use "/slow.js" as *; #out { content: greet(); }`);
      await wait(5);
      expect(isQuarkBusy()).toBe(true);
      const settled = whenSettled({ timeout: 500 });
      release({ greet: () => "hi" });
      expect(await settled).toBe("settled");
      expect(root.querySelector("#out")!.textContent).toBe("hi");
    } finally {
      Quark.moduleLoader = original;
    }
  });
});

describe("utils", () => {
  it("falls back to body for document-level hosts", () => {
    expect(getQuarkHost(null)).toBe(document.body);
    expect(getQuarkHost(document.documentElement)).toBe(document.body);
    const div = document.createElement("div");
    expect(getQuarkHost(div)).toBe(div);
    expect(getQuarkMin(undefined as unknown as string)).toBe("");
  });

  it("formats log payloads with and without run context", () => {
    const full = QuarkLogger.formatArgs([
      "name",
      {
        method: "run",
        sheetId: 1,
        runId: "abc",
        ruleId: 2,
        options: {},
        extra: 1,
      },
    ]);
    expect(full[0]).toBe("");
    expect(full).toContain("sheet: 1  | ");
    expect(full).toContain("  |  extra: ");
    const bare = QuarkLogger.formatArgs(["name", {}]);
    expect(bare[0]).toBe("    ");
    expect(bare).not.toContain("sheet: 1  | ");
    expect(bare.at(-1)).toBe("  |  (name)");
  });
});

describe("ast helpers", () => {
  it("splits a block into the statements Quark executes", () => {
    const src =
      'p { @use "/a.js"; /* note */ content: "a"; @warn "w"; @on click { x: 1; } }';
    const body = (parse(src).body[0] as any).block.body;
    const view = viewBlock(body);
    expect(
      view.declarations.map((d) => declarationStrings(d, src).key)
    ).toEqual(["content"]);
    expect(view.diagnostics.map((d) => d.name)).toEqual(["warn"]);
    expect(view.listeners).toHaveLength(1);
  });

  it("collects @use rules through blocks and skips blockless at-rules", () => {
    const src = '@warn "x"; @scope { @use "/a"; p { @use "/b"; } }';
    const uses = collectUseRules(parse(src).body);
    expect(uses.map((u) => u.url)).toEqual(["/a", "/b"]);
  });
});

describe("selector utils", () => {
  it("substitutes & inside pseudo-class arguments", () => {
    expect(buildSelectorLine("span:not(&)", "div")).toBe("span:not(div)");
    expect(buildSelectorLine("li:nth-child(2)", "ul")).toBe(
      "ul li:nth-child(2)"
    );
    expect(buildSelectorLine("", "ul")).toBe("");
  });

  it("only honours :scope in the first compound", () => {
    expect(splitScopePrefix("div :scope")).toEqual({
      hostCompound: null,
      rest: "div :scope",
    });
    expect(splitScopePrefix(":scope[is-on] > span")).toEqual({
      hostCompound: "[is-on]",
      rest: "> span",
    });
  });

  it("collects observed attributes from nested pseudo-classes", () => {
    const { path, attrs } = parseCssSelector(
      "div:not([data-a]) > [data-b]:has([q-x], [data-c])"
    );
    expect(path).toEqual([
      "div:not([data-a])",
      ">",
      "[data-b]:has([q-x], [data-c])",
    ]);
    expect([...attrs].sort()).toEqual(["data-a", "data-b", "data-c"]);
    // a leading combinator (the remainder of `:scope > span`) has no compound before it
    expect(parseCssSelector("> span").path).toEqual([">", "span"]);
  });
});

describe("outermostElements", () => {
  it("keeps one entry per outermost element, dropping duplicates", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("span");
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(outermostElements([inner, outer, inner])).toEqual([outer]);
    expect(outermostElements([inner])).toEqual([inner]);
    outer.remove();
  });
});

describe("Property construction", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("logs an invalid expression and stays inert", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const parent = { observedAttrs: new Set<string>() } as any;
    const attribute = new Attribute({ key: "data-x", value: "1 ?", parent });
    expect(attribute.parsedValue).toBeNull();
    expect(attribute.isReactive).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("dispatches a def written outside a run immediately", async () => {
    const { root, quark } = mount(
      `<article><p bind-x></p></article>`,
      `article { $n: 1; }
       [bind-x] { content: $n; }`
    );
    await flush();
    const article = root.querySelector("article") as HTMLElement;
    const def = quark.rules[0].variables[0] as Variable;
    def.value = "2";
    // no run in flight (no trace) → writeBinding dispatches the event itself
    def.run(article, {});
    await flush();
    expect(root.querySelector("[bind-x]")?.textContent).toBe("2");
  });
});
