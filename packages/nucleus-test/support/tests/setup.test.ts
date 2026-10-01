import {
  afterEach,
  clearEventListeners,
  click,
  consoleSinks,
  describe,
  expect,
  fixture,
  getEventListeners,
  it,
  summarizeConsoleArg,
  vi,
} from "../../index";
import { guardConsole } from "../../src/console";
import { trackEventListeners } from "../../src/listeners";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("nucleus-dom shims", () => {
  it("are installed, before the registry: the command shim's own listener is not recorded", () => {
    expect(getEventListeners(window)).toEqual({});
    const host = fixture<HTMLElement>(
      `<section><button command="--open" commandfor="cart">Cart</button><dialog id="cart"></dialog></section>`,
    );
    const commands: string[] = [];
    host.querySelector("dialog")!.addEventListener("command", (event) => {
      commands.push((event as Event & { command: string }).command);
    });
    click(host.querySelector("button")!);
    expect(commands).toEqual(["--open"]);
    expect(host.checkVisibility()).toBe(true);
  });
});

describe("listener registry", () => {
  it("records listeners per type on elements, window and document, globally too", () => {
    expect(globalThis.getEventListeners).toBe(getEventListeners);
    expect(globalThis.clearEventListeners).toBe(clearEventListeners);
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

  it("records a listener once when tracking is installed again", () => {
    trackEventListeners();
    const el = fixture<HTMLDivElement>("<div></div>");
    const listener = () => {};
    el.addEventListener("click", listener);
    expect(getEventListeners(el)).toEqual({ click: [listener] });
  });

  it("is shared by every copy of the module (setup and index ship as separate bundles)", async () => {
    const el = fixture<HTMLDivElement>("<div></div>");
    const listener = () => {};
    el.addEventListener("click", listener);
    vi.resetModules();
    const copy = await import("../../src/listeners");
    expect(copy.getEventListeners).not.toBe(getEventListeners);
    expect(copy.getEventListeners(el)).toEqual({ click: [listener] });
    copy.clearEventListeners(el);
    expect(getEventListeners(el)).toEqual({});
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

  it("failures start their stack at the test, not in the plugin", () => {
    const el = fixture<HTMLElement>("<div></div>");
    expect(() => expect(el).equalTag("<span></span>")).toThrow(
      expect.objectContaining({ stack: expect.not.stringMatching(/matchers\.ts/) }),
    );
  });
});

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

describe("console node guard", () => {
  it("forwards every console method with DOM nodes summarized at any nesting", () => {
    const el = fixture<HTMLDivElement>('<div id="host"><span></span></div>');
    const span = el.querySelector("span")!;
    const text = document.createTextNode("t");
    const error = new Error("boom");
    for (const method of ["log", "info", "debug", "warn", "error"] as const) {
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

  it("keeps one guard and one set of sinks across repeats and module copies", async () => {
    const guarded = console.log;
    guardConsole();
    vi.resetModules();
    const copy = await import("../../src/console");
    copy.guardConsole();
    expect(console.log).toBe(guarded);
    expect(copy.consoleSinks).toBe(consoleSinks);
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
