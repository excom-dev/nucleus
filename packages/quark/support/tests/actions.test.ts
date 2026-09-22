/**
 * `@dispatch` / `@command` statements: the outgoing half of `@on`. They
 * run at the end of an `@on` block (after its writes are queued, before
 * they paint), evaluate their options per event, and are one loop-guard
 * hop each. Rule-level use is refused at build.
 */
import { Quark } from "../../index";
import type { QuarkRenderer } from "../../src/devtools-hook";
import { QuarkLogger } from "../../src/utils";
import {
  type DevtoolsHook,
  NUCLEUS_DEVTOOLS_HOOK_KEY,
  pathMatches,
  type PublicizeMeta,
  type PublicizePath,
} from "@excom/kit-devtools";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { LoopGuard } from "@excom/kit-utils";
import { createSheet, flush, mount, unregisterAll } from "./helpers";

type Spy = ReturnType<typeof vi.spyOn>;
const messages = (spy: Spy) =>
  spy.mock.calls.map(([arg]) => String((arg as { message?: string })?.message ?? arg));

const click = (el: Element | null) =>
  el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

/**
 * The shared Vitest setup shims the Command API (`commandForElement`) so
 * view tests can click `<button command>`; tests of the no-API fallback
 * remove the shim for their duration.
 */
const withoutInvokers = async (fn: () => Promise<void>) => {
  const proto = HTMLButtonElement.prototype as unknown as Record<string, unknown>;
  const saved = Object.getOwnPropertyDescriptor(proto, "commandForElement");
  delete proto.commandForElement;
  try {
    await fn();
  } finally {
    if (saved) Object.defineProperty(proto, "commandForElement", saved);
  }
};

describe("@dispatch", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    LoopGuard.reset();
    delete (globalThis as Record<string, unknown>)[
      NUCLEUS_DEVTOOLS_HOOK_KEY
    ];
  });

  it("dispatches from the block's element with bubbles / cancelable on and composed off by default, after the block's writes are queued", async () => {
    const seen: Array<[string, boolean, boolean, boolean, string | null]> = [];
    const { root } = mount(
      `<section id="s"><button type="button" id="b">go</button></section>`,
      `#b { @on click { data-clicked: ""; @dispatch demo-ping; } }`
    );
    await flush();
    const button = root.querySelector("#b")!;
    root.querySelector("#s")!.addEventListener("demo-ping", (e) => {
      seen.push([
        e.type,
        e.bubbles,
        e.cancelable,
        e.composed,
        // the block's writes are queued, not painted, when the event fires
        button.getAttribute("data-clicked"),
      ]);
    });
    click(button);
    expect(seen).toEqual([["demo-ping", true, true, false, null]]);
    await flush();
    expect(button.hasAttribute("data-clicked")).toBe(true);
  });

  it("evaluates detail per event in the block's scope and honors the flags", async () => {
    const details: unknown[] = [];
    const flags: Array<[boolean, boolean, boolean]> = [];
    const { root } = mount(
      `<ul id="list" data-n="1"><li data-id="a"><span>a</span></li><li data-id="b"><span>b</span></li></ul>`,
      `#list {
        $n: attr("data-n");
        @on click (target: "li") {
          @dispatch todo-pick (detail: (id: target.getAttribute("data-id"), n: $n, origin: event.target.localName), bubbles: false, cancelable: false, composed);
        }
      }`
    );
    await flush();
    const list = root.querySelector("#list")!;
    list.addEventListener("todo-pick", (e) => {
      details.push((e as CustomEvent).detail);
      flags.push([e.bubbles, e.cancelable, e.composed]);
    });
    click(root.querySelector("li[data-id='b'] span"));
    list.setAttribute("data-n", "2");
    await flush();
    click(root.querySelector("li[data-id='a'] span"));
    expect(details).toEqual([
      { id: "b", n: "1", origin: "span" },
      { id: "a", n: "2", origin: "span" },
    ]);
    expect(flags).toEqual([
      [false, false, true],
      [false, false, true],
    ]);
  });

  it("targets every match of a selector in the element's document, `:scope` meaning the block's element (like event-handler target-ref), and elements from expressions", async () => {
    const hits: string[] = [];
    const { root } = mount(
      `<div id="a" class="out"></div><div id="b" class="out"></div><p id="c" class="out"></p>
       <button type="button" id="sel">sel</button>
       <button type="button" id="scope">scope</button>
       <button type="button" id="expr">expr</button>
       <button type="button" id="list">list</button>
       <provider-fetch id="before"></provider-fetch><button type="button" id="rel">rel</button><output id="after"></output>`,
      `#sel { @on click { @dispatch out-ping (target: "div.out"); } }
       #scope { @on click { @dispatch out-ping (target: ":scope"); } }
       #expr { @on click { @dispatch out-ping (target: element.previousElementSibling); } }
       #list { @on click { @dispatch out-ping (target: closest("section").children); } }
       #rel { @on click { @dispatch out-ping (target: "provider-fetch:has(+ :scope), :scope + output"); } }`
    );
    await flush();
    const outside = document.createElement("div");
    outside.className = "out";
    outside.id = "outside";
    document.body.appendChild(outside);
    root.addEventListener("out-ping", (e) => hits.push((e.target as Element).id));
    outside.addEventListener("out-ping", (e) => hits.push((e.target as Element).id));
    click(root.querySelector("#sel"));
    // the element's whole document, not the sheet's scope — as event-handler target-ref resolves
    expect(hits).toEqual(["a", "b", "outside"]);
    hits.length = 0;
    click(root.querySelector("#scope"));
    // `:scope` is the block's element, not the sheet host
    expect(hits).toEqual(["scope"]);
    hits.length = 0;
    click(root.querySelector("#rel"));
    expect(hits).toEqual(["before", "after"]);
    hits.length = 0;
    click(root.querySelector("#expr"));
    expect(hits).toEqual(["scope"]);
    hits.length = 0;
    click(root.querySelector("#list"));
    expect(hits).toEqual(
      Array.from(root.children).map((el) => el.id)
    );
    expect(hits).toContain("c");
    expect(hits).not.toContain("outside");
    outside.remove();
  });
  it("dispatches on window / document with host:, and several names get the same detail", async () => {
    const seen: string[] = [];
    const { root } = mount(
      `<button type="button" id="b">go</button>`,
      `#b { @on click { @dispatch app-a, "app:b" (host: document, detail: (at: 1)); @dispatch app-c (host: window); } }`
    );
    await flush();
    const onDoc = (e: Event) => seen.push(`${e.type}:${(e as CustomEvent).detail?.at}`);
    document.addEventListener("app-a", onDoc);
    document.addEventListener("app:b", onDoc);
    window.addEventListener("app-c", onDoc);
    click(root.querySelector("#b"));
    expect(seen).toEqual(["app-a:1", "app:b:1", "app-c:undefined"]);
    document.removeEventListener("app-a", onDoc);
    document.removeEventListener("app:b", onDoc);
    window.removeEventListener("app-c", onDoc);
  });

  it("form: sends the form's values as detail, merged under an explicit detail map", async () => {
    const details: unknown[] = [];
    const { root } = mount(
      `<form id="f"><input name="detail-title" value="Milk"><input name="qty" value="2"><button type="button" id="b">add</button></form>`,
      `#b {
        @on click { @dispatch cart-add (form: "form", detail: (qty: 3)); @dispatch cart-raw (form: closest("form")); }
      }`
    );
    await flush();
    root.querySelector("#f")!.addEventListener("cart-add", (e) => details.push((e as CustomEvent).detail));
    root.querySelector("#f")!.addEventListener("cart-raw", (e) => details.push((e as CustomEvent).detail));
    click(root.querySelector("#b"));
    expect(details).toEqual([
      { "detail-title": "Milk", qty: 3 },
      { "detail-title": "Milk", qty: "2" },
    ]);
  });

  it("dispatches from each matching descendant in a nested rule, and from a @delay block inside @on", async () => {
    const seen: string[] = [];
    const { root } = mount(
      `<section id="s"><ul><li id="x"></li><li id="y"></li></ul><button type="button" id="b">go</button></section>`,
      `#s {
        @on click (target: "button") {
          li { @dispatch row-ping; }
          @delay 5 { @dispatch late-ping; }
        }
      }`
    );
    await flush();
    root.querySelector("#s")!.addEventListener("row-ping", (e) => seen.push((e.target as Element).id));
    root.querySelector("#s")!.addEventListener("late-ping", (e) => seen.push(`late:${(e.target as Element).id}`));
    click(root.querySelector("#b"));
    expect(seen).toEqual(["x", "y"]);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toEqual(["x", "y", "late:s"]);
  });

  it("refuses to dispatch the enclosing event type, and warns once about unknown options and unmatched targets", async () => {
    const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const { root } = mount(
      `<button type="button" id="b">go</button>`,
      `#b { @on click { @dispatch click, other-ping (bogus, cancelable: "yes"); @dispatch never-ping (target: ".nope"); } }`
    );
    await flush();
    root.addEventListener("other-ping", (e) => seen.push(`other:${e.cancelable}`));
    root.addEventListener("never-ping", () => seen.push("never"));
    let clicks = 0;
    root.addEventListener("click", () => clicks++);
    click(root.querySelector("#b"));
    click(root.querySelector("#b"));
    expect(clicks).toBe(2);
    // the unknown / malformed options are ignored, the dispatch still happens
    expect(seen).toEqual(["other:true", "other:true"]);
    const m = messages(warn);
    expect(m.filter((x) => /unknown option "bogus"/.test(x))).toHaveLength(1);
    expect(m.filter((x) => /"cancelable" needs a boolean/.test(x))).toHaveLength(1);
    expect(m.filter((x) => /matches no element/.test(x))).toHaveLength(1);
    expect(m.filter((x) => /refusing to dispatch "click"/.test(x))).toHaveLength(1);
  });

  it("is refused at rule level, at sheet level and in a rule-level @delay (a match is not an occurrence)", async () => {
    const error = vi.spyOn(QuarkLogger, "error").mockImplementation(() => {});
    const seen: string[] = [];
    const { root } = mount(
      `<p id="p" is-on></p>`,
      `@dispatch sheet-ping;
       #p[is-on] { @dispatch rule-ping; @delay 1 { @dispatch delay-ping; } @on click { @dispatch ok-ping; } }`
    );
    root.addEventListener("rule-ping", () => seen.push("rule"));
    root.addEventListener("delay-ping", () => seen.push("delay"));
    root.addEventListener("ok-ping", () => seen.push("ok"));
    await flush();
    await new Promise((r) => setTimeout(r, 20));
    click(root.querySelector("#p"));
    expect(seen).toEqual(["ok"]);
    const m = messages(error);
    expect(m.filter((x) => /@dispatch must be written inside an @on block/.test(x))).toHaveLength(3);
  });

  it("cuts an event cycle with the loop guard instead of overflowing the stack", async () => {
    LoopGuard.configure({ limit: 8, log: () => {} });
    const trips: string[] = [];
    const off = LoopGuard.onTrip((trip) => trips.push(trip.name));
    let pings = 0;
    const { root } = mount(
      `<div id="a"><div id="b"></div></div>`,
      `#a { @on pong { @dispatch ping (target: "#b"); } }
       #b { @on ping { @dispatch pong (target: "#a"); } }`
    );
    await flush();
    root.querySelector("#b")!.addEventListener("ping", () => pings++);
    root.querySelector("#b")!.dispatchEvent(new CustomEvent("ping"));
    expect(pings).toBeGreaterThan(1);
    expect(pings).toBeLessThan(8);
    expect(trips.some((name) => /@dispatch (ping|pong)/.test(name))).toBe(true);
    off();
  });

  it("publishes quark/dispatch records and shows the statement in DevTools", async () => {
    const publications: { path: PublicizePath; meta: PublicizeMeta }[] = [];
    const renderers: QuarkRenderer[] = [];
    const hook: DevtoolsHook = {
      version: 1,
      inject: (renderer) => {
        renderers.push(renderer as QuarkRenderer);
      },
      publicize: (path, meta) => {
        publications.push({ path, meta });
      },
    };
    Quark.attachDevtools(hook);
    const { root, register } = createSheet(
      `<button type="button" id="b">go</button>`,
      `#b { @on click { @dispatch demo-ping (detail: 1); @dispatch click; } }`
    );
    register();
    await flush();
    root.addEventListener("demo-ping", (e) => e.preventDefault());
    click(root.querySelector("#b"));
    const records = publications
      .filter((p) => pathMatches(p.path, ["quark", "dispatch"]))
      .map(({ meta }) => [meta.tag, meta.name, meta.phase, meta.targets, meta.reason ?? null, meta.defaultPrevented ?? null]);
    expect(records).toEqual([
      ["button", "demo-ping", "dispatched", 1, null, true],
      ["button", "click", "dropped", 1, "same-event", null],
    ]);
  });
});

describe("@command", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    LoopGuard.reset();
  });

  it("without the Command API, dispatches custom --commands as `command` events on the targets with the block's element as source", () =>
    withoutInvokers(async () => {
      const seen: Array<[string, string, string]> = [];
      const { root } = mount(
        `<div id="feed"></div><div id="other"></div><button type="button" id="b">refresh</button>`,
        `#b { @on click { @command --refresh, --other (target: "#feed, #other"); } }`
      );
      await flush();
      for (const id of ["feed", "other"]) {
        root.querySelector(`#${id}`)!.addEventListener("command", (e) => {
          const ce = e as Event & { command: string; source: Element };
          seen.push([id, ce.command, ce.source.id]);
        });
      }
      click(root.querySelector("#b"));
      expect(seen).toEqual([
        ["feed", "--refresh", "b"],
        ["other", "--refresh", "b"],
        ["feed", "--other", "b"],
        ["other", "--other", "b"],
      ]);
    }));

  it("without the Command API, invokes native commands through the element's method and warns once when unsupported", () =>
    withoutInvokers(async () => {
      const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
      const { root } = mount(
        `<dialog id="dlg"></dialog><button type="button" id="open">open</button><button type="button" id="close">close</button><button type="button" id="nope">nope</button>`,
        `#open { @on click { @command show-modal (target: "#dlg"); } }
         #close { @on click { @command close (target: "#dlg"); } }
         #nope { @on click { @command teleport (target: "#dlg", detail: 1); } }`
      );
      await flush();
      const dlg = root.querySelector("#dlg") as HTMLDialogElement;
      const showModal = vi.spyOn(dlg, "showModal");
      const close = vi.spyOn(dlg, "close");
      click(root.querySelector("#open"));
      expect(showModal).toHaveBeenCalledTimes(1);
      click(root.querySelector("#close"));
      expect(close).toHaveBeenCalledTimes(1);
      click(root.querySelector("#nope"));
      click(root.querySelector("#nope"));
      const m = messages(warn);
      expect(m.filter((x) => /command "teleport" is not supported/.test(x))).toHaveLength(1);
      expect(m.filter((x) => /"detail" is not a @command option/.test(x))).toHaveLength(1);
    }));

  it("uses a hidden invoker button when the browser supports commandForElement", async () => {
    const proto = HTMLButtonElement.prototype as unknown as Record<string, unknown>;
    const invoked: Array<[Element | undefined, string | undefined]> = [];
    const originalClick = proto.click;
    Object.defineProperty(proto, "commandForElement", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    proto.click = function (this: HTMLButtonElement & { commandForElement?: Element; command?: string }) {
      if (this.commandForElement) invoked.push([this.commandForElement, this.command]);
      else (originalClick as () => void).call(this);
    };
    try {
      const { root } = mount(
        `<div id="feed"></div><button type="button" id="b">go</button>`,
        `#b { @on click { @command --refresh (target: "#feed"); } }`
      );
      await flush();
      click(root.querySelector("#b"));
      expect(invoked).toEqual([[root.querySelector("#feed"), "--refresh"]]);
      expect(document.body.querySelectorAll("button[style]")).toHaveLength(0);
    } finally {
      proto.click = originalClick;
      delete proto.commandForElement;
    }
  });
});

describe("@on nested sibling rules", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    LoopGuard.reset();
  });

  it("runs a `+ selector` nested rule against the next sibling", async () => {
    const seen: string[] = [];
    const { root } = mount(
      `<button type="button" id="b">go</button><provider-fetch id="pf"></provider-fetch>`,
      `:scope { button { @on click { + provider-fetch { @command --fetch; } } } }`
    );
    await flush();
    root.querySelector("#pf")!.addEventListener("command", (e) => {
      seen.push((e as Event & { command: string }).command);
    });
    click(root.querySelector("#b"));
    expect(seen).toEqual(["--fetch"]);
  });

  it("runs a `~ selector` nested rule against later siblings, not earlier ones or descendants", async () => {
    const seen: string[] = [];
    const { root } = mount(
      `<output id="before"></output>
       <button type="button" id="b"><output id="inside"></output></button>
       <output id="after-1"></output><span><output id="nested"></output></span><output id="after-2"></output>`,
      `#b { @on click { ~ output { @dispatch row-ping; } } }`
    );
    await flush();
    root.addEventListener("row-ping", (e) => {
      seen.push((e.target as Element).id);
    });
    click(root.querySelector("#b"));
    /*
     * happy-dom resolves `~` to the first following sibling only (a
     * browser matches every later one), so the environment can show
     * "after-1" but not "after-2". What matters here is the direction:
     * never the earlier sibling, never a descendant of either.
     */
    expect(seen).toEqual(["after-1"]);
  });
});
