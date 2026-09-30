import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import { createDom, type DomWindow, pinMutationObservers } from "../../index";

/** V8's collector, when the runtime lets a running process expose it. */
const gc = (() => {
  try {
    setFlagsFromString("--expose-gc");
    return runInNewContext("gc") as () => void;
  } catch {
    return undefined;
  }
})();

const macrotask = () => new Promise((resolve) => setTimeout(resolve));

/** Records seen by an observer nothing else references, across a forced GC. */
const recordsAfterGc = async (win: DomWindow) => {
  const el = win.document.body.appendChild(win.document.createElement("div"));
  const records: MutationRecord[] = [];
  new win.MutationObserver((list) => records.push(...list)).observe(el, { attributes: true });
  await macrotask();
  gc!();
  el.setAttribute("x", "1");
  await macrotask();
  return records.length;
};

const pinsOf = (observer: MutationObserver): Set<unknown> => {
  const key = Object.getOwnPropertySymbols(observer).find(
    (symbol) => symbol.description === "mutation-observer-pins",
  )!;
  return (observer as unknown as Record<symbol, Set<unknown>>)[key];
};

describe.runIf(gc)("MutationObserver pin under a forced GC", () => {
  it("happy-dom alone drops the observer", async () => {
    const win = new Window();
    expect(await recordsAfterGc(win as unknown as DomWindow)).toBe(0);
    await win.happyDOM.close();
  });

  it("keeps the observer delivering", async () => {
    const { window, dispose } = createDom();
    expect(await recordsAfterGc(window)).toBe(1);
    await dispose();
  });
});

describe("MutationObserver pin", () => {
  it("pins each observer's own closure while it observes", async () => {
    const { window, document, dispose } = createDom();
    const el = document.body.appendChild(document.createElement("div"));
    el.append(document.createElement("span"));
    const other = new window.MutationObserver(() => {});
    other.observe(el, { attributes: true });
    const records: MutationRecord[] = [];
    const observer = new window.MutationObserver((list) => records.push(...list));
    observer.observe(el, { attributes: true, subtree: true });
    const pins = pinsOf(observer);
    expect(pins.size).toBe(1);
    expect([...pins]).not.toEqual([...pinsOf(other)]);
    // Observing the same target again only updates its options.
    observer.observe(el, { attributes: true, subtree: true, childList: true });
    expect(pins.size).toBe(1);
    el.firstElementChild!.setAttribute("x", "1");
    await Promise.resolve();
    expect(records).toHaveLength(1);
    observer.disconnect();
    expect(pins.size).toBe(0);
    observer.observe(el, { childList: true });
    expect(pins.size).toBe(1);
    await dispose();
  });

  it("keeps happy-dom's errors for invalid targets and options", async () => {
    const { window, document, dispose } = createDom();
    const observer = new window.MutationObserver(() => {});
    expect(() => observer.observe(null as unknown as Node, { attributes: true })).toThrow(
      window.TypeError,
    );
    expect(() => observer.observe(document.body, {})).toThrow(window.TypeError);
    expect(pinsOf(observer)).toBeUndefined();
    await dispose();
  });

  it("observes through a listener whose callback is held strongly", () => {
    const registry = Symbol("mutationListeners");
    const document = { [registry]: [] as unknown[] };
    class MutationObserver {
      observe(target: typeof document) {
        target[registry].push({ callback: () => {} });
      }
      disconnect() {}
    }
    pinMutationObservers({ document, MutationObserver } as unknown as DomWindow);
    const observer = new MutationObserver();
    expect(() => observer.observe(document)).not.toThrow();
    expect(pinsOf(observer as unknown as globalThis.MutationObserver)).toBeUndefined();
  });

  it("leaves a DOM without happy-dom's listener registry alone", () => {
    class MutationObserver {
      observe() {}
    }
    const observe = MutationObserver.prototype.observe;
    pinMutationObservers({ document: {}, MutationObserver } as unknown as DomWindow);
    expect(MutationObserver.prototype.observe).toBe(observe);
  });
});
