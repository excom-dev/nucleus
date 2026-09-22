/**
 * `@view-transition [(options)] { … }`: paints of the writes inside the
 * block commit inside `document.startViewTransition()` (paint.ts), after
 * Quark settles (settle.ts). happy-dom has no view transitions, so a
 * browser-like stub stands in (helpers `installViewTransitionStub`).
 */
import { Quark } from "../../index";
import * as settleModule from "../../src/settle";
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
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { LoopGuard, type LoopGuardTrip } from "@excom/kit-utils";
import type { QuarkRenderer } from "../../src/devtools-hook";
import {
  bypassSelectorCache,
  createSheet,
  flush,
  installViewTransitionStub,
  mount,
  unregisterAll,
} from "./helpers";

type Stub = ReturnType<typeof installViewTransitionStub>;

/** Messages of `QuarkLogger.warn` calls (console output is off below warn level). */
const spyWarnings = () => {
  const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
  return () => warn.mock.calls.map(([arg]) => String((arg as { message?: string })?.message ?? arg));
};

/** Past the sheet's first render: the next change can transition. */
const settle = async () => {
  await flush();
  await Quark.whenSettled();
  await wait(0);
};

const waitFor = async (condition: () => boolean, ticks = 80) => {
  for (let i = 0; i < ticks && !condition(); i++) await wait(0);
  expect(condition()).toBe(true);
};

const typesOf = (stub: Stub, index = 0) =>
  [...(stub.calls[index]?.types ?? [])].sort();

describe("@view-transition", () => {
  let stub: Stub | undefined;

  afterEach(async () => {
    // let every transition finish so module state never leaks between tests
    if (stub) {
      await Promise.race([
        Promise.all(stub.calls.map((call) => call.runUpdate().then(() => call.finished))),
        wait(1500),
      ]);
      stub.restore();
      stub = undefined;
    }
    await Quark.whenSettled({ timeout: 200 });
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("committing writes", () => {
    it("commits plainly, without warnings, where the API is missing", async () => {
      const warn = vi.spyOn(console, "warn");
      const error = vi.spyOn(console, "error");
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition (types: "count") { data-copy: attr("data-n"); } }`
      );
      await settle();
      const out = root.querySelector("#out")!;
      expect(out.getAttribute("data-copy")).toBe("1");
      out.setAttribute("data-n", "2");
      await settle();
      expect(out.getAttribute("data-copy")).toBe("2");
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it("holds a flagged write while the transition is pending and commits it inside update", async () => {
      stub = installViewTransitionStub({ autoUpdate: false });
      // the reader rule runs before the def: its deferred re-run is still first render
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition (types: "count") { data-copy: $n; } }
         #out { $n: attr("data-n"); }`
      );
      await settle();
      expect(stub.calls).toHaveLength(0);
      const out = root.querySelector("#out")!;
      expect(out.getAttribute("data-copy")).toBe("1");
      out.setAttribute("data-n", "2");
      await waitFor(() => stub!.calls.length === 1);
      await wait(20);
      // pending: the browser has not called update, nothing commits
      expect(out.getAttribute("data-copy")).toBe("1");
      expect(typesOf(stub)).toEqual(["count"]);
      await stub.calls[0].runUpdate();
      expect(stub.calls[0].isUpdated).toBe(true);
      expect(out.getAttribute("data-copy")).toBe("2");
      await settle();
      expect(stub.calls).toHaveLength(1);
    });

    it("commits one tick's flagged and unflagged writes in one transition, nodes before attributes", async () => {
      stub = installViewTransitionStub({ autoUpdate: false });
      const { root } = mount(
        `<div id="box" data-n="1"><span></span></div>`,
        `#box {
          $n: attr("data-n");
          @view-transition (types: "a") { data-copy: $n; }
          @view-transition (types: "b") { span { content: $n; } }
          data-plain: $n;
        }`
      );
      await settle();
      const box = root.querySelector("#box")!;
      const span = box.querySelector("span")!;
      box.setAttribute("data-n", "2");
      await waitFor(() => stub!.calls.length === 1);
      await wait(10);
      expect([box.getAttribute("data-copy"), box.getAttribute("data-plain"), span.textContent]).toEqual(["1", "1", "1"]);
      const records: string[] = [];
      const observer = new MutationObserver((list) =>
        list.forEach((record) => records.push(record.type === "attributes" ? record.attributeName! : "content"))
      );
      observer.observe(box, { attributes: true, childList: true, subtree: true });
      await stub.calls[0].runUpdate();
      observer.disconnect();
      expect([box.getAttribute("data-copy"), box.getAttribute("data-plain"), span.textContent]).toEqual(["2", "2", "2"]);
      expect(typesOf(stub)).toEqual(["a", "b"]);
      expect(records[0]).toBe("content");
      expect(records).toEqual(expect.arrayContaining(["data-copy", "data-plain"]));
      expect(stub.calls).toHaveLength(1);
    });

    it("never transitions the sheet's first render unless the block says first-render", async () => {
      stub = installViewTransitionStub();
      mount(`<p id="a" data-n="1"></p>`, `#a { @view-transition { data-copy: attr("data-n"); } }`);
      await settle();
      expect(stub.calls).toHaveLength(0);
      const { root } = mount(
        `<p id="b" data-n="1"></p>`,
        `#b { @view-transition (first-render, types: "load") { data-copy: attr("data-n"); } }`
      );
      await settle();
      expect(stub.calls).toHaveLength(1);
      expect(typesOf(stub)).toEqual(["load"]);
      expect(root.querySelector("#b")!.getAttribute("data-copy")).toBe("1");
    });

    it("evaluates types per write: strings, lists and interpolations, unioned per transition", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(
        `<div id="box" data-n="1" data-op="add"></div>`,
        `#box {
          $n: attr("data-n");
          @view-transition (types: "a b") { data-one: $n; }
          @view-transition (types: ("b", "c d")) { data-two: $n; }
          @view-transition (types: "todo-#{attr("data-op")}") { data-three: $n; }
        }`
      );
      await settle();
      root.querySelector("#box")!.setAttribute("data-n", "2");
      await settle();
      expect(stub.calls).toHaveLength(1);
      expect(typesOf(stub)).toEqual(["a", "b", "c", "d", "todo-add"]);
    });

    it("starts no transition for writes that change nothing", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(
        `<div id="box" data-word="abc"><span></span></div>`,
        `#box {
          $word: attr("data-word");
          @view-transition { data-len: $word.length; span { content: $word.length; } }
        }`
      );
      await settle();
      const box = root.querySelector("#box")!;
      box.setAttribute("data-word", "xyz");
      await settle();
      expect(stub.calls).toHaveLength(0);
      expect(box.getAttribute("data-len")).toBe("3");
      // a no-op and a real change in one commit: one transition
      box.setAttribute("data-word", "wxyz");
      await settle();
      expect(stub.calls).toHaveLength(1);
      expect(box.querySelector("span")!.textContent).toBe("4");
    });

    it("waits for dependent writes: rendered rows are complete when the new state is captured", async () => {
      stub = installViewTransitionStub({ autoUpdate: false });
      const rows = (n: string) =>
        Array.from({ length: Number(n) }, (_, i) => ({ id: i, label: `row ${i}` }));
      const { root } = mount(
        `<ul id="list" data-count="2"><template><li><span bind-label></span></li></template></ul>`,
        `#list {
          $rows: rows(attr("data-count"));
          @view-transition (types: "rows") { content: iterate($rows, none, "id"); }
        }
        [bind-label] { content: item.label; }`,
        { rows }
      );
      await settle();
      const list = root.querySelector("#list")!;
      expect(list.querySelectorAll("[bind-label]")).toHaveLength(2);
      list.setAttribute("data-count", "4");
      await waitFor(() => stub!.calls.length === 1);
      expect(list.querySelectorAll("li")).toHaveLength(2);
      await stub.calls[0].runUpdate();
      // the new rows and their labels (a later rule pass) are in the cut
      expect([...list.querySelectorAll("[bind-label]")].map((el) => el.textContent)).toEqual([
        "row 0",
        "row 1",
        "row 2",
        "row 3",
      ]);
      expect(typesOf(stub)).toEqual(["rows"]);
    });

    it("captures the new state after timeout when Quark does not settle, warning once per block", async () => {
      stub = installViewTransitionStub();
      const warnings = spyWarnings();
      const hang = (n: string) => (n === "1" ? "ready" : new Promise(() => {}));
      const { root } = mount(
        `<div id="box" data-n="1"><span></span></div>`,
        `#box {
          $n: attr("data-n");
          @view-transition (timeout: 40) { data-copy: $n; }
          span { content: hang($n); }
        }`,
        { hang }
      );
      await settle();
      const box = root.querySelector("#box")!;
      box.setAttribute("data-n", "2");
      await waitFor(() => stub!.calls.length === 1);
      const started = Date.now();
      await stub.calls[0].updateCallbackDone;
      expect(Date.now() - started).toBeGreaterThanOrEqual(30);
      expect(box.getAttribute("data-copy")).toBe("2");
      box.setAttribute("data-n", "3");
      await waitFor(() => stub!.calls.length === 2);
      await stub.calls[1].updateCallbackDone;
      expect(warnings().filter((m) => m.includes("did not settle within 40ms"))).toHaveLength(1);
      box.remove();
    });

    it("holds delayed writes back and commits them in their own transition", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(
        `<div id="box" data-n="1"></div>`,
        `#box {
          $n: attr("data-n");
          @view-transition (delay: 60, types: "late") { data-copy: $n; }
          data-plain: $n;
        }`
      );
      await settle();
      const box = root.querySelector("#box")!;
      box.setAttribute("data-n", "2");
      await flush();
      expect(box.getAttribute("data-plain")).toBe("2");
      expect(box.getAttribute("data-copy")).toBe("1");
      expect(stub.calls).toHaveLength(0);
      await wait(80);
      await settle();
      expect(box.getAttribute("data-copy")).toBe("2");
      expect(stub.calls).toHaveLength(1);
      expect(typesOf(stub)).toEqual(["late"]);
    });

    it("commits plainly under prefers-reduced-motion: reduce and in a hidden document", async () => {
      stub = installViewTransitionStub();
      vi.spyOn(window, "matchMedia").mockImplementation(
        (query: string) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList
      );
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition { data-copy: attr("data-n"); } }`
      );
      await settle();
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await settle();
      expect(out.getAttribute("data-copy")).toBe("2");
      expect(stub.calls).toHaveLength(0);
      vi.restoreAllMocks();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      out.setAttribute("data-n", "3");
      await settle();
      expect(out.getAttribute("data-copy")).toBe("3");
      expect(stub.calls).toHaveLength(0);
    });

    it("commits plainly on engines that reject the options object (no transition types)", async () => {
      stub = installViewTransitionStub({ withTypes: false });
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition (types: "count") { data-copy: attr("data-n"); } }`
      );
      await settle();
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await settle();
      expect(stub.calls).toHaveLength(0);
      expect(out.getAttribute("data-copy")).toBe("2");
      out.setAttribute("data-n", "3");
      await settle();
      expect(out.getAttribute("data-copy")).toBe("3");
    });

    it("commits the pending paints itself when update never arrives", async () => {
      stub = installViewTransitionStub({ autoUpdate: false });
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition { data-copy: attr("data-n"); } }`
      );
      await settle();
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await waitFor(() => stub!.calls.length === 1);
      expect(out.getAttribute("data-copy")).toBe("1");
      await wait(1050);
      expect(out.getAttribute("data-copy")).toBe("2");
      // a late update finds nothing pending and resolves
      await stub.calls[0].runUpdate();
      expect(stub.calls[0].isUpdated).toBe(true);
    });

    it("logs a throwing paint, commits the others and never rejects update", async () => {
      stub = installViewTransitionStub();
      const error = vi.spyOn(QuarkLogger, "error").mockImplementation(() => {});
      const bad = (n: string) => (n === "1" ? {} : { "a b": n });
      const { root } = mount(
        `<div id="box" data-n="1"></div>`,
        `#box {
          $n: attr("data-n");
          @view-transition { dataset: bad($n); data-copy: $n; }
        }`,
        { bad }
      );
      await settle();
      const box = root.querySelector("#box")!;
      box.setAttribute("data-n", "2");
      await waitFor(() => stub!.calls.length === 1);
      await expect(stub.calls[0].updateCallbackDone).resolves.toBeUndefined();
      expect(box.getAttribute("data-copy")).toBe("2");
      expect(error.mock.calls.map(([arg]) => (arg as { message?: string }).message)).toContain(
        "Quark: a paint threw; the other paints still commit"
      );
    });

    it("commits plainly when starting the transition throws", async () => {
      stub = installViewTransitionStub();
      const publications: PublicizeMeta[] = [];
      Quark.attachDevtools({
        version: 1,
        inject: () => {},
        publicize: (path, meta) => {
          if (pathMatches(path, ["quark", "transition"])) publications.push(meta);
        },
      });
      try {
        (document as any).startViewTransition = () => {
          throw new DOMException("not now", "InvalidStateError");
        };
        const { root } = mount(
          `<p id="out" data-n="1"></p>`,
          `#out { @view-transition { data-copy: attr("data-n"); } }`
        );
        await settle();
        const out = root.querySelector("#out")!;
        out.setAttribute("data-n", "2");
        await settle();
        expect(out.getAttribute("data-copy")).toBe("2");
        expect(publications).toEqual([{ phase: "skip", reason: "error", types: [], paints: 1 }]);
        // the next change is not held back by a stuck pending phase
        out.setAttribute("data-n", "3");
        await settle();
        expect(out.getAttribute("data-copy")).toBe("3");
      } finally {
        delete (globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY];
      }
    });

    it("ignores an element that left the document before update ran", async () => {
      stub = installViewTransitionStub({ autoUpdate: false });
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition { data-copy: attr("data-n"); } }`
      );
      await settle();
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await waitFor(() => stub!.calls.length === 1);
      out.remove();
      await expect(stub.calls[0].runUpdate()).resolves.toBeUndefined();
      expect(stub.calls[0].isUpdated).toBe(true);
    });
  });

  describe("another active transition", () => {
    it("if-active: skip (default) commits unanimated while a transition is active", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition { data-copy: attr("data-n"); } }`
      );
      await settle();
      (document as any).activeViewTransition = { finished: new Promise(() => {}) };
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await settle();
      expect(out.getAttribute("data-copy")).toBe("2");
      expect(stub.calls).toHaveLength(0);
      (document as any).activeViewTransition = null;
      out.setAttribute("data-n", "3");
      await settle();
      expect(stub.calls).toHaveLength(1);
    });

    it("if-active: replace starts anyway, skipping the running transition", async () => {
      stub = installViewTransitionStub({ animationMs: 200 });
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition (if-active: replace) { data-copy: attr("data-n"); } }`
      );
      await settle();
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await waitFor(() => stub!.calls.length === 1);
      await stub.calls[0].updateCallbackDone;
      // Quark's own transition is still animating
      out.setAttribute("data-n", "3");
      await waitFor(() => stub!.calls.length === 2);
      expect(stub.calls[0].isSkipped).toBe(true);
      await stub.calls[1].updateCallbackDone;
      expect(out.getAttribute("data-copy")).toBe("3");
    });

    it("skips while its own transition animates, and transitions again after it finished", async () => {
      stub = installViewTransitionStub({ animationMs: 120 });
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition { data-copy: attr("data-n"); } }`
      );
      await settle();
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await waitFor(() => stub!.calls.length === 1);
      await stub.calls[0].updateCallbackDone;
      out.setAttribute("data-n", "3");
      await settle();
      expect(out.getAttribute("data-copy")).toBe("3");
      expect(stub.calls).toHaveLength(1);
      await stub.calls[0].finished;
      out.setAttribute("data-n", "4");
      await settle();
      expect(stub.calls).toHaveLength(2);
    });
  });

  describe("where blocks apply", () => {
    it("inside an @on block, and around one: event writes commit in one transition", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(
        `<div id="box"><button id="btn" type="button">go</button><p id="panel"></p></div>`,
        `#box {
          @on click { @view-transition (types: "open") { data-clicked: ""; #panel { data-open: ""; } } }
          @view-transition (types: "close") { @on dblclick { data-clicked: none; } }
        }`
      );
      await settle();
      const box = root.querySelector("#box")!;
      root.querySelector("#btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await settle();
      expect(stub.calls).toHaveLength(1);
      expect(typesOf(stub)).toEqual(["open"]);
      expect(box.hasAttribute("data-clicked")).toBe(true);
      expect(root.querySelector("#panel")!.hasAttribute("data-open")).toBe(true);
      box.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await settle();
      expect(stub.calls).toHaveLength(2);
      expect(typesOf(stub, 1)).toEqual(["close"]);
      expect(box.hasAttribute("data-clicked")).toBe(false);
    });

    it("around rules at sheet level, in scoped and global sheets", async () => {
      stub = installViewTransitionStub();
      const scoped = mount(
        `<p id="a" data-n="1"></p>`,
        `@view-transition (types: "scoped") { #a { data-copy: attr("data-n"); } }`
      );
      const global = mount(
        `<p id="b" data-n="1"></p>`,
        `@view-transition (types: "global") { #b { data-copy: attr("data-n"); } }`,
        undefined,
        { isScoped: false }
      );
      await settle();
      scoped.root.querySelector("#a")!.setAttribute("data-n", "2");
      await settle();
      global.root.querySelector("#b")!.setAttribute("data-n", "2");
      await settle();
      expect(stub.calls.map((_, i) => typesOf(stub!, i))).toEqual([["scoped"], ["global"]]);
      expect(scoped.root.querySelector("#a")!.getAttribute("data-copy")).toBe("2");
      expect(global.root.querySelector("#b")!.getAttribute("data-copy")).toBe("2");
    });

    it("lets a nested @view-transition override the outer options for its writes", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out {
          @view-transition (types: "outer") {
            data-fixed: "x";
            @view-transition (types: "inner") { data-copy: attr("data-n"); }
          }
        }`
      );
      await settle();
      root.querySelector("#out")!.setAttribute("data-n", "2");
      await settle();
      expect(stub.calls).toHaveLength(1);
      expect(typesOf(stub)).toEqual(["inner"]);
    });

    it("applies content, class, dataset, ariaset and CSS variables inside a block", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(
        `<div id="box" data-n="1"><span></span></div>`,
        `#box {
          $n: attr("data-n");
          @view-transition {
            class: "n-#{$n}";
            dataset: (count: $n);
            ariaset: (label: "n #{$n}");
            --n: "#{$n}";
            span { content: dangerous-html("<b>#{$n}</b>"); }
          }
        }`
      );
      await settle();
      const box = root.querySelector("#box") as HTMLElement;
      box.setAttribute("data-n", "2");
      await settle();
      expect(stub.calls).toHaveLength(1);
      expect(box.className).toBe("n-2");
      expect(box.getAttribute("data-count")).toBe("2");
      expect(box.getAttribute("aria-label")).toBe("n 2");
      expect(box.style.getPropertyValue("--n")).toBe("2");
      expect(box.querySelector("span")!.innerHTML).toBe("<b>2</b>");
      // re-applying the same values changes nothing for any kind
      box.setAttribute("data-n", "2");
      await settle();
      expect(stub.calls).toHaveLength(1);
    });

    it("loads @use modules declared inside a block", async () => {
      stub = installViewTransitionStub();
      const original = Quark.moduleLoader;
      Quark.moduleLoader = async () => ({ twice: (n: string) => `${n}${n}` });
      try {
        const { root } = mount(
          `<p id="out" data-n="1"></p>`,
          `#out { @view-transition { @use "/twice.js" as m; data-copy: m.twice(attr("data-n")); } }`
        );
        await settle();
        const out = root.querySelector("#out")!;
        expect(out.getAttribute("data-copy")).toBe("11");
        out.setAttribute("data-n", "2");
        await settle();
        expect(out.getAttribute("data-copy")).toBe("22");
        expect(stub.calls).toHaveLength(1);
      } finally {
        Quark.moduleLoader = original;
      }
    });

    it("keeps the loop guard's causal depth for paints committed inside update", async () => {
      stub = installViewTransitionStub();
      LoopGuard.reset();
      LoopGuard.configure({ limit: 8, log: () => {} });
      const trips: LoopGuardTrip[] = [];
      const off = LoopGuard.onTrip((trip) => trips.push(trip));
      try {
        const { root } = mount(
          `<div id="d" data-go="0"></div>`,
          `div[data-go="1"] { @view-transition (timeout: 50) { content: dangerous-html("<div data-go=\\"1\\"></div>"); } }`
        );
        await settle();
        root.querySelector("#d")!.setAttribute("data-go", "1");
        for (let i = 0; i < 60 && !trips.length; i++) await flush();
        expect(stub.calls.length).toBeGreaterThanOrEqual(1);
        expect(trips[0]).toMatchObject({ kind: "depth", name: "content" });
        let depth = 0;
        for (let el = root.querySelector("#d"); el; el = el.firstElementChild) depth++;
        expect(depth).toBeLessThanOrEqual(LoopGuard.limit + 2);
      } finally {
        off();
        LoopGuard.reset();
      }
    });
  });

  describe("change detection", () => {
    type Case = {
      name: string;
      html: string;
      sheet: string;
      /** Each step: prepare the DOM, then whether a transition must start. */
      steps: Array<{ act: (root: HTMLElement) => void; transitions: 0 | 1 }>;
    };
    const rows = (n: string) =>
      (n.startsWith("-") ? [2, 1] : Array.from({ length: Number(n) }, (_, i) => i + 1)).map((id) => ({ id }));
    const set = (selector: string, name: string, value: string) => (root: HTMLElement) =>
      root.querySelector(selector)!.setAttribute(name, value);
    const cases: Case[] = [
      {
        name: "boolean attributes",
        html: `<p id="t" data-v="1"></p>`,
        sheet: `#t { @view-transition { data-on: attr("data-v") != "0"; } }`,
        steps: [
          { act: set("#t", "data-v", "2"), transitions: 0 },
          { act: set("#t", "data-v", "0"), transitions: 1 },
        ],
      },
      {
        name: "a text input whose live value drifted",
        html: `<input id="t" data-v="a">`,
        sheet: `#t { @view-transition { value: attr("data-v"); } }`,
        steps: [
          { act: set("#t", "data-v", "a"), transitions: 0 },
          {
            act: (root) => {
              (root.querySelector("#t") as HTMLInputElement).value = "typed";
              set("#t", "data-v", "a")(root);
            },
            transitions: 1,
          },
        ],
      },
      {
        name: "a checkbox whose live state drifted",
        html: `<input id="t" type="checkbox" data-v="1">`,
        sheet: `#t { @view-transition { checked: attr("data-v") == "1"; } }`,
        steps: [
          { act: set("#t", "data-v", "1"), transitions: 0 },
          {
            act: (root) => {
              (root.querySelector("#t") as HTMLInputElement).checked = false;
              set("#t", "data-v", "1")(root);
            },
            transitions: 1,
          },
        ],
      },
      {
        name: "class lists, maps and wipes",
        html: `<p id="t" data-v="1"></p>`,
        sheet: `#t[data-v="1"], #t[data-v="11"] { @view-transition { class: ("a", "b"); } }
          #t[data-v="2"], #t[data-v="3"] { @view-transition { class: (big: attr("data-v") == "3", c: true); } }
          #t[data-v="0"] { @view-transition { class: none; } }`,
        steps: [
          { act: set("#t", "data-v", "11"), transitions: 0 },
          { act: set("#t", "data-v", "2"), transitions: 1 },
          { act: set("#t", "data-v", "3"), transitions: 1 },
          { act: set("#t", "data-v", "0"), transitions: 1 },
        ],
      },
      {
        name: "CSS variables: value, priority and removal",
        html: `<p id="t" data-v="1"></p>`,
        sheet: `#t { @view-transition { --x: if(attr("data-v") == "0": none; attr("data-v") == "2": "1 !important"; else: "1"); } }`,
        steps: [
          { act: set("#t", "data-v", "3"), transitions: 0 },
          { act: set("#t", "data-v", "2"), transitions: 1 },
          { act: set("#t", "data-v", "0"), transitions: 1 },
          { act: set("#t", "data-v", "4"), transitions: 1 },
        ],
      },
      {
        name: "content wipes with and without a template",
        html: `<p id="t" data-v="1">text</p><ul id="u" data-v="2"><template><li></li></template></ul>`,
        sheet: `#t { @view-transition { content: if(attr("data-v") == "0": none; else: preserve); } }
          #u { @view-transition { content: iterate(if(attr("data-v") == "0": none; else: rows(attr("data-v"))), none, "id"); } }`,
        steps: [
          { act: set("#t", "data-v", "0"), transitions: 1 },
          { act: set("#t", "data-v", "0"), transitions: 0 },
          { act: set("#u", "data-v", "0"), transitions: 1 },
          { act: set("#u", "data-v", "0"), transitions: 0 },
        ],
      },
      {
        name: "keyed rows: same nodes, added rows, reordered rows",
        html: `<ul id="t" data-v="2"><template><li></li></template></ul>`,
        sheet: `#t { @view-transition { content: iterate(rows(attr("data-v")), none, "id"); } }`,
        steps: [
          { act: set("#t", "data-v", "2"), transitions: 0 },
          { act: set("#t", "data-v", "-2"), transitions: 1 },
          { act: set("#t", "data-v", "3"), transitions: 1 },
        ],
      },
      {
        name: "text into a <template> and innerHTML",
        html: `<template id="t" data-v="1"></template><p id="h" data-v="1"></p>`,
        sheet: `#t { @view-transition { content: attr("data-v"); } }
          #h { @view-transition { content: dangerous-html("<b>#{attr("data-v")}</b>"); } }`,
        steps: [
          { act: set("#t", "data-v", "1"), transitions: 0 },
          { act: set("#t", "data-v", "2"), transitions: 1 },
          { act: set("#h", "data-v", "1"), transitions: 0 },
          { act: set("#h", "data-v", "2"), transitions: 1 },
        ],
      },
    ];

    const node = document.createElement("b");
    node.textContent = "node";
    /** Async content: a promise of text, a Node, a NodeList or a wipe. */
    const later = (v: string) =>
      Promise.resolve(
        v === "text"
          ? "later"
          : v === "node"
            ? node
            : v === "list"
              ? document.createRange().createContextualFragment("<i>a</i><i>b</i>").childNodes
              : null
      );
    cases.push(
      {
        name: "ariaset",
        html: `<p id="t" data-v="1"></p>`,
        sheet: `#t { @view-transition { ariaset: (label: attr("data-v") != "2"); } }`,
        steps: [
          { act: set("#t", "data-v", "3"), transitions: 0 },
          { act: set("#t", "data-v", "2"), transitions: 1 },
        ],
      },
      {
        name: "async content: text, a node, a node list and a wipe",
        html: `<p id="t" data-v="none">x</p>`,
        sheet: `#t { @view-transition { content: later(attr("data-v")); } }`,
        steps: [
          { act: set("#t", "data-v", "text"), transitions: 1 },
          { act: set("#t", "data-v", "text"), transitions: 0 },
          { act: set("#t", "data-v", "node"), transitions: 1 },
          { act: set("#t", "data-v", "node"), transitions: 0 },
          { act: set("#t", "data-v", "list"), transitions: 1 },
          { act: set("#t", "data-v", "none"), transitions: 1 },
          { act: set("#t", "data-v", "none"), transitions: 0 },
        ],
      }
    );

    for (const { name, html, sheet, steps } of cases) {
      it(`detects changes for ${name}`, async () => {
        stub = installViewTransitionStub();
        const { root } = mount(html, sheet, { rows, later });
        await settle();
        for (const [index, { act, transitions }] of steps.entries()) {
          const before = stub.calls.length;
          act(root);
          await settle();
          await Promise.all(stub.calls.map((call) => call.finished));
          expect(stub.calls.length - before, `step ${index}`).toBe(transitions);
        }
      });
    }
  });

  describe("until", () => {
    const loaderSheet = `#loader[is-loading] {
        @view-transition (until: "[is-success], [is-error]", timeout: 800, types: "load") {
          #msg { content: "Loading"; }
        }
      }
      #loader[is-success] #msg { content: "Done"; }`;

    it("keeps update open until the block's element matches, so the fact's writes land in the cut", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(`<div id="loader"><p id="msg"></p></div>`, loaderSheet);
      await settle();
      const loader = root.querySelector("#loader")!;
      loader.setAttribute("is-loading", "");
      await waitFor(() => !!stub!.calls[0]?.isUpdating);
      const started = Date.now();
      await wait(60);
      expect(stub.calls[0].isUpdated).toBe(false);
      loader.removeAttribute("is-loading");
      loader.setAttribute("is-success", "");
      await stub.calls[0].updateCallbackDone;
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(700);
      expect(root.querySelector("#msg")!.textContent).toBe("Done");
      await settle();
      expect(stub.calls).toHaveLength(1);
      expect(typesOf(stub)).toEqual(["load"]);
    });

    it("waits until a fact clears (:not) or a descendant appears (:has)", async () => {
      const restore = bypassSelectorCache();
      try {
        stub = installViewTransitionStub();
        const { root } = mount(
          `<div id="a"><p id="a-msg"></p></div><div id="b"><p id="b-msg"></p><ul></ul></div>`,
          `#a[is-open] { @view-transition (until: ":not([is-busy])") { #a-msg { content: "open"; } } }
           #b[is-open] { @view-transition (until: ":has(li)") { #b-msg { content: "open"; } } }`
        );
        await settle();
        const a = root.querySelector("#a")!;
        a.setAttribute("is-busy", "");
        a.setAttribute("is-open", "");
        await waitFor(() => !!stub!.calls[0]?.isUpdating);
        await wait(40);
        expect(stub.calls[0].isUpdated).toBe(false);
        a.removeAttribute("is-busy");
        await stub.calls[0].updateCallbackDone;
        await stub.calls[0].finished;
        const b = root.querySelector("#b")!;
        b.setAttribute("is-open", "");
        await waitFor(() => !!stub!.calls[1]?.isUpdating);
        await wait(40);
        expect(stub.calls[1].isUpdated).toBe(false);
        b.querySelector("ul")!.append(document.createElement("li"));
        await stub.calls[1].updateCallbackDone;
        expect(root.querySelector("#b-msg")!.textContent).toBe("open");
      } finally {
        restore();
      }
    });

    it("checks the block's own element: a block on a descendant waiting on an ancestor fact times out", async () => {
      stub = installViewTransitionStub();
      const warnings = spyWarnings();
      const { root } = mount(
        `<div id="loader"><p id="msg"></p></div>`,
        `#loader[is-loading] #msg { @view-transition (until: "[is-success]", timeout: 60) { content: "Loading"; } }`
      );
      await settle();
      const loader = root.querySelector("#loader")!;
      loader.setAttribute("is-loading", "");
      await waitFor(() => !!stub!.calls[0]?.isUpdating);
      loader.setAttribute("is-success", "");
      const started = Date.now();
      await stub.calls[0].updateCallbackDone;
      expect(Date.now() - started).toBeGreaterThanOrEqual(40);
      expect(warnings().filter((m) => m.includes("`until` was not met within 60ms"))).toHaveLength(1);
    });

    it("stops waiting when the element leaves the document", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(`<div id="loader"><p id="msg"></p></div>`, loaderSheet);
      await settle();
      const loader = root.querySelector("#loader")!;
      loader.setAttribute("is-loading", "");
      await waitFor(() => !!stub!.calls[0]?.isUpdating);
      const started = Date.now();
      loader.remove();
      await stub.calls[0].updateCallbackDone;
      expect(Date.now() - started).toBeLessThan(400);
    });

    it("waits on a promise until it settles, either way", async () => {
      stub = installViewTransitionStub();
      const { root } = mount(
        `<div id="loader"><p id="msg"></p></div>`,
        `#loader[is-loading] { @view-transition (until: prop("pending"), timeout: 800) { #msg { content: "Loading"; } } }`
      );
      await settle();
      const loader = root.querySelector("#loader") as HTMLElement & { pending?: Promise<void> };
      let reject!: (reason: unknown) => void;
      loader.pending = new Promise((_, r) => (reject = r));
      loader.pending.catch(() => {});
      loader.setAttribute("is-loading", "");
      await waitFor(() => !!stub!.calls[0]?.isUpdating);
      await wait(40);
      expect(stub.calls[0].isUpdated).toBe(false);
      reject(new Error("offline"));
      await stub.calls[0].updateCallbackDone;
      expect(root.querySelector("#msg")!.textContent).toBe("Loading");
    });

    it("honors one until per transition: a second one is warned and its writes land in the open cut", async () => {
      stub = installViewTransitionStub();
      const warnings = spyWarnings();
      const { root } = mount(
        `<div id="a"><p id="a-msg"></p></div><div id="b"><p id="b-msg"></p></div>`,
        `:scope[data-go] #a { @view-transition (until: "[is-done]", timeout: 800) { #a-msg { content: "a"; } } }
         :scope[data-go] #b { @view-transition (until: "[is-never]", timeout: 800) { #b-msg { content: "b"; } } }`
      );
      await settle();
      root.setAttribute("data-go", "");
      await waitFor(() => !!stub!.calls[0]?.isUpdating);
      expect(root.querySelector("#b-msg")!.textContent).toBe("b");
      root.querySelector("#a")!.setAttribute("is-done", "");
      await stub.calls[0].updateCallbackDone;
      expect(stub.calls).toHaveLength(1);
      expect(warnings().filter((m) => m.includes("one `until` per view transition"))).toHaveLength(1);
    });

    it("drops an invalid selector with a warning and defaults the cap to 1000ms with until, 300 without", async () => {
      stub = installViewTransitionStub();
      const warnings = spyWarnings();
      const wait$ = vi.spyOn(settleModule, "whenSettled");
      const { root } = mount(
        `<div id="a"></div><div id="b"></div><div id="c"></div>`,
        `#a[data-go] { @view-transition (until: "[is-x") { data-a: ""; } }
         #b[data-go] { @view-transition (until: "[is-x]") { data-b: ""; } }
         #c[data-go] { @view-transition { data-c: ""; } }`
      );
      await settle();
      for (const id of ["a", "b", "c"]) {
        wait$.mockClear();
        const el = root.querySelector(`#${id}`)!;
        if (id === "b") setTimeout(() => el.setAttribute("is-x", ""), 30);
        el.setAttribute("data-go", "");
        await waitFor(() => wait$.mock.calls.length > 0);
        const [{ timeout, until }] = wait$.mock.calls[0] as [settleModule.SettleOptions];
        expect([id, timeout, !!until]).toEqual(
          id === "b" ? ["b", 1000, true] : [id, 300, false]
        );
        await settle();
        await Promise.all(stub.calls.map((call) => call.finished));
      }
      expect(warnings().filter((m) => m.includes('until: "[is-x" is not a valid selector'))).toHaveLength(1);
    });
  });

  describe("options", () => {
    it("evaluates options on the block's element, not on the nested element being written", async () => {
      stub = installViewTransitionStub();
      const items = [{ id: 1, kind: "fruit" }, { id: 2, kind: "veg" }];
      const { root } = mount(
        `<section id="box" data-kind="list" data-n="1"><p data-kind="nested"></p>
          <ul id="rows"><template><li><span></span></li></template></ul></section>`,
        `#box {
          $n: attr("data-n");
          @view-transition (types: "box-#{attr("data-kind")}") { p { data-copy: $n; } }
          ul { content: iterate(items(), none, "id"); }
        }
        #box li { @view-transition (types: "row-#{item.kind}") { span { data-copy: $n; } } }`,
        { items: () => items }
      );
      await settle();
      root.querySelector("#box")!.setAttribute("data-n", "2");
      await settle();
      expect(stub.calls).toHaveLength(1);
      expect(typesOf(stub)).toEqual(["box-list", "row-fruit", "row-veg"]);
    });

    it("warns once per block about unknown, malformed and reserved options", async () => {
      stub = installViewTransitionStub();
      const warnings = spyWarnings();
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out {
          @view-transition (speed: 2, timeout: "soon", delay: -1, first-render: 1, if-active: later, types: 3, scope: element, until: 5) {
            data-copy: attr("data-n");
          }
        }`
      );
      await settle();
      root.querySelector("#out")!.setAttribute("data-n", "2");
      await settle();
      root.querySelector("#out")!.setAttribute("data-n", "3");
      await settle();
      const messages = warnings();
      const count = (text: string) => messages.filter((m) => m.includes(text)).length;
      expect(count('unknown option "speed"')).toBe(1);
      expect(count('option "timeout" needs a positive number')).toBe(1);
      expect(count('option "delay" needs a positive number')).toBe(1);
      expect(count('option "first-render" takes no value')).toBe(1);
      expect(count('option "if-active" must be skip or replace')).toBe(1);
      expect(count('option "types" needs strings')).toBe(1);
      expect(count('option "scope" is not supported yet')).toBe(1);
      expect(count('option "until" needs a selector or a promise')).toBe(1);
      // malformed options fall back to defaults; the writes still transition
      expect(stub.calls.length).toBeGreaterThanOrEqual(1);
      expect(root.querySelector("#out")!.getAttribute("data-copy")).toBe("3");
    });
  });

  describe("DevTools", () => {
    const publications: { path: PublicizePath; meta: PublicizeMeta }[] = [];
    const renderers: QuarkRenderer[] = [];
    const installHook = () => {
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
    };
    afterEach(() => {
      delete (globalThis as any)[NUCLEUS_DEVTOOLS_HOOK_KEY];
      publications.length = 0;
      renderers.length = 0;
    });
    const transitions = () =>
      publications.filter((p) => pathMatches(p.path, ["quark", "transition"])).map((p) => p.meta);

    it("publishes quark/transition start, settled and skip records", async () => {
      installHook();
      const { root } = mount(
        `<p id="out" data-n="1"></p>`,
        `#out { @view-transition (types: "count") { data-copy: attr("data-n"); } }`
      );
      await settle();
      const out = root.querySelector("#out")!;
      out.setAttribute("data-n", "2");
      await settle();
      expect(transitions()).toEqual([{ phase: "skip", reason: "unsupported", types: ["count"], paints: 1 }]);
      stub = installViewTransitionStub();
      out.setAttribute("data-n", "3");
      await settle();
      await stub.calls[0].updateCallbackDone;
      expect(transitions().slice(1)).toEqual([
        { phase: "start", types: ["count"], paints: 1 },
        { phase: "settled", result: "settled", types: ["count"], paints: 1 },
      ]);
      publications.length = 0;
      // the same value again: the rule re-runs, nothing to animate
      out.setAttribute("data-n", "3");
      await settle();
      expect(transitions()).toEqual([{ phase: "skip", reason: "unchanged", types: ["count"], paints: 1 }]);
    });

    it("sheets() names the block each write sits in; a block adds no rule", async () => {
      installHook();
      const { quark, register } = createSheet(
        `<p id="out"></p>`,
        `#out { data-a: 1; @view-transition (types: "t") { data-b: 2; span { data-c: 3; } } }`
      );
      register();
      await flush();
      const sheet = renderers.find((r) => r.kind === "quark")!.sheets().find((s) => s.sheetId === quark.id)!;
      expect(sheet.rules.map((r) => [r.selector, r.declarations])).toEqual([
        ["#out", [{ key: "data-a", value: "1" }, { key: "data-b", value: "2", transition: '@view-transition (types: "t")' }]],
        ["#out span", [{ key: "data-c", value: "3", transition: '@view-transition (types: "t")' }]],
      ]);
      expect("transition" in sheet.rules[0].declarations[0]).toBe(false);
    });
  });
});
