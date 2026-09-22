/**
 * Sheet lifecycle and scheduling edge cases: registration guards, hosts
 * that disappear, queued elements that leave the DOM, fan-out ordering of
 * mixed mutation kinds, prop() subscriptions on late-defined elements, and
 * verbose logging paths.
 */
import { Quark } from "../../index";
import { subscribeProp } from "../../src/props";
import { QuarkLogger } from "../../src/utils";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { createSheet, flush, mount, unregisterAll } from "./helpers";

/** A WeakRef whose target is already gone (GC cannot be forced). */
const deadRef = <T extends object>(): WeakRef<T> => {
  const ref = Object.create(WeakRef.prototype);
  ref.deref = () => undefined;
  return ref;
};

describe("lifecycle", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("registration", () => {
    it("refuses to register twice", async () => {
      const { quark, register } = createSheet(`<p></p>`, `p { data-x: "1"; }`);
      register();
      expect(() => register()).toThrow("already registered");
      await flush();
    });

    it("skips the first run when unregistered while @use modules load", async () => {
      const original = Quark.moduleLoader;
      Quark.moduleLoader = () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ greet: () => "hi" }), 5)
        );
      const { root, quark, register } = createSheet(
        `<p bind-x></p>`,
        `@use "/slow" as *;
         [bind-x] { content: greet(); }`
      );
      register();
      quark.unregister();
      await wait(20);
      expect(root.querySelector("[bind-x]")?.textContent).toBe("");
      Quark.moduleLoader = original;
    });

    it('wraps a sheet that only imports and derives an empty namespace from "/"', async () => {
      const original = Quark.moduleLoader;
      Quark.moduleLoader = async () => ({ hi: () => "x" });
      const onlyUse = new Quark({
        src: `@use "/x" as *;`,
        options: { isScoped: true },
      });
      expect(onlyUse.src).toBe(`@use "/x" as *;@scope{}`);
      const { root, register } = createSheet(
        `<p bind-x></p>`,
        `@use "/";
         [bind-x] { content: "ok"; }`
      );
      register();
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("ok");
      Quark.moduleLoader = original;
    });

    it("logs errors instead of throwing when the host is gone", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const original = Quark.moduleLoader;
      Quark.moduleLoader = async () => ({});
      const { root, quark, register } = createSheet(
        `<p bind-x></p>`,
        `@use "/x" as *;
         [bind-x] { content: $n; data-len: prop("value"); }`
      );
      register();
      const realHost = quark.host;
      quark.host = deadRef();
      await flush();
      // runAll + observer creation both report the missing host
      expect(error.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(quark.observer).toBeNull();
      const p = root.querySelector("[bind-x]") as HTMLElement;
      quark.applyBindingChange(p, { name: "$n" });
      quark.handlePropChange(
        new CustomEvent("quark-prop-change", { detail: { names: ["value"] } })
      );
      quark.runElement(p, ["RUN_ALL"]);
      // unregistering without a host skips the publication and marker release
      quark.unregister();
      expect(quark.isRegistered).toBe(false);
      quark.host = realHost;
      Quark.moduleLoader = original;
    });

    it("runs once without listening or observing when observe is off", async () => {
      const { root, quark, register } = createSheet(
        `<p bind-x data-mode="a"></p>`,
        `[bind-x][data-mode="a"] { content: "a"; }
         [bind-x][data-mode="b"] { content: "b"; }`,
        undefined,
        { observe: false }
      );
      register();
      await flush();
      const p = root.querySelector("[bind-x]")!;
      expect(p.textContent).toBe("a");
      expect(quark.observer).toBeNull();
      p.setAttribute("data-mode", "b");
      await flush();
      expect(p.textContent).toBe("a");
    });

    it("loads @use imports written inside a rule block", async () => {
      const original = Quark.moduleLoader;
      Quark.moduleLoader = async () => ({ greet: () => "hi" });
      const { root, register } = createSheet(
        `<p bind-x></p>`,
        `[bind-x] { @use "/x" as *; content: greet(); }`
      );
      register();
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("hi");
      Quark.moduleLoader = original;
    });

    it("ignores prop subscriptions before registration", () => {
      const quark = new Quark({ src: `p { data-x: prop("value"); }` });
      const el = document.createElement("input");
      expect(() => quark.subscribeProp(el, "value")).not.toThrow();
    });
  });

  describe("scheduling", () => {
    it("drops queued elements that left the DOM before the run", async () => {
      const { quark } = mount(`<p></p>`, `p { data-x: "1"; }`);
      await flush();
      const run = vi.spyOn(quark, "run");
      const detached = document.createElement("p");
      quark.queueRunRules({ element: detached, attribute: "NEW_SELF" });
      await flush();
      expect(run).not.toHaveBeenCalled();
    });

    it("orders mixed mutation kinds per element deterministically", async () => {
      const { root, quark } = mount(
        `<div bind-a><span></span></div><div bind-b><span></span></div>
         <div bind-c><span></span></div><div bind-d><span></span></div>
         <div bind-e><span></span></div>`,
        `div span { data-x: "1"; }`
      );
      await flush();
      root.querySelectorAll("span").forEach((s) => s.removeAttribute("data-x"));
      const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map(
        (n) => root.querySelector(`div[bind-${n}]`) as HTMLElement
      );
      // a connected element outside the host is never fanned out from
      const outside = document.createElement("div");
      outside.innerHTML = "<span></span>";
      document.body.appendChild(outside);
      quark.ELEMENTS_TO_MATCH.set(a, new Set(["data-y", "RUN_ALL"]));
      quark.ELEMENTS_TO_MATCH.set(
        b,
        new Set(["data-y", "NEW_SELF", "content"])
      );
      quark.ELEMENTS_TO_MATCH.set(
        c,
        new Set(["content", "NEW_SELF", "data-y"])
      );
      quark.ELEMENTS_TO_MATCH.set(d, new Set(["RUN_ALL", "content", "data-y"]));
      quark.ELEMENTS_TO_MATCH.set(e, new Set(["data-y", "data-z", "content"]));
      quark.ELEMENTS_TO_MATCH.set(
        outside,
        new Set(["NEW_SELF", "content", "$n"])
      );
      quark.runRules();
      await flush();
      expect(
        [...root.querySelectorAll("span")].map((s) => s.getAttribute("data-x"))
      ).toEqual(["1", "1", "1", "1", "1"]);
      expect(outside.querySelector("span")?.hasAttribute("data-x")).toBe(false);
    });

    it("fans out from a mid-path ancestor gate", async () => {
      const { root } = mount(
        `<div><article><span bind-x></span></article></div>`,
        `div[data-a] article[data-b] [bind-x] { content: "deep"; }`
      );
      await flush();
      root.querySelector("div:not(#sheet)")!.setAttribute("data-a", "");
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("");
      root.querySelector("article")!.setAttribute("data-b", "");
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("deep");
    });

    it("re-runs only the readers of a binding written from JS, not sibling listeners", async () => {
      const handler = vi.fn();
      const { root, quark } = mount(
        `<article><button type="button" bind-x></button></article>`,
        `article { $n: 1; }
         [bind-x] { @on click (handle: handler); content: $n; }`,
        { handler }
      );
      await flush();
      const article = root.querySelector("article") as HTMLElement;
      const listenerRun = vi.spyOn(quark.rules[1].listeners[0], "_run");
      article.quark.setProperty("$n", 2);
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("2");
      expect(listenerRun).not.toHaveBeenCalled();
      // a write queued outside any run is announced by the next run
      quark.queueBindingChange(article, { name: "$n" });
      quark.runElement(article, ["RUN_ALL"]);
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("2");
    });

    it("skips the property whose own key triggered the run", async () => {
      const { root } = mount(
        `<p bind-x data-a="a"></p>`,
        `[bind-x] { data-b: attr("data-a"); data-a: "x"; }`
      );
      await flush();
      const p = root.querySelector("[bind-x]")!;
      expect(p.getAttribute("data-a")).toBe("x");
      expect(p.getAttribute("data-b")).toBe("x");
      p.setAttribute("data-a", "y");
      await flush();
      // data-b re-read the attribute; data-a itself was not re-applied
      expect(p.getAttribute("data-b")).toBe("y");
      expect(p.getAttribute("data-a")).toBe("y");
    });

    it("fans out from a non-host ancestor in a global sheet", async () => {
      const { root } = mount(
        `<article><span bind-x></span></article>`,
        `article[data-open] [bind-x] { content: "open"; }`,
        undefined,
        { isScoped: false }
      );
      await flush();
      root.querySelector("article")!.setAttribute("data-open", "");
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("open");
    });

    it("matches every selector of a comma list", async () => {
      const { root } = mount(
        `<p></p><span></span>`,
        `p, span { data-x: "1"; }`
      );
      await flush();
      expect(root.querySelector("p")?.getAttribute("data-x")).toBe("1");
      expect(root.querySelector("span")?.getAttribute("data-x")).toBe("1");
    });
  });

  describe("binding change routing", () => {
    it("ignores events without a name, from outside the host, or already-run readers", async () => {
      const { root, quark } = mount(
        `<article><p bind-x></p></article>`,
        `article { $n: 1; }
         [bind-x] { content: $n; }`
      );
      await flush();
      const p = root.querySelector("[bind-x]") as HTMLElement;
      const run = vi.spyOn(quark, "run");
      quark.applyBindingChange(root.querySelector("article") as HTMLElement);
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      quark.applyBindingChange(outside, { name: "$n" });
      expect(run).not.toHaveBeenCalled();
      // a deferred-write trace showing the reader already ran after the write
      const reader = quark.rules[1].attributes[0];
      quark.applyBindingChange(p, {
        name: "$n",
        trace: {
          seq: 3,
          ran: new Map([[p, new Map([[reader, 3]])]]),
          visited: new Map(),
          written: new Set(),
          coverage: new Map(),
        },
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(p.textContent).toBe("1");
    });

    it("dispatches sibling-subtree writes that no reader above depends on", async () => {
      const { root } = mount(
        `<div class="a"><span bind-x></span></div><div class="b"><span bind-y></span></div>`,
        `.a { $x: "A"; }
         .a [bind-x] { content: $x; }
         .b [bind-y] { content: $x or "none"; }`
      );
      await flush();
      expect(root.querySelector("[bind-x]")?.textContent).toBe("A");
      expect(root.querySelector("[bind-y]")?.textContent).toBe("none");
    });
  });

  describe("prop change routing", () => {
    it("ignores prop events without names or from outside a scoped host", async () => {
      const { quark } = mount(
        `<input value="v">`,
        `input { data-len: prop("value").length; }`
      );
      await flush();
      const run = vi.spyOn(quark, "run");
      const outside = document.createElement("input");
      document.body.appendChild(outside);
      outside.dispatchEvent(
        new CustomEvent("quark-prop-change", {
          bubbles: true,
          detail: { names: ["value"] },
        })
      );
      outside.dispatchEvent(
        new CustomEvent("quark-prop-change", { bubbles: true })
      );
      expect(run).not.toHaveBeenCalled();
    });

    it("re-observes a custom element's property once it upgrades", async () => {
      const el = document.createElement("x-late-upgrade") as HTMLElement & {
        provision?: string;
      };
      document.body.appendChild(el);
      const release = subscribeProp(el, "provision");
      const heard = vi.fn();
      el.addEventListener("quark-prop-change", heard);
      customElements.define("x-late-upgrade", class extends HTMLElement {});
      await customElements.whenDefined("x-late-upgrade");
      await wait(0);
      el.provision = "after";
      await wait(0);
      expect(heard).toHaveBeenCalledTimes(1);
      release();
      release();
      el.provision = "released";
      await wait(0);
      expect(heard).toHaveBeenCalledTimes(1);
    });

    it("does not re-observe a subscription released before the upgrade", async () => {
      const el = document.createElement("x-late-release") as HTMLElement & {
        provision?: string;
      };
      document.body.appendChild(el);
      const release = subscribeProp(el, "provision");
      release();
      customElements.define("x-late-release", class extends HTMLElement {});
      await customElements.whenDefined("x-late-release");
      await wait(0);
      const heard = vi.fn();
      el.addEventListener("quark-prop-change", heard);
      el.provision = "after";
      await wait(0);
      expect(heard).not.toHaveBeenCalled();
    });

    it("drops coalesced changes for elements that left the DOM", async () => {
      const el = document.createElement("div") as HTMLElement & {
        thing?: number;
      };
      document.body.appendChild(el);
      const release = subscribeProp(el, "thing");
      const heard = vi.fn();
      el.addEventListener("quark-prop-change", heard);
      el.thing = 1;
      el.remove();
      await wait(0);
      expect(heard).not.toHaveBeenCalled();
      release();
    });
  });

  describe("verbose logging", () => {
    it("logs run, match and paint details at info level", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const level = QuarkLogger.level;
      QuarkLogger.level = 4;
      try {
        const { root } = mount(
          `<ul><template><li bind-label></li></template></ul>`,
          `ul { $items: items; content: iterate($items); }
           [bind-label] { content: item; }`,
          { items: ["a"] }
        );
        await flush();
        expect(root.querySelector("li")?.textContent).toBe("a");
      } finally {
        QuarkLogger.level = level;
      }
      const methods = log.mock.calls.map((args) => String(args[2] ?? ""));
      expect(methods.some((m) => m.startsWith("run"))).toBe(true);
      expect(methods.some((m) => m.startsWith("foundElements"))).toBe(true);
      expect(methods.some((m) => m.startsWith("triggerPaint"))).toBe(true);
    });
  });

  describe("registry", () => {
    it("finds rules by id and by selector tail", async () => {
      const { quark } = mount(
        `<p bind-x></p>`,
        `article [bind-x] { data-x: "1"; }`
      );
      await flush();
      const { QuarkRegistry } = await import("../../src/quark");
      expect(QuarkRegistry.findRules(quark.rules[0].id)).toEqual([
        quark.rules[0],
      ]);
      expect(QuarkRegistry.findRules("bind-x")).toContain(quark.rules[0]);
      expect(QuarkRegistry.findRules("article")).not.toContain(quark.rules[0]);
    });
  });
});

describe("fixture sanity", () => {
  it("keeps custom-element definitions from leaking between tests", () => {
    expect(customElements.get("x-late-upgrade")).toBeDefined();
    expect(fixture<HTMLElement>("<div></div>").tagName).toBe("DIV");
    document.body.innerHTML = "";
  });
});
