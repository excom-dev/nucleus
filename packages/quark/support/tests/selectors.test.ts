/**
 * Selector features whose dependencies point sideways or upward: logical
 * pseudos with complex args, sibling combinators, `:has()`, structural
 * (position / children) and attribute-backed pseudos, class / id
 * selectors (token-filtered `class` records), and the child-removal
 * observation they need. Each case asserts DOM
 * correctness; the key ones keep a complexity budget as a baseline.
 *
 * happy-dom limits, worked around here: its selector cache goes stale
 * for `:has()` / sibling matches (bypassed below); `:is()` / `:not()`
 * keep only the first compound of a complex arg; `:enabled`,
 * `:required`, `:read-only`, `:any-link`, `:lang()`, `:open` never
 * match. Those are covered by the classifier tests in
 * `selector-analysis.test.ts`.
 */
import { Quark } from "../../index";
import { QuarkLogger } from "../../src/utils";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  bypassSelectorCache,
  createSheet,
  expectComplexity,
  flush,
  measureComplexity,
  mount,
  unregisterAll,
} from "./helpers";

const attrsOf = (root: ParentNode, selector: string, attr: string) =>
  [...root.querySelectorAll(selector)].map((el) => el.getAttribute(attr));

describe("selector features", () => {
  let restoreSelectorCache: () => void;
  beforeAll(() => {
    restoreSelectorCache = bypassSelectorCache();
  });
  afterAll(() => restoreSelectorCache());
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe(":is() / :where() / :not()", () => {
    it("observes attributes in simple arguments like the compound's own", async () => {
      const { root } = mount(
        `<ul><li></li><li></li></ul>`,
        `li:is([data-a], [data-b]) { data-hit: ""; }
         li:where(:not([data-a]):not([data-b])) { data-hit: none; }`
      );
      await flush();
      expect(attrsOf(root, "li", "data-hit")).toEqual([null, null]);

      const [first, second] = root.querySelectorAll("li");
      first.setAttribute("data-a", "");
      second.setAttribute("data-b", "");
      await flush();
      expect(attrsOf(root, "li", "data-hit")).toEqual(["", ""]);

      first.removeAttribute("data-a");
      await flush();
      expect(attrsOf(root, "li", "data-hit")).toEqual([null, ""]);
    });

    it("observes :not() arguments on ancestor compounds", async () => {
      const { root, quark, register } = createSheet(
        `<section><ul><li></li><li></li></ul></section>`,
        `section:not([data-off]) li { data-lit: ""; }
         section[data-off] li { data-lit: none; }`
      );
      register();
      await flush();
      expect(attrsOf(root, "li", "data-lit")).toEqual(["", ""]);

      const meter = measureComplexity(quark);
      root.querySelector("section")!.setAttribute("data-off", "");
      await flush();
      expect(attrsOf(root, "li", "data-lit")).toEqual([null, null]);

      root.querySelector("section")!.removeAttribute("data-off");
      await flush();
      const budget = meter.take();
      meter.stop();
      expect(attrsOf(root, "li", "data-lit")).toEqual(["", ""]);
      expectComplexity(budget);
    });
  });

  describe("sibling combinators", () => {
    it("~ re-runs the following siblings when the earlier sibling changes", async () => {
      const { root, quark, register } = createSheet(
        `<form><input /><span></span><button></button></form>`,
        `input[data-valid] ~ button { disabled: none; }
         input:not([data-valid]) ~ button { disabled: ""; }`
      );
      register();
      await flush();
      const button = root.querySelector("button")!;
      expect(button.hasAttribute("disabled")).toBe(true);

      const meter = measureComplexity(quark);
      root.querySelector("input")!.setAttribute("data-valid", "");
      await flush();
      expect(button.hasAttribute("disabled")).toBe(false);

      root.querySelector("input")!.removeAttribute("data-valid");
      await flush();
      const budget = meter.take();
      meter.stop();
      expect(button.hasAttribute("disabled")).toBe(true);
      expectComplexity(budget);
    });

    it("+ follows the current marker along a list", async () => {
      const { root } = mount(
        `<ol><li data-current></li><li></li><li></li></ol>`,
        `li[data-current] + li { data-next: ""; }
         li:not([data-current]) + li { data-next: none; }`
      );
      await flush();
      expect(attrsOf(root, "li", "data-next")).toEqual([null, "", null]);

      const [first, second] = root.querySelectorAll("li");
      first.removeAttribute("data-current");
      second.setAttribute("data-current", "");
      await flush();
      expect(attrsOf(root, "li", "data-next")).toEqual([null, null, ""]);
    });

    it("re-evaluates adjacency when an element between two siblings is removed or inserted", async () => {
      const { root } = mount(
        `<article><h2></h2><div></div><p></p></article>`,
        `h2 + p { data-lead: ""; }
         :not(h2) + p { data-lead: none; }`
      );
      await flush();
      const p = root.querySelector("p")!;
      expect(p.hasAttribute("data-lead")).toBe(false);

      root.querySelector("article > div")!.remove();
      await flush();
      expect(p.hasAttribute("data-lead")).toBe(true);

      root.querySelector("h2")!.after(document.createElement("div"));
      await flush();
      expect(p.hasAttribute("data-lead")).toBe(false);
    });

    it("reaches subjects below a following sibling", async () => {
      const { root } = mount(
        `<div><nav></nav><main><span></span></main></div>`,
        `nav[data-open] ~ main span { content: "open"; }
         nav:not([data-open]) ~ main span { content: "closed"; }`
      );
      await flush();
      const span = root.querySelector("span")!;
      expect(span.textContent).toBe("closed");

      root.querySelector("nav")!.setAttribute("data-open", "");
      await flush();
      expect(span.textContent).toBe("open");
    });
  });

  describe("structural pseudo-classes", () => {
    it("re-positions :first-child / :last-child when a sibling is removed", async () => {
      const { root, quark, register } = createSheet(
        `<ul><li>a</li><li>b</li><li>c</li></ul>`,
        `li:first-child { data-pos: "first"; }
         li:last-child { data-pos: "last"; }
         li:not(:first-child):not(:last-child) { data-pos: "mid"; }`
      );
      register();
      await flush();
      expect(attrsOf(root, "li", "data-pos")).toEqual(["first", "mid", "last"]);

      const meter = measureComplexity(quark);
      root.querySelector("li")!.remove();
      await flush();
      const budget = meter.take();
      meter.stop();
      expect(attrsOf(root, "li", "data-pos")).toEqual(["first", "last"]);
      expectComplexity(budget);
    });

    it("re-stripes :nth-child() after a removal and an insertion", async () => {
      const { root } = mount(
        `<ul><li>1</li><li>2</li><li>3</li><li>4</li></ul>`,
        `li:nth-child(odd) { data-stripe: "odd"; }
         li:nth-child(even) { data-stripe: "even"; }`
      );
      await flush();
      expect(attrsOf(root, "li", "data-stripe")).toEqual([
        "odd",
        "even",
        "odd",
        "even",
      ]);

      root.querySelectorAll("li")[1].remove();
      await flush();
      expect(attrsOf(root, "li", "data-stripe")).toEqual([
        "odd",
        "even",
        "odd",
      ]);

      root.querySelector("ul")!.prepend(document.createElement("li"));
      await flush();
      expect(attrsOf(root, "li", "data-stripe")).toEqual([
        "odd",
        "even",
        "odd",
        "even",
      ]);
    });

    it("observes the attributes of `of S` on the siblings", async () => {
      const { root } = mount(
        `<ul><li data-visible></li><li data-visible></li><li></li></ul>`,
        `li:nth-child(1 of [data-visible]) { data-first-visible: ""; }
         li:not(:nth-child(1 of [data-visible])) { data-first-visible: none; }`
      );
      await flush();
      expect(attrsOf(root, "li", "data-first-visible")).toEqual([
        "",
        null,
        null,
      ]);

      root.querySelector("li")!.removeAttribute("data-visible");
      await flush();
      expect(attrsOf(root, "li", "data-first-visible")).toEqual([
        null,
        "",
        null,
      ]);
    });

    it("tracks :only-child and :empty through insertions and removals", async () => {
      const { root } = mount(
        `<ul></ul>`,
        `ul:empty { data-empty: ""; }
         ul:not(:empty) { data-empty: none; }
         li:only-child { data-only: ""; }
         li:not(:only-child) { data-only: none; }`
      );
      await flush();
      const ul = root.querySelector("ul")!;
      expect(ul.hasAttribute("data-empty")).toBe(true);

      ul.append(document.createElement("li"));
      await flush();
      expect(ul.hasAttribute("data-empty")).toBe(false);
      expect(attrsOf(root, "li", "data-only")).toEqual([""]);

      ul.append(document.createElement("li"));
      await flush();
      expect(attrsOf(root, "li", "data-only")).toEqual([null, null]);

      ul.querySelectorAll("li").forEach((li) => li.remove());
      await flush();
      expect(ul.hasAttribute("data-empty")).toBe(true);
    });

    it("moves :last-child when iterate() drops rows", async () => {
      const list = fixture<HTMLElement & { provision?: string[] }>(
        `<x-list><section><div id="sheet"></div><ul><template><li></li></template></ul></section></x-list>`
      );
      list.provision = ["a", "b", "c"];
      const quark = new Quark({
        src: `x-list { $items: prop("provision"); }
              ul { content: iterate($items); }
              li { content: item; }
              li:last-child { data-last: ""; }
              li:not(:last-child) { data-last: none; }`,
        options: { isScoped: false },
      });
      quark.register({ sheetElement: list.querySelector("#sheet")! });
      await flush();
      expect(attrsOf(list, "li", "data-last")).toEqual([null, null, ""]);

      list.provision = ["a", "b"];
      await flush();
      expect(attrsOf(list, "li", "data-last")).toEqual([null, ""]);
      quark.unregister();
    });
  });

  describe(":has()", () => {
    it("re-checks the subject when an attribute named in the argument changes below it", async () => {
      const { root, quark, register } = createSheet(
        `<details><summary></summary><div><span></span></div></details>`,
        `details:has([data-active]) { data-highlight: ""; }
         details:not(:has([data-active])) { data-highlight: none; }`
      );
      register();
      await flush();
      const details = root.querySelector("details")!;
      expect(details.hasAttribute("data-highlight")).toBe(false);

      const meter = measureComplexity(quark);
      root.querySelector("span")!.setAttribute("data-active", "");
      await flush();
      expect(details.hasAttribute("data-highlight")).toBe(true);

      root.querySelector("span")!.removeAttribute("data-active");
      await flush();
      const budget = meter.take();
      meter.stop();
      expect(details.hasAttribute("data-highlight")).toBe(false);
      expectComplexity(budget);
    });

    it("re-checks the subject when elements are inserted or removed below it", async () => {
      const { root } = mount(
        `<ul></ul>`,
        `ul:has(li) { data-has-items: ""; }
         ul:not(:has(li)) { data-has-items: none; }`
      );
      await flush();
      const ul = root.querySelector("ul")!;
      expect(ul.hasAttribute("data-has-items")).toBe(false);

      ul.append(document.createElement("li"));
      await flush();
      expect(ul.hasAttribute("data-has-items")).toBe(true);

      ul.querySelector("li")!.remove();
      await flush();
      expect(ul.hasAttribute("data-has-items")).toBe(false);
    });

    it("fans out below a :has() ancestor compound", async () => {
      const { root } = mount(
        `<section><div><p></p></div><button></button></section>`,
        `section:has([data-open]) button { disabled: ""; }
         section:not(:has([data-open])) button { disabled: none; }`
      );
      await flush();
      const button = root.querySelector("button")!;
      expect(button.hasAttribute("disabled")).toBe(false);

      root.querySelector("p")!.setAttribute("data-open", "");
      await flush();
      expect(button.hasAttribute("disabled")).toBe(true);

      root.querySelector("p")!.removeAttribute("data-open");
      await flush();
      expect(button.hasAttribute("disabled")).toBe(false);
    });

    it("re-runs every matching ancestor of the change", async () => {
      const { root } = mount(
        `<div><div><span></span></div></div>`,
        `div:has([data-x]) { data-deep: ""; }
         div:not(:has([data-x])) { data-deep: none; }`
      );
      await flush();
      root.querySelector("span")!.setAttribute("data-x", "");
      await flush();
      expect(attrsOf(root, "div:not(#sheet)", "data-deep")).toEqual(["", ""]);

      root.querySelector("span")!.removeAttribute("data-x");
      await flush();
      expect(attrsOf(root, "div:not(#sheet)", "data-deep")).toEqual([
        null,
        null,
      ]);
    });

    it("supports child-relative arguments", async () => {
      const { root } = mount(
        `<ul><li><ul><li></li></ul></li></ul>`,
        `ul:has(> li[data-open]) { data-open-child: ""; }
         ul:not(:has(> li[data-open])) { data-open-child: none; }`
      );
      await flush();
      const [outer, inner] = root.querySelectorAll("ul");
      inner.querySelector("li")!.setAttribute("data-open", "");
      await flush();
      expect(outer.hasAttribute("data-open-child")).toBe(false);
      expect(inner.hasAttribute("data-open-child")).toBe(true);
    });

    it("re-runs sibling-relative arguments from the host", async () => {
      const { root } = mount(
        `<form><label></label><input /></form>`,
        `label:has(+ input[data-invalid]) { data-error: ""; }
         label:not(:has(+ input[data-invalid])) { data-error: none; }`
      );
      await flush();
      const label = root.querySelector("label")!;
      expect(label.hasAttribute("data-error")).toBe(false);

      root.querySelector("input")!.setAttribute("data-invalid", "");
      await flush();
      expect(label.hasAttribute("data-error")).toBe(true);

      root.querySelector("input")!.removeAttribute("data-invalid");
      await flush();
      expect(label.hasAttribute("data-error")).toBe(false);
    });

    it("derives a host aggregate with :scope:has()", async () => {
      const { root, quark, register } = createSheet(
        `<ul><li></li><li></li></ul><button></button>`,
        `:scope:has(li[data-selected]) { data-has-selection: ""; button { disabled: none; } }
         :scope:not(:has(li[data-selected])) { data-has-selection: none; button { disabled: ""; } }`
      );
      register();
      await flush();
      const button = root.querySelector("button")!;
      expect(root.hasAttribute("data-has-selection")).toBe(false);
      expect(button.hasAttribute("disabled")).toBe(true);

      const meter = measureComplexity(quark);
      root.querySelector("li")!.setAttribute("data-selected", "");
      await flush();
      expect(root.hasAttribute("data-has-selection")).toBe(true);
      expect(button.hasAttribute("disabled")).toBe(false);

      root.querySelector("li")!.remove();
      await flush();
      const budget = meter.take();
      meter.stop();
      expect(root.hasAttribute("data-has-selection")).toBe(false);
      expect(button.hasAttribute("disabled")).toBe(true);
      expectComplexity(budget);
    });

    it("lets a global sheet match a :has() subject above its host", async () => {
      const provider = fixture<HTMLElement>(
        `<x-provider><section><div id="sheet"></div><p></p></section></x-provider>`
      );
      const quark = new Quark({
        src: `x-provider:has(p[data-ready]) { data-ready: ""; }
              x-provider:not(:has(p[data-ready])) { data-ready: none; }`,
        options: { isScoped: false },
      });
      quark.register({ sheetElement: provider.querySelector("#sheet")! });
      await flush();
      expect(provider.hasAttribute("data-ready")).toBe(false);

      provider.querySelector("p")!.setAttribute("data-ready", "");
      await flush();
      expect(provider.hasAttribute("data-ready")).toBe(true);
      quark.unregister();
    });
  });

  describe("attribute-backed pseudo-classes", () => {
    it("re-runs :disabled when the disabled attribute changes", async () => {
      const { root } = mount(
        `<button></button>`,
        `button:disabled { data-state: "off"; }
         button:not(:disabled) { data-state: "on"; }`
      );
      await flush();
      const button = root.querySelector("button")!;
      expect(button.getAttribute("data-state")).toBe("on");

      button.setAttribute("disabled", "");
      await flush();
      expect(button.getAttribute("data-state")).toBe("off");

      button.removeAttribute("disabled");
      await flush();
      expect(button.getAttribute("data-state")).toBe("on");
    });
  });

  describe("class and id selectors", () => {
    it("re-runs a rule when a class it names is added or removed", async () => {
      const { root } = mount(
        `<ul><li></li><li class="is-done"></li></ul>`,
        `li.is-done { data-hit: ""; }
         li:not(.is-done) { data-hit: none; }`
      );
      await flush();
      expect(attrsOf(root, "li", "data-hit")).toEqual([null, ""]);

      const [first, second] = root.querySelectorAll("li");
      first.classList.add("is-done");
      second.classList.remove("is-done");
      await flush();
      expect(attrsOf(root, "li", "data-hit")).toEqual(["", null]);
    });

    it("fans out below an ancestor whose class changes", async () => {
      const { root, quark, register } = createSheet(
        `<article><ul><li></li><li></li></ul></article>`,
        `article.is-open li { data-lit: ""; }
         article:not(.is-open) li { data-lit: none; }`
      );
      register();
      await flush();
      expect(attrsOf(root, "li", "data-lit")).toEqual([null, null]);

      const meter = measureComplexity(quark);
      root.querySelector("article")!.className = "is-open";
      await flush();
      expect(attrsOf(root, "li", "data-lit")).toEqual(["", ""]);

      root.querySelector("article")!.className = "";
      await flush();
      const budget = meter.take();
      meter.stop();
      expect(attrsOf(root, "li", "data-lit")).toEqual([null, null]);
      expectComplexity(budget);
    });

    it("re-checks :has() when a class changes below the subject", async () => {
      const { root } = mount(
        `<ul><li></li><li></li></ul>`,
        `:scope:has(li.is-active) { data-has-active: ""; }
         :scope:not(:has(li.is-active)) { data-has-active: none; }`
      );
      await flush();
      expect(root.hasAttribute("data-has-active")).toBe(false);

      const li = root.querySelector("li")!;
      li.classList.add("is-active");
      await flush();
      expect(root.hasAttribute("data-has-active")).toBe(true);

      li.classList.remove("is-active");
      await flush();
      expect(root.hasAttribute("data-has-active")).toBe(false);
    });

    it("re-runs #id rules when an id changes", async () => {
      const { root } = mount(
        `<p></p><p id="main"></p>`,
        `p#main { data-main: ""; }
         p:not(#main) { data-main: none; }`
      );
      await flush();
      expect(attrsOf(root, "p", "data-main")).toEqual([null, ""]);

      const [first, second] = root.querySelectorAll("p");
      second.id = "aside";
      first.id = "main";
      await flush();
      expect(attrsOf(root, "p", "data-main")).toEqual(["", null]);
    });

    it("ignores class changes that touch no class the sheet names", async () => {
      const { root, quark } = mount(
        `<ul><li></li></ul>`,
        `li.is-done { data-hit: ""; }`
      );
      await flush();
      const runSpy = vi.spyOn(quark, "run");
      const li = root.querySelector("li")!;
      li.classList.add("fade-in");
      li.className = "fade-in highlight";
      await flush();
      expect(runSpy).not.toHaveBeenCalled();

      li.classList.add("is-done");
      await flush();
      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(li.getAttribute("data-hit")).toBe("");
    });

    it("observes every class change when a rule reads the whole value", async () => {
      const { root } = mount(
        `<ul><li class="a"></li></ul>`,
        `li.a { data-classes: attr("class"); }`
      );
      await flush();
      const li = root.querySelector("li")!;
      expect(li.getAttribute("data-classes")).toBe("a");

      li.classList.add("b");
      await flush();
      expect(li.getAttribute("data-classes")).toBe("a b");
    });

    it("reacts to classes Quark writes, including on the same element", async () => {
      const { root } = mount(
        `<ul><li></li><li data-done></li></ul>`,
        `li[data-done] { class: (is-done: true); }
         li.is-done { class: (is-struck: true); data-struck: ""; }`
      );
      await flush();
      const [first, second] = root.querySelectorAll("li");
      expect(second.className).toBe("is-done is-struck");
      expect(second.getAttribute("data-struck")).toBe("");

      first.setAttribute("data-done", "");
      await flush();
      expect(first.className).toBe("is-done is-struck");
      expect(first.getAttribute("data-struck")).toBe("");

      // re-run with the classes already in place: no write, no churn
      const observed = vi.fn();
      new MutationObserver(observed).observe(first, { attributes: true });
      first.classList.remove("is-done");
      first.classList.add("is-done");
      await flush();
      expect(first.className).toBe("is-struck is-done");
      expect(observed).toHaveBeenCalledTimes(1);
    });
  });

  describe("observation plumbing", () => {
    it("does not observe removals for a sheet without position-dependent rules", async () => {
      const { root, quark } = mount(
        `<ul><li></li><li></li></ul>`,
        `li { data-seen: ""; }`
      );
      await flush();
      const runSpy = vi.spyOn(quark, "run");
      root.querySelector("li")!.remove();
      await flush();
      expect(runSpy).not.toHaveBeenCalled();
    });

    it("observes removals once a rule depends on children or position", async () => {
      const { root, quark } = mount(
        `<ul><li></li><li></li></ul>`,
        `li:last-child { data-last: ""; }`
      );
      await flush();
      const runSpy = vi.spyOn(quark, "run");
      root.querySelector("li")!.remove();
      await flush();
      expect(runSpy).toHaveBeenCalledTimes(1);
    });

    it("fans out from every path ancestor changed in one batch", async () => {
      const { root } = mount(
        `<div id="a1"><em><b></b></em></div><div id="a2" data-x><em><b></b></em></div>`,
        `div[data-x] em[data-y] b { data-hit: ""; }`
      );
      await flush();
      root.querySelector("#a1")!.setAttribute("data-x", "");
      root.querySelector("#a1 em")!.setAttribute("data-y", "");
      root.querySelector("#a2 em")!.setAttribute("data-y", "");
      await flush();
      expect(attrsOf(root, "b", "data-hit")).toEqual(["", ""]);
    });

    it("warns once about a pseudo-class it cannot observe", async () => {
      const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
      mount(
        `<a><span></span></a>`,
        `a:hover { data-hot: ""; span { content: "x"; } }
         a:not([href]) { data-plain: ""; }`
      );
      await flush();
      const messages = warn.mock.calls.map(
        (c) => (c[0] as { message: string }).message
      );
      expect(messages.filter((m) => m.includes(":hover"))).toHaveLength(1);
      expect(messages[0]).toContain("not observed");
    });
  });
});
