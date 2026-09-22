import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture } from "../../profiles/default/config/test-utils";
import { consoleSinks, summarizeConsoleArg } from "../../profiles/default/config/setup";

afterEach(() => {
  document.body.innerHTML = "";
  clearEventListeners(window);
  clearEventListeners(document);
});

describe("event listener tracking", () => {
  it("records listeners per type on elements, window and document", () => {
    const el = fixture<HTMLDivElement>("<div></div>");
    const a = () => {};
    const b = () => {};
    expect(getEventListeners(el)).toEqual({});
    el.addEventListener("click", a);
    el.addEventListener("click", b, { passive: true });
    el.addEventListener("keydown", a);
    expect(getEventListeners(el)).toEqual({ click: [a, b], keydown: [a] });

    el.removeEventListener("click", a);
    expect(getEventListeners(el)).toEqual({ click: [b], keydown: [a] });
    // Removing an unknown listener or type is a no-op.
    el.removeEventListener("click", () => {});
    el.removeEventListener("nope", a);
    el.removeEventListener("keydown", a);
    expect(getEventListeners(el)).toEqual({ click: [b] });

    clearEventListeners(el);
    expect(getEventListeners(el)).toEqual({});

    window.addEventListener("resize", a);
    document.addEventListener("visibilitychange", b);
    expect(getEventListeners(window)).toEqual({ resize: [a] });
    expect(getEventListeners(document)).toEqual({ visibilitychange: [b] });
    window.removeEventListener("resize", a);
    document.removeEventListener("visibilitychange", b);
    expect(getEventListeners(window)).toEqual({});
    expect(getEventListeners(document)).toEqual({});
  });

  it("tolerates removing from a target that never registered anything", () => {
    const target = new EventTarget();
    target.removeEventListener("x", () => {});
    expect(getEventListeners(target)).toEqual({});
  });
});

describe("MutationObserver pin", () => {
  it("holds a strong reference to happy-dom's weakly-held dispatch closure", async () => {
    const el = fixture<HTMLDivElement>("<div><span></span></div>");
    const records: MutationRecord[][] = [];
    const observer = new MutationObserver((list) => records.push(list));
    observer.observe(el, { attributes: true, subtree: true });
    // happy-dom registers one listener object on the target (and, for
    // subtree, on every descendant) whose `callback` is a WeakRef.
    const symbols = Object.getOwnPropertySymbols(observer);
    const pinKey = symbols.find((s) => s.description === "mutation-observer-pins")!;
    expect(pinKey).toBeDefined();
    const pins = (observer as any)[pinKey] as Set<unknown>;
    expect(pins.size).toBe(1);
    const [closure] = pins;
    expect(typeof closure).toBe("function");
    // the pinned function is the one happy-dom dispatches through
    el.firstElementChild!.setAttribute("x", "1");
    await Promise.resolve();
    expect(records.length).toBe(1);
    // disconnect releases the pin
    observer.disconnect();
    expect(pins.size).toBe(0);
    // observing again re-pins
    observer.observe(el, { childList: true });
    expect(pins.size).toBe(1);
    observer.disconnect();
  });
});

describe("querySelector shims", () => {
  it("matches against the document but never returns the context node", () => {
    const root = fixture<HTMLElement>(
      `<section class="a"><p class="a">inner</p><div><p class="a">deep</p></div></section>`,
    );
    document.body.insertAdjacentHTML("afterbegin", `<p class="a">outside</p>`);
    expect(root.querySelector(".a")!.textContent).toBe("inner");
    expect(root.querySelectorAll(".a")).toHaveLength(2);
    expect(root.querySelector("section")).toBeNull();
    expect(root.querySelector("nothing")).toBeNull();
    // Ancestor compounds outside the root participate.
    expect(root.querySelector("body > div > section > div > p")!.textContent).toBe("deep");
    expect(root.querySelector("body > p")).toBeNull();
  });

  it("resolves :scope against the context node and cleans up the marker", () => {
    const root = fixture<HTMLElement>(`<ul><li>1<ul><li>nested</li></ul></li><li>2</li></ul>`);
    const direct = root.querySelectorAll(":scope > li");
    expect(direct).toHaveLength(2);
    expect(root.querySelector(":scope > li")!.textContent).toBe("1nested");
    expect(root.attributes).toHaveLength(0);
  });

  it("falls back to the native subtree query for disconnected nodes", () => {
    const div = document.createElement("div");
    div.innerHTML = `<template id="t"><b>x</b></template><b class="b">y</b>`;
    expect(div.isConnected).toBe(false);
    expect(div.querySelector("template")!.id).toBe("t");
    expect(div.querySelectorAll("b")).toHaveLength(1);
    expect(div.querySelector(":scope > .b")!.textContent).toBe("y");
    expect(div.attributes).toHaveLength(0);
  });
});

describe("chai extensions", () => {
  it("equalTag compares the element shell, ignoring its children", () => {
    const el = fixture<HTMLElement>(`<my-el data-x="1"><p>child</p></my-el>`);
    expect(el).equalTag(`<my-el data-x="1"></my-el>`);
    expect(el).equalTag(`<my-el data-x="1" data-y="2"></my-el>`, {
      ignoreAttributes: ["data-y"],
    });
    expect(() => expect(el).equalTag(`<my-el data-x="2"></my-el>`)).toThrow();
  });

  it("toMatchListeners requires the exact listener counts", () => {
    const el = fixture<HTMLElement>("<div></div>");
    el.addEventListener("click", () => {});
    el.addEventListener("click", () => {});
    el.addEventListener("input", () => {});
    expect(el).toMatchListeners({ click: 2, input: 1 });
    expect(() => expect(el).toMatchListeners({ click: 2 })).toThrow(
      /expected listeners .* to match/,
    );
    expect(() => expect(el).not.toMatchListeners({ click: 2, input: 1 })).toThrow(
      /to not match/,
    );
    const empty = fixture<HTMLElement>("<span></span>");
    expect(empty).toMatchListeners({});
  });

  it("toContainListeners only checks the listed types", () => {
    const el = fixture<HTMLElement>("<div></div>");
    el.addEventListener("click", () => {});
    el.addEventListener("input", () => {});
    expect(el).toContainListeners({ click: 1 });
    expect(el).toContainListeners({ missing: 0 });
    expect(() => expect(el).toContainListeners({ click: 2 })).toThrow(/to match/);
    expect(() => expect(el).toContainListeners({ missing: 1 })).toThrow(/to match/);
    expect(() => expect(el).not.toContainListeners({ click: 1 })).toThrow(/to not match/);
  });
});

describe("environment shims", () => {
  it("serialises elements as diffable HTML in snapshots", () => {
    const el = fixture<HTMLElement>(`<div class="x"><span>hi</span></div>`);
    expect(el).toMatchInlineSnapshot(`
      <div class="x">
        <span>
          hi
        </span>
      </div>
    `);
  });

  it("reports every element as visible and stubs ServiceWorkerContainer", () => {
    const el = fixture<HTMLElement>("<div hidden></div>");
    expect(el.checkVisibility()).toBe(true);
    expect(typeof (globalThis as { ServiceWorkerContainer?: unknown }).ServiceWorkerContainer).toBe("function");
  });
});

describe("console node guard", () => {
  it("forwards every console method with DOM nodes summarized at any nesting", () => {
    const el = fixture<HTMLDivElement>('<div id="host"><span></span></div>');
    const span = el.querySelector("span")!;
    const text = document.createTextNode("t");
    const error = new Error("boom");
    for (const method of ["log", "info", "debug", "warn", "error"] as const) {
      expect((console[method] as any)[Symbol.for("heft-rig.console-node-guard")]).toBe(true);
      const sink = consoleSinks[method];
      const calls: unknown[][] = [];
      consoleSinks[method] = (...args) => {
        calls.push(args);
      };
      try {
        console[method]("msg", el, { element: span, list: [text, 1], error }, 3);
      } finally {
        consoleSinks[method] = sink;
      }
      expect(calls).toEqual([
        [
          "msg",
          "<div#host>",
          { element: "<span>", list: [`[Node type=${Node.TEXT_NODE}]`, 1], error },
          3,
        ],
      ]);
    }
  });

  it("summarizeConsoleArg is cycle-safe, depth-limited and leaves non-plain values alone", () => {
    const el = fixture<HTMLDivElement>('<b id="x"></b>');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(summarizeConsoleArg(cyclic)).toEqual({ self: "[Circular]" });
    const arr: unknown[] = [];
    arr.push(arr);
    expect(summarizeConsoleArg(arr)).toEqual(["[Circular]"]);
    let deep: Record<string, unknown> = { el };
    for (let i = 0; i < 8; i++) deep = { deep };
    let cursor: any = summarizeConsoleArg(deep);
    for (let i = 0; i < 6; i++) cursor = cursor.deep;
    expect(cursor).toBe((deep as any).deep.deep.deep.deep.deep.deep);
    class Thing {}
    const thing = new Thing();
    expect(summarizeConsoleArg(thing)).toBe(thing);
    expect(summarizeConsoleArg(Object.create(null))).toEqual({});
    expect(summarizeConsoleArg("s")).toBe("s");
    expect(summarizeConsoleArg(null)).toBe(null);
  });
});
