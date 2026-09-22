/**
 * Feature coverage for Quark. Each case asserts DOM correctness and a complexity
 * budget. Broken expected behavior is left failing (do not "fix" via source/test
 * hacks) so regressions stay visible.
 */
import { Quark } from "../../index";
import { isObservedProperty } from "@excom/kit-utils";
import { QuarkLogger } from "../../src/utils";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  createSheet,
  expectComplexity,
  flush,
  measureComplexity,
  unregisterAll,
} from "./helpers";

const bindIterateRows = async (root: ParentNode) => {
  await flush();
  return [...root.querySelectorAll("ul > li")];
};

describe("Quark features", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("content", () => {
    it("clears text with content: none", async () => {
      const { root, quark, register } = createSheet(
        `<p>stale</p>`,
        `p { content: none; }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("p")?.textContent).toBe("");
      expectComplexity(budget);
      quark.unregister();
    });

    it("keeps // inside strings and ends /* */ comments correctly", async () => {
      const { root, quark, register } = createSheet(
        `<p></p><span></span>`,
        `/* a comment before a rule */
        p { content: "http://example.com/a"; } /* trailing comment */
        span { content: "ok"; }`
      );
      register();
      await flush();

      expect(root.querySelector("p")?.textContent).toBe("http://example.com/a");
      expect(root.querySelector("span")?.textContent).toBe("ok");
      quark.unregister();
    });

    it("renders a DOM template via template(#id)", async () => {
      const { root, quark, register } = createSheet(
        `<article></article>
         <template id="article-tmpl"><p bind-body>from-template</p></template>`,
        `article {
          content: template("#article-tmpl");
        }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("article p")?.textContent).toBe(
        "from-template"
      );
      expectComplexity(budget);
      quark.unregister();
    });

    it("renders a fetched template via template(url)", async () => {
      spyFetch({
        status: 200,
        body: `<p bind-body>from-url</p>`,
        headers: new Headers({ "content-type": "text/html" }),
      });
      const { root, quark, register } = createSheet(
        `<article></article>`,
        `article {
          content: template("/tpls/article.html");
        }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("article p")?.textContent).toBe("from-url");
      expectComplexity(budget);
      quark.unregister();
    });

    it("injects markup via dangerous-html()", async () => {
      const { root, quark, register } = createSheet(
        `<header></header>`,
        `header {
          content: dangerous-html(getMyHTML());
        }`,
        { getMyHTML: () => "<strong bind-x>hi</strong>" }
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("header strong")?.textContent).toBe("hi");
      expectComplexity(budget);
      quark.unregister();
    });

    it("toggles content from open state (details)", async () => {
      const { root, quark, register } = createSheet(
        `<details><p bind-status>idle</p></details>`,
        `details[open] [bind-status] { content: "opened"; }
         details:not([open]) [bind-status] { content: none; }`
      );
      register();
      await flush();
      expect(root.querySelector("[bind-status]")?.textContent).toBe("");

      const meter = measureComplexity(quark);
      root.querySelector("details")!.setAttribute("open", "");
      await flush();
      expect(root.querySelector("[bind-status]")?.textContent).toBe("opened");

      root.querySelector("details")!.removeAttribute("open");
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-status]")?.textContent).toBe("");
      expectComplexity(budget);
      quark.unregister();
    });

    describe("rendering into a <template> host", () => {
      it("writes a string into the template's document fragment", async () => {
        const { root, quark, register } = createSheet(
          `<template id="host"></template>`,
          `#host { content: "hello"; }`
        );
        const host = root.querySelector("#host") as HTMLTemplateElement;
        const meter = measureComplexity(quark);
        register();
        await flush();
        const budget = meter.take();
        meter.stop();

        // `textContent` on <template> does not write the fragment
        expect(host.content.textContent).toBe("hello");
        expect(host.childNodes).toHaveLength(0);
        expectComplexity(budget);
        quark.unregister();
      });

      it("writes a settled string into the template's document fragment", async () => {
        const { root, quark, register } = createSheet(
          `<template id="host"></template>`,
          `#host { content: getText(); }`,
          { getText: () => Promise.resolve("async-hello") }
        );
        const host = root.querySelector("#host") as HTMLTemplateElement;
        const meter = measureComplexity(quark);
        register();
        await flush();
        const budget = meter.take();
        meter.stop();

        expect(host.content.textContent).toBe("async-hello");
        expect(host.childNodes).toHaveLength(0);
        expectComplexity(budget);
        quark.unregister();
      });

      it("injects dangerous-html() into the fragment without requeueing rules", async () => {
        const { root, quark, register } = createSheet(
          `<template id="host"></template>`,
          `#host { content: dangerous-html(getMyHTML()); }`,
          { getMyHTML: () => "<strong>hi</strong>" }
        );
        const host = root.querySelector("#host") as HTMLTemplateElement;
        const meter = measureComplexity(quark);
        register();
        await flush();
        const budget = meter.take();
        meter.stop();

        expect(host.content.querySelector("strong")?.textContent).toBe("hi");
        expect(host.querySelector("strong")).toBeNull();
        expectComplexity(budget);
        quark.unregister();
      });

      it("clones template() onto a template host without requeueing rules", async () => {
        const { root, quark, register } = createSheet(
          `<template id="host"></template>
           <template id="src"><p>from-template</p></template>`,
          `#host { content: template("#src"); }`
        );
        const host = root.querySelector("#host") as HTMLTemplateElement;
        const meter = measureComplexity(quark);
        register();
        await flush();
        const budget = meter.take();
        meter.stop();

        expect(host.content.querySelector("p")?.textContent).toBe(
          "from-template"
        );
        expectComplexity(budget);
        quark.unregister();
      });

      it("paints a Node into a template host without requeueing rules", async () => {
        const node = document.createElement("span");
        node.textContent = "idle";
        const { root, quark, register } = createSheet(
          `<template id="host"></template>`,
          `#host { content: getNode(); }`,
          { getNode: () => node }
        );
        const host = root.querySelector("#host") as HTMLTemplateElement;
        const meter = measureComplexity(quark);
        register();
        await flush();
        const budget = meter.take();
        meter.stop();

        expect(host.content.querySelector("span")?.textContent).toBe("idle");
        expectComplexity(budget);
        quark.unregister();
      });

      it("paints a NodeList into a template host without requeueing rules", async () => {
        const wrap = document.createElement("div");
        wrap.innerHTML = `<span>a</span><span>b</span>`;
        const { root, quark, register } = createSheet(
          `<template id="host"></template>`,
          `#host { content: getNodes(); }`,
          { getNodes: () => wrap.childNodes }
        );
        const host = root.querySelector("#host") as HTMLTemplateElement;
        const meter = measureComplexity(quark);
        register();
        await flush();
        const budget = meter.take();
        meter.stop();

        expect(
          [...host.content.querySelectorAll("span")].map((el) => el.textContent)
        ).toEqual(["a", "b"]);
        expectComplexity(budget);
        quark.unregister();
      });
    });
  });

  describe("attributes and special fields", () => {
    it("sets boolean-ish empty attributes", async () => {
      const { root, quark, register } = createSheet(
        `<input />`,
        `input { autofocus: ""; }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("input")?.hasAttribute("autofocus")).toBe(true);
      expectComplexity(budget);
      quark.unregister();
    });

    it("applies dataset from an object", async () => {
      const { root, quark, register } = createSheet(
        `<span></span>`,
        `span {
          dataset: getMeta();
        }`,
        { getMeta: () => ({ userId: "42", role: "admin" }) }
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      const span = root.querySelector("span")!;
      expect(span.getAttribute("data-user-id")).toBe("42");
      expect(span.getAttribute("data-role")).toBe("admin");
      expectComplexity(budget);
      quark.unregister();
    });

    it("applies ariaset from an object", async () => {
      const { root, quark, register } = createSheet(
        `<button type="button"></button>`,
        `button {
          ariaset: getAria();
        }`,
        { getAria: () => ({ label: "Save", pressed: "false" }) }
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      const button = root.querySelector("button")!;
      expect(button.getAttribute("aria-label")).toBe("Save");
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expectComplexity(budget);
      quark.unregister();
    });

    it("sets class from a string", async () => {
      const { root, quark, register } = createSheet(
        `<div></div>`,
        `div { class: "flavor-a"; }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("div")?.getAttribute("class")).toBe("flavor-a");
      expectComplexity(budget);
      quark.unregister();
    });
  });

  describe("variables and expressions", () => {
    it("reads nested object fields from a JS module value", async () => {
      const { root, quark, register } = createSheet(
        `<main><span bind-id></span></main>`,
        `main {
          $myObj: getMyObj();
          [bind-id] { content: $myObj.id; }
        }`,
        { getMyObj: () => ({ id: "abc-123" }) }
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-id]")?.textContent).toBe("abc-123");
      expectComplexity(budget);
      quark.unregister();
    });

    it("concatenates simple string expressions", async () => {
      const { root, quark, register } = createSheet(
        `<output bind-label></output>`,
        `[bind-label] {
          content: "ID is " + getId();
        }`,
        { getId: () => "9" }
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("ID is 9");
      expectComplexity(budget);
      quark.unregister();
    });

    it("resolves ternary()", async () => {
      const { root, quark, register } = createSheet(
        `<span bind-label></span>`,
        `[bind-label] {
          content: ternary(true, "yes", "no");
        }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("yes");
      expectComplexity(budget);
      quark.unregister();
    });

    it("propagates null silently through accessors", async () => {
      const { root, quark, register } = createSheet(
        `<span bind-label></span>`,
        `[bind-label] {
          $pkg: getPkg();
          content: $pkg.cssAliases.length or "none";
          data-first: $pkg.cssAliases[0] or "empty";
          data-slug: $pkg.missing.toLowerCase() or "no-slug";
        }`,
        { getPkg: () => ({ name: "x" }) }
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      const el = root.querySelector("[bind-label]");
      expect(el?.textContent).toBe("none");
      expect(el?.getAttribute("data-first")).toBe("empty");
      expect(el?.getAttribute("data-slug")).toBe("no-slug");
      expectComplexity(budget);
      quark.unregister();
    });

    it("resolves CSS-style if() to the first truthy arm", async () => {
      const { root, quark, register } = createSheet(
        `<span bind-label></span>`,
        `[bind-label] {
          $count: getCount();
          content: if($count == 0: "none"; $count > 3: "many"; else: "few");
        }`,
        { getCount: () => 5 }
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("many");
      expectComplexity(budget);
      quark.unregister();
    });

    it("falls back to the else arm in if()", async () => {
      const { root, quark, register } = createSheet(
        `<span bind-label></span>`,
        `[bind-label] {
          content: if(false: "never"; else: "fallback");
        }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("fallback");
      expectComplexity(budget);
      quark.unregister();
    });

    it("reads attributes via attr()", async () => {
      const { root, quark, register } = createSheet(
        `<span bind-label data-src="from-attr"></span>`,
        `[bind-label] {
          content: attr("data-src");
        }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("from-attr");
      expectComplexity(budget);
      quark.unregister();
    });

    it("re-runs when an attr() attribute changes without a selector gate", async () => {
      const { root, quark, register } = createSheet(
        `<span bind-label></span>`,
        `:scope {
          $src: attr("data-src");
          [bind-label] { content: $src; }
        }`
      );
      const spy = vi.spyOn(quark, "queueRunRules");
      register();
      await flush();
      spy.mockClear();

      root.setAttribute("data-src", "hello");
      await wait(0);
      expect(quark.allAttrs).toContain("data-src");
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ attribute: "data-src", element: root })
      );

      const meter = measureComplexity(quark);
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("hello");
      expectComplexity(budget);
      quark.unregister();
    });

    it("does not rematch a sibling attr() rule when a different attribute changes", async () => {
      const { root, quark, register } = createSheet(
        `<span bind-celsius></span><span bind-fahrenheit></span>`,
        `:scope {
          $celsius: attr("celsius");
          [bind-fahrenheit] { content: $celsius; }
        }
        :scope {
          $fahrenheit: attr("fahrenheit");
          [bind-celsius] { content: $fahrenheit; }
        }`
      );
      register();
      await flush();

      root.setAttribute("celsius", "10");
      await flush();
      expect(root.querySelector("[bind-fahrenheit]")?.textContent).toBe("10");
      expect(root.querySelector("[bind-celsius]")?.textContent).toBe("");

      root.setAttribute("celsius", "20");
      await flush();
      expect(root.querySelector("[bind-fahrenheit]")?.textContent).toBe("20");
      expect(root.querySelector("[bind-celsius]")?.textContent).toBe("");
      quark.unregister();
    });

    it("warns when attr() is not a static string", async () => {
      QuarkLogger.suppress();
      const warnSpy = vi.spyOn(QuarkLogger, "warn");
      const { quark, register } = createSheet(
        `<span bind-label></span>`,
        `[bind-label] { content: attr($name); }`
      );
      register();
      await flush();
      expect(
        warnSpy.mock.calls.some((args) =>
          String((args[0] as { message?: string })?.message).includes("attr()")
        )
      ).toBe(true);
      warnSpy.mockRestore();
      QuarkLogger.unsuppress();
      quark.unregister();
    });

    it("resolves closest() to an ancestor element", async () => {
      const { root, quark, register } = createSheet(
        `<main data-section="alpha"><span bind-label></span></main>`,
        `[bind-label] {
          $host: closest("main");
          content: $host.getAttribute("data-section");
        }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("alpha");
      expectComplexity(budget);
      quark.unregister();
    });

    it("exposes the matched element as `element` (the listening element inside @on blocks)", async () => {
      const seen: HTMLElement[] = [];
      // a handler factory: `fire(element)` resolves per event to the listener
      const fire = (el: HTMLElement) => () => seen.push(el);
      const { root, quark, register } = createSheet(
        `<main><ul><li data-id="1"><span bind-label></span></li></ul></main>`,
        `[bind-label] {
          content: element.localName + ":" + element.closest("li").getAttribute("data-id");
        }
        ul {
          @on click (target: "li", handle: fire(element)) {
            data-clicked: element.localName + ">" + target.localName;
          }
        }`,
        { fire }
      );
      register();
      await flush();
      expect(root.querySelector("[bind-label]")?.textContent).toBe("span:1");
      root
        .querySelector("span")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
      expect(seen).toEqual([root.querySelector("ul")]);
      expect(root.querySelector("ul")?.getAttribute("data-clicked")).toBe(
        "ul>li"
      );
      quark.unregister();
    });

    it("resolves a variable from a DOM ancestor set by a sibling rule", async () => {
      // The defining rule is NOT an ancestor in the rule tree: DOM-tree
      // scoping resolves $theme from the nearest DOM ancestor that holds it.
      const { root, quark, register } = createSheet(
        `<main><span bind-theme></span></main>`,
        `main { $theme: "dark"; data-theme-host: ""; }
         [bind-theme] { content: $theme; }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-theme]")?.textContent).toBe("dark");
      expectComplexity(budget);
      quark.unregister();
    });

    it("resolves to the nearest DOM ancestor when bindings shadow", async () => {
      const { root, quark, register } = createSheet(
        `<section>
          <span bind-label id="outer-consumer"></span>
          <article><span bind-label id="inner-consumer"></span></article>
        </section>`,
        `section { $label: "outer"; }
         article { $label: "inner"; }
         [bind-label] { content: $label; }`
      );
      register();
      await flush();

      expect(root.querySelector("#outer-consumer")?.textContent).toBe("outer");
      expect(root.querySelector("#inner-consumer")?.textContent).toBe("inner");
      quark.unregister();
    });

    it("uses list.reverse() on an array before iterate", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <ul>
            <template><li bind-label></li></template>
          </ul>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: string[];
      };
      provider.provision = ["a", "b", "c"];

      const quark = new Quark({
        options: { isScoped: true },
        src: `@use "quark:list" as list;
        data-provider[is-success] {
          $items: list.reverse(prop("provision"));
          ul { content: iterate($items); }
          [bind-label] { content: item; }
        }`,
      });
      const meter = measureComplexity(quark);
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      const rows = await bindIterateRows(root);
      const budget = meter.take();
      meter.stop();

      expect(rows.map((el) => el.textContent)).toEqual(["c", "b", "a"]);
      expectComplexity(budget);
      quark.unregister();
    });

    it("uses list.find() to pick a record from an array", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <span bind-label></span>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { id: string; label: string }[];
      };
      provider.provision = [
        { id: "1", label: "one" },
        { id: "2", label: "two" },
      ];

      const quark = new Quark({
        options: { isScoped: true },
        src: `@use "quark:list" as list;
        data-provider[is-success] {
          $match: list.find(prop("provision"), "id", "2");
          [bind-label] { content: $match.label; }
        }`,
      });
      const meter = measureComplexity(quark);
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("two");
      expectComplexity(budget);
      quark.unregister();
    });
  });

  describe("prop()", () => {
    it("re-runs when a native element property is assigned from JS", async () => {
      const { root, quark, register } = createSheet(
        `<input value="typed">`,
        `input { data-len: prop("value").length; }`
      );
      register();
      await flush();
      const input = root.querySelector("input") as HTMLInputElement;
      expect(input.getAttribute("data-len")).toBe("5");
      input.value = "re-typed";
      await flush();
      expect(input.getAttribute("data-len")).toBe("8");
      // the wrapper delegates to the platform accessor
      expect(input.getAttribute("value")).toBe("typed");
      quark.unregister();
      // subscriptions are released with the sheet
      expect(isObservedProperty(input, "value")).toBe(false);
    });

    it("coalesces several assignments in one tick into one re-run", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success><span bind-title></span></data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { title: string };
      };
      provider.provision = { title: "one" };
      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $todo: prop("provision");
          [bind-title] { content: $todo.title; }
        }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      const meter = measureComplexity(quark);
      provider.provision = { title: "two" };
      provider.provision = { title: "three" };
      provider.provision = { title: "four" };
      await flush();
      const budget = meter.take();
      meter.stop();
      expect(root.querySelector("[bind-title]")?.textContent).toBe("four");
      // one def run + one reader run for three assignments
      expect(budget.variableRuns).toBe(1);
      expect(budget.attributeRuns).toBe(1);
      quark.unregister();
    });

    it("does not observe in-place mutation, only assignment", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success><span bind-title></span></data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { title: string };
      };
      provider.provision = { title: "one" };
      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $todo: prop("provision");
          [bind-title] { content: $todo.title; }
        }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      provider.provision!.title = "mutated";
      await flush();
      expect(root.querySelector("[bind-title]")?.textContent).toBe("one");
      provider.provision = { ...provider.provision!, title: "assigned" };
      await flush();
      expect(root.querySelector("[bind-title]")?.textContent).toBe("assigned");
      quark.unregister();
    });

    it("reads a dynamic name without subscribing (warns once at build)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { root, quark, register } = createSheet(
        `<input value="v">`,
        `:scope { $name: "value"; }
         input { data-x: prop($name); }`
      );
      register();
      await flush();
      const input = root.querySelector("input") as HTMLInputElement;
      expect(input.getAttribute("data-x")).toBe("v");
      expect(isObservedProperty(input, "value")).toBe(false);
      warn.mockRestore();
      quark.unregister();
    });

    it("reads a provision through a binding defined on the provider", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <div>
            <span bind-title></span>
          </div>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { title: string };
      };
      provider.provision = { title: "explicit" };

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] { $todo: prop("provision"); }
          [bind-title] { content: $todo.title; }`,
      });
      const meter = measureComplexity(quark);
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-title]")?.textContent).toBe("explicit");
      expectComplexity(budget);
      quark.unregister();
    });
  });

  describe("iterate", () => {
    it("iterates a plain object (index=key, item=value)", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <ul>
            <template><li bind-label></li></template>
          </ul>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: Record<string, string>;
      };
      provider.provision = { a: "alpha", b: "beta" };

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $map: prop("provision");
          ul { content: iterate($map); }
          [bind-label] { content: index + "=" + item; }
        }`,
      });
      const meter = measureComplexity(quark);
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      const rows = await bindIterateRows(root);
      const budget = meter.take();
      meter.stop();

      expect(rows.map((el) => el.textContent).sort()).toEqual([
        "a=alpha",
        "b=beta",
      ]);
      expectComplexity(budget);
      quark.unregister();
    });

    it("binds both index and item for array rows", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <ul>
            <template><li bind-label></li></template>
          </ul>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { id: string }[];
      };
      provider.provision = [{ id: "x" }, { id: "y" }];

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $items: prop("provision");
          ul { content: iterate($items); }
          [bind-label] { content: "Index: " + index + ". ID: " + item.id; }
        }`,
      });
      const meter = measureComplexity(quark);
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      const rows = await bindIterateRows(root);
      const budget = meter.take();
      meter.stop();

      expect(rows.map((el) => el.textContent)).toEqual([
        "Index: 0. ID: x",
        "Index: 1. ID: y",
      ]);
      expectComplexity(budget);
      quark.unregister();
    });

    it("clears iterated children when the list becomes empty", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <ul>
            <template><li bind-label></li></template>
          </ul>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { label: string }[];
      };
      provider.provision = [{ label: "one" }];

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $items: prop("provision");
          ul { content: iterate($items); }
          [bind-label] { content: item.label; }
        }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await bindIterateRows(root);
      expect(root.querySelectorAll("ul > li")).toHaveLength(1);

      const meter = measureComplexity(quark);
      provider.provision = [];
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelectorAll("ul > li")).toHaveLength(0);
      expect(root.querySelector("ul > template")).toBeTruthy();
      expectComplexity(budget);
      quark.unregister();
    });

    it("reuses rows across provisions when a key property is provided", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <ul>
            <template><li bind-label></li></template>
          </ul>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { id: string; label: string }[];
      };
      provider.provision = [
        { id: "1", label: "one" },
        { id: "2", label: "two" },
      ];

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $items: prop("provision");
          ul { content: iterate($items, ":scope > template", "id"); }
          [bind-label] { content: item.label; }
        }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      const firstRows = await bindIterateRows(root);
      expect(firstRows.map((el) => el.textContent)).toEqual(["one", "two"]);

      const meter = measureComplexity(quark);
      provider.provision = [
        { id: "2", label: "two!" },
        { id: "1", label: "one!" },
      ];
      await flush();
      const secondRows = [...root.querySelectorAll("ul > li")];
      const budget = meter.take();
      meter.stop();

      // Same DOM nodes reused (keyed), content updated / reordered.
      expect(secondRows).toHaveLength(2);
      expect(secondRows[0]).toBe(firstRows[1]);
      expect(secondRows[1]).toBe(firstRows[0]);
      expect(secondRows.map((el) => el.textContent)).toEqual(["two!", "one!"]);
      expectComplexity(budget);
      quark.unregister();
    });
  });

  describe("listeners", () => {
    it("calls the handle function, and a handle list in order, with the event and the element as `this`", async () => {
      const calls: string[] = [];
      const first = vi.fn(function (this: Element, e: Event) {
        calls.push(`first:${e.type}:${this.id}`);
      });
      const second = vi.fn((e: Event) => calls.push(`second:${e.type}`));
      const { root, quark, register } = createSheet(
        `<button type="button" id="target"></button><button type="button" id="single"></button>`,
        `#target { @on click (handle: (first, second)); }
         #single { @on click (handle: second); }`,
        { first, second }
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      (root.querySelector("#target") as HTMLButtonElement).click();
      expect(calls).toEqual(["first:click:target", "second:click"]);
      (root.querySelector("#single") as HTMLButtonElement).click();
      expect(second).toHaveBeenCalledTimes(2);
      expectComplexity(budget);
      quark.unregister();
    });

    it("prevent-default: the flag and the handle built-in both cancel the event", async () => {
      const { root, quark, register } = createSheet(
        `<a id="flag" href="/nope">go</a><a id="fn" href="/nope">go</a>`,
        `#flag { @on click (prevent-default); }
         #fn { @on click (handle: prevent-default); }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      for (const id of ["flag", "fn"]) {
        const event = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        });
        root.querySelector(`#${id}`)!.dispatchEvent(event);
        expect(event.defaultPrevented, id).toBe(true);
      }
      expectComplexity(budget);
      quark.unregister();
    });

    it("stop-propagation / stop-immediate-propagation flags act before any timing", async () => {
      const parentHandler = vi.fn();
      const sibling = vi.fn();
      const { root, quark, register } = createSheet(
        `<div id="parent"><button type="button" id="child">x</button><button type="button" id="other">y</button></div>`,
        `#child { @on click (stop-propagation, debounce: 20); }
         #other { @on click (stop-immediate-propagation); }`
      );
      root.querySelector("#parent")!.addEventListener("click", parentHandler);
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();
      // registered after Quark's listener: stop-immediate-propagation skips it
      root.querySelector("#other")!.addEventListener("click", sibling);

      (root.querySelector("#child") as HTMLButtonElement).click();
      expect(parentHandler).not.toHaveBeenCalled();
      (root.querySelector("#other") as HTMLButtonElement).click();
      expect(sibling).not.toHaveBeenCalled();
      expect(parentHandler).not.toHaveBeenCalled();
      expectComplexity(budget);
      quark.unregister();
    });

    it("listens for several events with one registration and one block", async () => {
      const { root, quark, register } = createSheet(
        `<form id="f"><input name="q"></form>`,
        `#f { @on input, change, "my:evt" { data-last: event.type; } }`
      );
      const form = root.querySelector("#f") as HTMLFormElement;
      const spy = vi.spyOn(form, "addEventListener");
      register();
      await flush();
      expect(spy.mock.calls.map(([type]) => type)).toEqual([
        "input",
        "change",
        "my:evt",
      ]);
      const input = root.querySelector("input")!;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
      expect(form.getAttribute("data-last")).toBe("input");
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      expect(form.getAttribute("data-last")).toBe("change");
      form.dispatchEvent(new CustomEvent("my:evt"));
      await flush();
      expect(form.getAttribute("data-last")).toBe("my:evt");
      const internal = (form as any)._q_;
      const rule = Object.values<any>(
        Object.values<any>(internal.instances)[0].rules
      )[0];
      expect(Object.keys(rule.listeners)).toEqual([
        '@on input, change, "my:evt"',
      ]);
      spy.mockRestore();
      quark.unregister();
    });

    it("applies an @on block's declarations to the matched element once per event", async () => {
      const { root, quark, register } = createSheet(
        `<article id="host" data-count="0"><button type="button" id="inc">+</button><span bind-count></span></article>`,
        `#host {
          $count: +attr("data-count");
          [bind-count] { content: $count; }
          @on counter-increment { data-count: $count + 1; }
        }`
      );
      register();
      await flush();
      const host = root.querySelector("#host")!;
      const fire = () =>
        root
          .querySelector("#inc")!
          .dispatchEvent(
            new CustomEvent("counter-increment", { bubbles: true })
          );
      fire();
      await flush();
      expect(host.getAttribute("data-count")).toBe("1");
      expect(root.querySelector("[bind-count]")!.textContent).toBe("1");
      fire();
      await flush();
      expect(host.getAttribute("data-count")).toBe("2");
      expect(root.querySelector("[bind-count]")!.textContent).toBe("2");
      quark.unregister();
    });

    it("exposes the DOM event as `event` inside the block and supports preserve", async () => {
      const { root, quark, register } = createSheet(
        `<article id="host"><input name="data-celsius" value="0"><input name="data-fahrenheit" value="32"></article>`,
        `#host {
          @on input {
            data-source: event.target.name;
            data-celsius: if(event.target.name == "data-celsius": event.target.value; else: preserve);
            data-fahrenheit: if(event.target.name == "data-fahrenheit": event.target.value; else: preserve);
          }
        }`
      );
      register();
      await flush();
      const host = root.querySelector("#host")!;
      const [c, f] = Array.from(root.querySelectorAll("input"));
      c.value = "100";
      c.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
      expect(host.getAttribute("data-source")).toBe("data-celsius");
      expect(host.getAttribute("data-celsius")).toBe("100");
      expect(host.hasAttribute("data-fahrenheit")).toBe(false);
      f.value = "50";
      f.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
      expect(host.getAttribute("data-source")).toBe("data-fahrenheit");
      expect(host.getAttribute("data-celsius")).toBe("100");
      expect(host.getAttribute("data-fahrenheit")).toBe("50");
      quark.unregister();
    });

    it("runs handle before the block and applies nested rules to descendants", async () => {
      const calls: string[] = [];
      const note = () => calls.push("handler");
      const { root, quark, register } = createSheet(
        `<div id="host"><form><input type="checkbox" name="is-active"></form><section id="panel"><p bind-state></p></section></div>`,
        `#host {
          @on change (handle: note) {
            $active: event.target.checked;
            #panel {
              is-active: if($active: ""; else: none);
              [bind-state] { content: if($active: "on"; else: "off"); }
            }
          }
        }`,
        { note }
      );
      register();
      await flush();
      const box = root.querySelector<HTMLInputElement>("input")!;
      const panel = root.querySelector("#panel")!;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      expect(calls).toEqual(["handler"]);
      expect(panel.hasAttribute("is-active")).toBe(true);
      expect(panel.querySelector("[bind-state]")!.textContent).toBe("on");
      box.checked = false;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      expect(calls).toEqual(["handler", "handler"]);
      expect(panel.hasAttribute("is-active")).toBe(false);
      expect(panel.querySelector("[bind-state]")!.textContent).toBe("off");
      quark.unregister();
    });

    it("keeps one block listener per element across rule re-runs and does not run it during passes", async () => {
      const { root, quark, register } = createSheet(
        `<div id="host" data-tick="0"><span bind-hits></span></div>`,
        `#host {
          $tick: attr("data-tick");
          [bind-hits] { content: $tick; }
          @on ping { data-hits: (+attr("data-hits") or 0) + 1; }
        }`
      );
      register();
      await flush();
      const host = root.querySelector("#host")!;
      expect(host.hasAttribute("data-hits")).toBe(false);
      // re-run the rule several times; the block must not fire on its own
      host.setAttribute("data-tick", "1");
      await flush();
      host.setAttribute("data-tick", "2");
      await flush();
      expect(host.hasAttribute("data-hits")).toBe(false);
      host.dispatchEvent(new CustomEvent("ping"));
      await flush();
      // a single listener registration, so exactly one increment per event
      expect(host.getAttribute("data-hits")).toBe("1");
      quark.unregister();
    });

    it("rejects @off and the removed handler list at construction with a parse error", () => {
      expect(
        () => new Quark({ src: "#target { @off click handleClick; }" })
      ).toThrow(/@off is not supported/);
      expect(
        () => new Quark({ src: "#target { @on click handleClick; }" })
      ).toThrow(/handle:/);
      expect(() => new Quark({ src: "#target { @on click; }" })).toThrow(
        /nothing to do/
      );
    });

    describe("options", () => {
      const keydown = (
        el: Element,
        key: string,
        init: KeyboardEventInit = {}
      ) =>
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
          })
        );
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      it("target: delegates to a matching descendant and exposes it as `target` in the block and in handle", async () => {
        const pick = vi.fn();
        const { root, quark, register } = createSheet(
          `<ul id="list"><li data-id="1"><span>one</span></li><li data-id="2"><span>two</span></li><li><span>none</span></li></ul>`,
          `#list {
            @on click (target: "li[data-id]", handle: pick(target.getAttribute("data-id"))) {
              data-picked: target.getAttribute("data-id");
              data-origin: event.target.localName;
            }
          }`,
          { pick }
        );
        register();
        await flush();
        const list = root.querySelector("#list")!;
        const spans = root.querySelectorAll("span");
        spans[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flush();
        expect(pick).toHaveBeenCalledTimes(1);
        expect(pick).toHaveBeenCalledWith("2");
        expect(list.getAttribute("data-picked")).toBe("2");
        expect(list.getAttribute("data-origin")).toBe("span");
        // a row without data-id and the list itself do not pass the filter
        spans[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        list.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await flush();
        expect(pick).toHaveBeenCalledTimes(1);
        expect(list.getAttribute("data-picked")).toBe("2");
        quark.unregister();
      });

      it("target: ignores matches outside the matched element", async () => {
        const hit = vi.fn();
        const { root, quark, register } = createSheet(
          `<div id="box"><p class="row">in</p></div><p class="row" id="outside">out</p>`,
          `#box { @on click (target: ".row", handle: hit); }`,
          { hit }
        );
        register();
        await flush();
        root
          .querySelector("#outside")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(hit).not.toHaveBeenCalled();
        root
          .querySelector("#box .row")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(hit).toHaveBeenCalledTimes(1);
        quark.unregister();
      });

      it("self: fires only when the event target is the matched element", async () => {
        const hit = vi.fn();
        const { root, quark, register } = createSheet(
          `<div id="box"><button type="button" id="inner">x</button></div>`,
          `#box { @on click (self, handle: hit); }`,
          { hit }
        );
        register();
        await flush();
        (root.querySelector("#inner") as HTMLButtonElement).click();
        expect(hit).not.toHaveBeenCalled();
        (root.querySelector("#box") as HTMLElement).click();
        expect(hit).toHaveBeenCalledTimes(1);
        quark.unregister();
      });

      it("key: gates keyboard events by chord, with space-separated alternatives", async () => {
        const hit = vi.fn();
        const { root, quark, register } = createSheet(
          `<input id="field">`,
          `#field { @on keydown (key: "Escape Shift+K ctrl+Enter", handle: hit); }`,
          { hit }
        );
        register();
        await flush();
        const field = root.querySelector("#field")!;
        keydown(field, "Escape");
        expect(hit).toHaveBeenCalledTimes(1);
        keydown(field, "k", { shiftKey: true });
        expect(hit).toHaveBeenCalledTimes(2);
        keydown(field, "Enter", { ctrlKey: true });
        expect(hit).toHaveBeenCalledTimes(3);
        // wrong key, missing modifier
        keydown(field, "k");
        keydown(field, "Enter");
        keydown(field, "a", { shiftKey: true });
        expect(hit).toHaveBeenCalledTimes(3);
        quark.unregister();
      });

      it("once: detaches after the first event that passes the filters", async () => {
        const hit = vi.fn();
        const { root, quark, register } = createSheet(
          `<div id="box"><span id="yes">y</span><b id="no">n</b></div>`,
          `#box { @on click (once, target: "span", handle: hit); }`,
          { hit }
        );
        register();
        await flush();
        const box = root.querySelector("#box")!;
        // filtered events must not consume the listener
        root
          .querySelector("#no")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(hit).not.toHaveBeenCalled();
        root
          .querySelector("#yes")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(hit).toHaveBeenCalledTimes(1);
        root
          .querySelector("#yes")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(hit).toHaveBeenCalledTimes(1);
        const internal = (box as any)._q_;
        const rule = Object.values<any>(
          Object.values<any>(internal.instances)[0].rules
        )[0];
        expect(
          rule.listeners['@on click (once, target: "span", handle: hit)']
        ).toEqual([]);
        quark.unregister();
      });

      it("debounce: applies the block once after typing settles, with the last event", async () => {
        const hit = vi.fn();
        const { root, quark, register } = createSheet(
          `<form id="f"><input name="q"></form>`,
          `#f { @on input (debounce: 30, handle: hit) { data-draft: event.target.value; } }`,
          { hit }
        );
        register();
        await flush();
        const form = root.querySelector("#f")!;
        const input = root.querySelector<HTMLInputElement>("input")!;
        for (const v of ["a", "ab", "abc"]) {
          input.value = v;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        expect(hit).not.toHaveBeenCalled();
        expect(form.hasAttribute("data-draft")).toBe(false);
        await sleep(60);
        await flush();
        expect(hit).toHaveBeenCalledTimes(1);
        expect(form.getAttribute("data-draft")).toBe("abc");
        quark.unregister();
      });

      it("throttle: runs the leading event, then at most once per window", async () => {
        const hit = vi.fn();
        const { root, quark, register } = createSheet(
          `<button type="button" id="b">x</button>`,
          `#b { @on click (throttle: 40, handle: hit); }`,
          { hit }
        );
        register();
        await flush();
        const b = root.querySelector("#b") as HTMLButtonElement;
        b.click();
        b.click();
        b.click();
        expect(hit).toHaveBeenCalledTimes(1);
        await sleep(60);
        b.click();
        expect(hit).toHaveBeenCalledTimes(2);
        quark.unregister();
      });

      it("host: window / document — listens there, resolves target document-wide, and lets go once the element is disconnected", async () => {
        const esc = vi.fn();
        const doc = vi.fn();
        const { root, quark, register } = createSheet(
          `<dialog id="dlg" is-open><p>hi</p></dialog><p id="elsewhere" class="row">x</p>`,
          `#dlg {
            @on keydown (host: window, key: "Escape", handle: esc) { is-open: none; }
            @on click (host: document, target: ".row", handle: doc);
          }`,
          { esc, doc }
        );
        register();
        await flush();
        const dlg = root.querySelector("#dlg")!;
        keydown(document.body, "Escape");
        await flush();
        expect(esc).toHaveBeenCalledTimes(1);
        expect(dlg.hasAttribute("is-open")).toBe(false);
        // a `target:` with a host is not confined to the element
        root
          .querySelector("#elsewhere")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(doc).toHaveBeenCalledTimes(1);
        // after removal the next event unhooks the listener instead of running it
        dlg.remove();
        keydown(document.body, "Escape");
        keydown(document.body, "Escape");
        expect(esc).toHaveBeenCalledTimes(1);
        const internal = (dlg as any)._q_;
        const rule = Object.values<any>(
          Object.values<any>(internal.instances)[0].rules
        )[0];
        expect(
          rule.listeners[
            '@on keydown (host: window, key: "Escape", handle: esc)'
          ]
        ).toEqual([]);
        quark.unregister();
      });

      it("capture / passive: registers with the native options", async () => {
        const calls: string[] = [];
        const first = () => calls.push("parent-capture");
        const second = () => calls.push("child");
        const { root, quark, register } = createSheet(
          `<div id="parent"><button type="button" id="child">x</button></div>`,
          `#parent { @on click (capture, handle: first); }
           #child { @on click (passive, handle: second); }`,
          { first, second }
        );
        const child = root.querySelector("#child") as HTMLButtonElement;
        const spy = vi.spyOn(child, "addEventListener");
        register();
        await flush();
        child.click();
        // capture on the parent runs before the child's bubbling listener
        expect(calls).toEqual(["parent-capture", "child"]);
        expect(spy).toHaveBeenCalledWith("click", expect.any(Function), {
          passive: true,
        });
        spy.mockRestore();
        quark.unregister();
      });

      it("keeps two @on for one event apart when their options differ", async () => {
        const esc = vi.fn();
        const enter = vi.fn();
        const { root, quark, register } = createSheet(
          `<input id="field">`,
          `#field {
            @on keydown (key: "Escape", handle: esc);
            @on keydown (key: "Enter", handle: enter);
          }`,
          { esc, enter }
        );
        register();
        await flush();
        const field = root.querySelector("#field")!;
        keydown(field, "Escape");
        keydown(field, "Enter");
        keydown(field, "Enter");
        expect(esc).toHaveBeenCalledTimes(1);
        expect(enter).toHaveBeenCalledTimes(2);
        quark.unregister();
      });

      it("evaluates handle and target when the event fires: current bindings, no re-registration", async () => {
        const seen: string[] = [];
        const inc = (n: string) => () => seen.push(n);
        const { root, quark, register } = createSheet(
          `<div id="box" data-n="1" data-row="b"><b><i>x</i></b><em>y</em></div>`,
          `#box {
            $n: attr("data-n");
            $row: attr("data-row");
            @on click (target: $row, handle: inc($n)) { data-hit: target.localName; }
          }`,
          { inc }
        );
        const box = root.querySelector("#box") as HTMLElement;
        const spy = vi.spyOn(box, "addEventListener");
        register();
        await flush();
        const click = (sel: string) =>
          root
            .querySelector(sel)!
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        click("i");
        await flush();
        expect(seen).toEqual(["1"]);
        expect(box.getAttribute("data-hit")).toBe("b");
        // the bindings change; the next event reads them, nothing re-registers
        box.setAttribute("data-n", "2");
        box.setAttribute("data-row", "em");
        await flush();
        click("i");
        click("em");
        await flush();
        expect(seen).toEqual(["1", "2"]);
        expect(box.getAttribute("data-hit")).toBe("em");
        expect(
          spy.mock.calls.filter(([type]) => type === "click")
        ).toHaveLength(1);
        spy.mockRestore();
        quark.unregister();
      });

      it("hands the event to a handle call and accepts expression values", async () => {
        const calls: unknown[] = [];
        const note = (e: Event, where: string) => calls.push([e.type, where]);
        const { root, quark, register } = createSheet(
          `<div id="host" data-row="li"><ul><li><span>a</span></li></ul><output></output></div>`,
          `#host {
            $sel: attr("data-row");
            @on click (target: $sel, debounce: 10 * 2, handle: note(event, target.localName)) {
              output { content: "clicked " + target.localName; }
            }
          }`,
          { note }
        );
        register();
        await flush();
        root
          .querySelector("span")!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(calls).toEqual([]);
        await sleep(40);
        await flush();
        expect(calls).toEqual([["click", "li"]]);
        expect(root.querySelector("output")!.textContent).toBe("clicked li");
        quark.unregister();
      });

      it("warns on unknown, malformed or conflicting options and ignores them", async () => {
        const warn = vi.spyOn(QuarkLogger, "warn").mockImplementation(() => {});
        const hit = vi.fn();
        const { root, quark, register } = createSheet(
          `<button type="button" id="b">x</button>`,
          `#b {
            @on click (bogus, once: 1, key: 3, host: body, throttle: 10, debounce: 5, handle: hit);
            @on keydown (debounce: "soon", handle: "hit");
          }`,
          { hit }
        );
        register();
        await flush();
        const b = root.querySelector("#b") as HTMLButtonElement;
        b.click();
        keydown(b, "a");
        keydown(b, "a");
        const messages = warn.mock.calls.map(([arg]) => (arg as any).message);
        expect(messages.some((m) => /unknown option "bogus"/.test(m))).toBe(
          true
        );
        expect(messages.some((m) => /"once" takes no value/.test(m))).toBe(
          true
        );
        expect(messages.some((m) => /"key" needs a string/.test(m))).toBe(true);
        expect(
          messages.some((m) => /"host" must be window or document/.test(m))
        ).toBe(true);
        expect(messages.some((m) => /exclusive/.test(m))).toBe(true);
        expect(
          messages.filter((m) => /"debounce" needs a positive number/.test(m))
        ).toHaveLength(1);
        expect(
          messages.filter((m) => /handle: "hit" is a string/.test(m))
        ).toHaveLength(1);
        // the click's `key: 3` warned and filtered it out; the keydown ran
        // unthrottled and undebounced, and its string handle did nothing
        expect(hit).not.toHaveBeenCalled();
        await sleep(20);
        expect(hit).not.toHaveBeenCalled();
        warn.mockRestore();
        quark.unregister();
      });
    });
  });

  describe("selectors and nesting", () => {
    it("applies autofocus only while dialog is open", async () => {
      const { root, quark, register } = createSheet(
        `<dialog><input /></dialog>`,
        `dialog[open] input { autofocus: ""; }
         dialog:not([open]) input { autofocus: none; }`
      );
      register();
      await flush();
      expect(root.querySelector("input")?.hasAttribute("autofocus")).toBe(
        false
      );

      const meter = measureComplexity(quark);
      root.querySelector("dialog")!.setAttribute("open", "");
      await flush();
      expect(root.querySelector("input")?.hasAttribute("autofocus")).toBe(true);

      root.querySelector("dialog")!.removeAttribute("open");
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("input")?.hasAttribute("autofocus")).toBe(
        false
      );
      expectComplexity(budget);
      quark.unregister();
    });

    it("inherits a parent variable through nested rules", async () => {
      const { root, quark, register } = createSheet(
        `<main><section><span bind-msg></span></section></main>`,
        `main {
          $msg: "nested-ok";
          section {
            [bind-msg] { content: $msg; }
          }
        }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-msg]")?.textContent).toBe("nested-ok");
      expectComplexity(budget);
      quark.unregister();
    });

    it("targets by id", async () => {
      const { root, quark, register } = createSheet(
        `<p id="only">x</p>`,
        `#only { content: "by-id"; }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("#only")?.textContent).toBe("by-id");
      expectComplexity(budget);
      quark.unregister();
    });
  });

  describe("@use modules", () => {
    const originalLoader = Quark.moduleLoader;
    afterEach(() => {
      Quark.moduleLoader = originalLoader;
    });

    it("loads bare (as *) and namespaced modules before first run", async () => {
      Quark.moduleLoader = async (url: string) =>
        url === "/fake-utils" ? { greet: () => "hi" } : { version: () => "v2" };
      const { root, quark, register } = createSheet(
        `<span bind-label></span>`,
        `@use "/fake-utils" as *;
         @use "/api-mod" as api;
         [bind-label] {
           content: greet() + " " + api.version();
         }`
      );
      register();
      await flush();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("hi v2");
      quark.unregister();
    });

    it("hoists leading @use imports out of the implicit @scope wrap", () => {
      Quark.moduleLoader = async () => ({ greet: () => "hi" });
      const quark = new Quark({
        src: `@use "/fake-utils" as *;
              @use "/api-mod" as api;
              span { content: greet(); }`,
        options: { isScoped: true },
      });

      expect(quark.src.startsWith(`@use "/fake-utils" as *;`)).toBe(true);
      // both imports precede the wrap; the rule sits inside it
      expect(quark.src).toMatch(/as api;\s*@scope\{\s*span/);
      expect(quark.src.endsWith("}")).toBe(true);
    });

    it("derives the namespace from the url when no alias is given", async () => {
      Quark.moduleLoader = async () => ({
        upper: (s: string) => s.toUpperCase(),
      });
      const { root, quark, register } = createSheet(
        `<span bind-label></span>`,
        `@use "/mods/string-utils.js";
         [bind-label] {
           content: string-utils.upper("shout");
         }`
      );
      register();
      await flush();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("SHOUT");
      quark.unregister();
    });

    it("skips a failing @use module but still runs the sheet", async () => {
      Quark.moduleLoader = async (url: string) => {
        if (url === "/broken") throw new Error("404");
        return { greet: () => "hi" };
      };
      const { root, quark, register } = createSheet(
        `<span bind-label></span>`,
        `@use "/broken" as nope;
         @use "/fake-utils" as *;
         [bind-label] { content: greet(); }`
      );
      register();
      await flush();

      expect(root.querySelector("[bind-label]")?.textContent).toBe("hi");
      quark.unregister();
    });
  });

  describe("dynamics", () => {
    it("reacts when a custom element toggles its own state attribute", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider>
          <span bind-title></span>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { title: string };
      };
      provider.provision = { title: "provisioned" };

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $todo: prop("provision");
          [bind-title] { content: $todo.title; }
        }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      expect(root.querySelector("[bind-title]")?.textContent).toBe("");

      const meter = measureComplexity(quark);
      // Simulates the element flipping its own state (e.g. fetch success).
      provider.setAttribute("is-success", "");
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-title]")?.textContent).toBe(
        "provisioned"
      );
      expectComplexity(budget);
      quark.unregister();
    });

    it("chains rules: a quark-set attribute triggers another rule", async () => {
      const { root, quark, register } = createSheet(
        `<span></span>`,
        `span { data-state: "ready"; }
         span[data-state="ready"] { content: "chained"; }`
      );
      const meter = measureComplexity(quark);
      register();
      await flush();
      // Second flush window: observer sees the quark-set attribute.
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("span")?.textContent).toBe("chained");
      expectComplexity(budget);
      quark.unregister();
    });

    it("re-runs chained variables when the source provision changes", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <span bind-title></span>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { title: string };
      };
      provider.provision = { title: "first" };

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $res: prop("provision");
          $title: $res.title;
          [bind-title] { content: $title; }
        }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      expect(root.querySelector("[bind-title]")?.textContent).toBe("first");

      const meter = measureComplexity(quark);
      provider.provision = { title: "second" };
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-title]")?.textContent).toBe("second");
      expectComplexity(budget);
      quark.unregister();
    });

    it("skips dependent re-runs when a provision carries the same value", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <span bind-title></span>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { title: string };
      };
      provider.provision = { title: "same" };

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $todo: prop("provision");
          [bind-title] { content: $todo.title; }
        }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      expect(root.querySelector("[bind-title]")?.textContent).toBe("same");

      const meter = measureComplexity(quark);
      // Same payload (same hash), setVar reports no change, no fan-out.
      provider.provision = { title: "same" };
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-title]")?.textContent).toBe("same");
      expectComplexity(budget);
      quark.unregister();
    });

    it("propagates async variable updates to consumers in sibling rules", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <span bind-title></span>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { title: string };
      };
      provider.provision = { title: "before" };

      // Consumer rule is a sibling of the defining rule; the update reaches
      // it because the binding owner is a DOM ancestor of the consumer.
      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] { $todo: prop("provision"); }
              [bind-title] { content: $todo.title; }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      expect(root.querySelector("[bind-title]")?.textContent).toBe("before");

      const meter = measureComplexity(quark);
      provider.provision = { title: "after" };
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-title]")?.textContent).toBe("after");
      expectComplexity(budget);
      quark.unregister();
    });

    it("cascades a binding set by one sheet into another sheet's rules", async () => {
      /*
       * CSS-custom-property semantics: bindings live on the element, not
       * the sheet. Same-named writers collide (last writer wins per
       * element), namespace app bindings accordingly.
       */
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet-a"></div>
        <div id="sheet-b"></div>
        <main>
          <span bind-b></span>
        </main>
      </section>`);
      const a = new Quark({
        options: { isScoped: true },
        src: `main { $label: "from-a"; }`,
      });
      const b = new Quark({
        options: { isScoped: true },
        src: `[bind-b] { content: $label; }`,
      });
      a.register({
        sheetElement: root.querySelector("#sheet-a") as HTMLElement,
      });
      await flush();
      b.register({
        sheetElement: root.querySelector("#sheet-b") as HTMLElement,
      });
      await flush();

      expect(root.querySelector("[bind-b]")?.textContent).toBe("from-a");
      a.unregister();
      b.unregister();
    });

    it("delivers a def to a reader declared earlier in the sheet on first run", async () => {
      /*
       * The def's change event is deferred to the end of the run and only
       * readers that ran before the write are re-run, rule order no longer
       * decides whether a first-run reader sees the value.
       */
      const { root, quark, register } = createSheet(
        `<div id="host"><span bind-early></span></div>`,
        `[bind-early] { content: $late; }
         #host { $late: "seen"; }`
      );
      register();
      await flush();
      expect(root.querySelector("[bind-early]")?.textContent).toBe("seen");
      quark.unregister();
    });

    it("does not fan out a def to readers the same run already reached", async () => {
      /*
       * `$ref` is written on every row while the rule pass is still
       * running; readers below each row run later in the same pass with
       * the new value, so the deferred change events are self-covered
       * (no nested run, no per-row querySelectorAll).
       */
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <ul>
          <template><li><span bind-ref></span></li></template>
        </ul>
      </section>`);
      const quark = new Quark({
        options: { isScoped: true },
        src: `:scope { $items: ("a", "b", "c", "d"); }
              ul { content: iterate($items); }
              li { $ref: "row-" + index; }
              li [bind-ref] { content: $ref; }`,
      });
      const meter = measureComplexity(quark);
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      // rows paint, their run follows, then their text paints
      await flush();
      await flush();
      const budget = meter.take();
      meter.stop();
      expect(
        [...root.querySelectorAll("li")].map((el) => el.textContent)
      ).toEqual(["row-0", "row-1", "row-2", "row-3"]);
      // first run + the run for the rendered rows; no nested per-row runs
      expect(budget.quarkRuns).toBe(2);
      expectComplexity(budget);
      quark.unregister();
    });

    it("re-runs another sheet's consumers when a binding changes", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet-a"></div>
        <div id="sheet-b"></div>
        <data-provider is-success>
          <span bind-title></span>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: { title: string };
      };
      provider.provision = { title: "before" };

      // Sheet A owns the binding; sheet B only consumes it. The bubbling
      // quark-binding-change event is what crosses the sheet boundary.
      const a = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] { $todo: prop("provision"); }`,
      });
      const b = new Quark({
        options: { isScoped: true },
        src: `[bind-title] { content: $todo.title; }`,
      });
      a.register({
        sheetElement: root.querySelector("#sheet-a") as HTMLElement,
      });
      await flush();
      b.register({
        sheetElement: root.querySelector("#sheet-b") as HTMLElement,
      });
      await flush();
      expect(root.querySelector("[bind-title]")?.textContent).toBe("before");

      const meterB = measureComplexity(b);
      provider.provision = { title: "after" };
      await flush();
      const budgetB = meterB.take();
      meterB.stop();

      expect(root.querySelector("[bind-title]")?.textContent).toBe("after");
      expectComplexity(budgetB);
      a.unregister();
      b.unregister();
    });

    it("unset deletes a binding so consumers fall through to an ancestor", async () => {
      const { root, quark, register } = createSheet(
        `<main>
          <details>
            <p bind-foo></p>
          </details>
        </main>`,
        `main { $foo: 1; }
         details[is-open] { $foo: 2; }
         details:not([is-open]) { $foo: unset; }
         [bind-foo] { content: $foo; }`
      );
      const details = root.querySelector("details") as HTMLElement;
      register();
      await flush();
      // closed: details holds no binding, falls through to main's 1
      expect(root.querySelector("[bind-foo]")?.textContent).toBe("1");

      details.setAttribute("is-open", "");
      await flush();
      // open: details' nearer binding shadows main's
      expect(root.querySelector("[bind-foo]")?.textContent).toBe("2");

      details.removeAttribute("is-open");
      await flush();
      // closed again: unset deletes the shadow, main's value returns
      expect(root.querySelector("[bind-foo]")?.textContent).toBe("1");
      quark.unregister();
    });

    it("skips re-runs when a farther (shadowed) binding owner changes", async () => {
      // Nearness optimization: the consumer last read $v from the inner
      // provider, so a change on the outer provider must not re-run it.
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider outer is-success>
          <data-provider inner is-success>
            <span bind-v></span>
          </data-provider>
        </data-provider>
      </section>`);
      const outer = root.querySelector("[outer]") as HTMLElement & {
        provision?: { label: string };
      };
      const inner = root.querySelector("[inner]") as HTMLElement & {
        provision?: { label: string };
      };
      outer.provision = { label: "outer-1" };
      inner.provision = { label: "inner-1" };

      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[outer][is-success] { $v: prop("provision"); }
              data-provider[inner][is-success] { $v: prop("provision"); }
              [bind-v] { content: $v.label; }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      expect(root.querySelector("[bind-v]")?.textContent).toBe("inner-1");

      const meter = measureComplexity(quark);
      outer.provision = { label: "outer-2" };
      await flush();
      const budget = meter.take();
      meter.stop();

      // shadowed change: consumer untouched (attributeRuns stays 0)
      expect(root.querySelector("[bind-v]")?.textContent).toBe("inner-1");
      expect(budget.attributeRuns).toBe(0);
      expectComplexity(budget);

      inner.provision = { label: "inner-2" };
      await flush();
      // nearest-owner change still propagates
      expect(root.querySelector("[bind-v]")?.textContent).toBe("inner-2");
      quark.unregister();
    });
  });

  describe("@scope / :scope", () => {
    it(":scope targets the host element itself", async () => {
      const { root, quark, register } = createSheet(
        `<span></span>`,
        `:scope { data-host: "yes"; }`
      );
      register();
      await flush();

      expect(root.getAttribute("data-host")).toBe("yes");
      quark.unregister();
    });

    it("reacts to host state changes via :scope[attr]", async () => {
      const { root, quark, register } = createSheet(
        `<p bind-mode></p>`,
        `:scope[data-mode="on"] [bind-mode] { content: "enabled"; }
         :scope:not([data-mode="on"]) [bind-mode] { content: "disabled"; }`
      );
      register();
      await flush();
      expect(root.querySelector("[bind-mode]")?.textContent).toBe("disabled");

      root.setAttribute("data-mode", "on");
      await flush();
      expect(root.querySelector("[bind-mode]")?.textContent).toBe("enabled");
      quark.unregister();
    });

    it("keeps identical selectors scoped to their own host (no sibling leaks)", async () => {
      // Selectors are bare now (no self-anchoring q-id prefix), scoping
      // must come from containment checks and query-root clamping.
      const root = fixture<HTMLElement>(`<div>
        <section id="a"><div id="sheet-a"></div><span></span></section>
        <section id="b"><div id="sheet-b"></div><span></span></section>
      </div>`);
      const a = new Quark({
        src: `span { content: "A"; }`,
        options: { isScoped: true },
      });
      const b = new Quark({
        src: `span { content: "B"; }`,
        options: { isScoped: true },
      });
      a.register({
        sheetElement: root.querySelector("#sheet-a") as HTMLElement,
      });
      b.register({
        sheetElement: root.querySelector("#sheet-b") as HTMLElement,
      });
      await flush();

      expect(root.querySelector("#a span")?.textContent).toBe("A");
      expect(root.querySelector("#b span")?.textContent).toBe("B");
      a.unregister();
      b.unregister();
    });
  });

  describe("@scope containment (ancestor clamping)", () => {
    /**
     * CSS `@scope` is scope-contained: every compound of a scoped selector.
     * not just the subject, must match an element in scope (host + subtree).
     * Native matches()/querySelectorAll() evaluate ancestor compounds against
     * the whole document, so these cases guard against rules leaking in when
     * a matching ancestor exists ABOVE the host.
     */
    const registerAt = (
      root: HTMLElement,
      src: string,
      modules?: Record<string, unknown>
    ) => {
      const quark = new Quark({ src, options: { isScoped: true } });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
        ...(modules ? { modules: { dfault: modules } } : {}),
      });
      return quark;
    };

    /*
     * The provider-demo shape: the sheet's host is nested inside an OUTER
     * element that matches the ancestor compound; the in-scope one does not
     * (yet). Reproduces the "undefined flash" seen in docs-site demos.
     */
    const nestedProviderFixture = () =>
      fixture<HTMLElement>(
        `<x-provider is-success><section><div id="sheet"></div>` +
          `<x-provider><h4>loading</h4></x-provider></section></x-provider>`
      );

    it("ignores an ancestor compound matched only outside the scope", async () => {
      const root = nestedProviderFixture();
      const quark = registerAt(
        root,
        `x-provider[is-success] {
          $todo: getTodo();
          h4 { content: "Todo #" + $todo.id; }
        }`,
        { getTodo: () => ({ id: 7 }) }
      );
      await flush();
      // only the OUT-of-scope ancestor is successful: the rule must not run
      expect(root.querySelector("h4")?.textContent).toBe("loading");

      // flipping the IN-scope ancestor activates the rule
      root.querySelector("section x-provider")!.setAttribute("is-success", "");
      await flush();
      expect(root.querySelector("h4")?.textContent).toBe("Todo #7");
      quark.unregister();
    });

    it("clamps ancestor compounds in :scope-prefixed selectors too", async () => {
      const root = nestedProviderFixture();
      const quark = registerAt(
        root,
        `:scope x-provider[is-success] {
          h4 { content: "ready"; }
        }`
      );
      await flush();
      expect(root.querySelector("h4")?.textContent).toBe("loading");

      root.querySelector("section x-provider")!.setAttribute("is-success", "");
      await flush();
      expect(root.querySelector("h4")?.textContent).toBe("ready");
      quark.unregister();
    });

    it("requires every compound of a chain to match inside the scope", async () => {
      // [data-a] only above the host, [data-b] inside: half-in-scope chains
      // must not match
      const root = fixture<HTMLElement>(
        `<div data-a><section><div id="sheet"></div>` +
          `<div id="mid"><div data-b><span></span></div></div></section></div>`
      );
      const quark = registerAt(
        root,
        `[data-a] [data-b] span { content: "on"; }`
      );
      await flush();
      expect(root.querySelector("span")?.textContent).toBe("");

      // completing the chain inside the scope matches
      root.querySelector("#mid")!.setAttribute("data-a", "");
      await flush();
      expect(root.querySelector("span")?.textContent).toBe("on");
      quark.unregister();
    });

    it("excludes the host from bare ancestor compounds (root needs explicit :scope)", async () => {
      /*
       * CSS `@scope`: bare selectors are implicitly `:scope <descendant>`,
       * so every compound matches strict descendants, the root itself is
       * only reachable via an explicit `:scope`
       */
      const { root, quark, register } = createSheet(
        `<span></span>`,
        `section[data-on] span { content: "on"; }`
      );
      root.setAttribute("data-on", "");
      register();
      await flush();

      expect(root.querySelector("span")?.textContent).toBe("");
      quark.unregister();
    });

    it("matches the host's state via an explicit :scope compound", async () => {
      const { root, quark, register } = createSheet(
        `<span></span>`,
        `:scope[data-on] span { content: "on"; }`
      );
      root.setAttribute("data-on", "");
      register();
      await flush();

      expect(root.querySelector("span")?.textContent).toBe("on");
      quark.unregister();
    });

    it("excludes the host from bare subject selectors", async () => {
      // host is the <section>: `section {}` must not mutate it, `:scope {}`
      // must
      const { root, quark, register } = createSheet(
        `<span></span>`,
        `section { data-bare: "hit"; }
         :scope { data-scope: "hit"; }`
      );
      register();
      await flush();

      expect(root.hasAttribute("data-bare")).toBe(false);
      expect(root.getAttribute("data-scope")).toBe("hit");
      quark.unregister();
    });

    it("excludes the host from ancestor compounds under :scope (strict descendants)", async () => {
      // `:scope section[data-on] span`, the compound must match a strict
      // descendant of the host, so the host itself does not qualify
      const { root, quark, register } = createSheet(
        `<span></span>`,
        `:scope section[data-on] span { content: "on"; }`
      );
      root.setAttribute("data-on", "");
      register();
      await flush();

      expect(root.querySelector("span")?.textContent).toBe("");
      quark.unregister();
    });

    it("backtracks past a nearer decoy when a child combinator constrains the chain", async () => {
      // nearest [data-b] ancestor is not a child of [data-a]; the farther
      // one is, greedy nearest-ancestor matching alone would miss it
      const root = fixture<HTMLElement>(
        `<section><div id="sheet"></div><div data-a><div data-b>` +
          `<section><div data-b><span></span></div></section>` +
          `</div></div></section>`
      );
      const quark = registerAt(
        root,
        `[data-a] > [data-b] span { content: "on"; }`
      );
      await flush();

      expect(root.querySelector("span")?.textContent).toBe("on");
      quark.unregister();
    });
  });

  describe("global (unscoped) sheets", () => {
    /**
     * Without `isScoped`, top-level rules run in the root context (the whole
     * document); rules inside an explicit `@scope { }` block stay
     * host-scoped. This is the plumbing for `quark-sheet[is-global]`.
     */
    const mountGlobal = (root: HTMLElement, src: string) => {
      const quark = new Quark({ src, options: { isScoped: false } });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      return quark;
    };

    // ancestor provider ABOVE the sheet's host, the `is-global` use case
    const providerFixture = () =>
      fixture<HTMLElement & { provision?: { name: string } }>(
        `<x-provider id="root-user"><section><div id="sheet"></div>` +
          `<span></span></section></x-provider>`
      );

    const MIXED_SRC = `x-provider#root-user[is-success] {
        $user: prop("provision");
      }
      @scope {
        span { content: $user.name; }
      }`;

    it("top-level rules read prop() from an ancestor provider outside @scope", async () => {
      /*
       * Attribute changes above the host are not observed (the observer
       * watches the host subtree), so the provider is already matchable;
       * the property itself is what changes later.
       */
      const provider = providerFixture();
      provider.setAttribute("is-success", "");
      const quark = mountGlobal(provider, MIXED_SRC);
      await flush();
      // matched and read (subscribed) while still unprovisioned: wipes
      expect(provider.querySelector("span")?.textContent).toBe("");

      provider.provision = { name: "Ada" };
      await flush();
      expect(provider.querySelector("span")?.textContent).toBe("Ada");
      quark.unregister();
    });

    it("matches an already-provisioned ancestor on the first run", async () => {
      const provider = providerFixture();
      provider.provision = { name: "Ada" };
      provider.setAttribute("is-success", "");
      const quark = mountGlobal(provider, MIXED_SRC);
      await flush();

      expect(provider.querySelector("span")?.textContent).toBe("Ada");
      quark.unregister();
    });

    it("isScoped retains the implicit @scope wrapping (quark-sheet default)", async () => {
      const provider = providerFixture();
      provider.provision = { name: "Ada" };
      provider.setAttribute("is-success", "");
      const quark = new Quark({
        src: `x-provider#root-user[is-success] { $user: prop("provision"); }
              span { content: $user.name; }`,
        options: { isScoped: true },
      });
      quark.register({
        sheetElement: provider.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      // the provider is outside the scope: the def never runs
      expect(provider.querySelector("span")?.textContent).toBe("");

      provider.provision = { name: "Grace" };
      await flush();
      expect(provider.querySelector("span")?.textContent).toBe("");
      quark.unregister();
    });

    it("global top-level rules match elements outside the host subtree", async () => {
      const root = fixture<HTMLElement>(
        `<div><section><div id="sheet"></div><span bind-x></span></section>` +
          `<aside><span bind-x></span></aside></div>`
      );
      const quark = mountGlobal(root, `[bind-x] { data-hit: ""; }`);
      await flush();

      expect(root.querySelectorAll("[bind-x][data-hit]")).toHaveLength(2);
      quark.unregister();
    });

    it("@scope rules stay host-scoped inside a global sheet", async () => {
      const root = fixture<HTMLElement>(
        `<div><section><div id="sheet"></div><span bind-x></span></section>` +
          `<aside><span bind-x></span></aside></div>`
      );
      const quark = mountGlobal(
        root,
        `@scope { [bind-x] { data-scoped: ""; } }`
      );
      await flush();

      expect(
        root.querySelector("section [bind-x]")?.hasAttribute("data-scoped")
      ).toBe(true);
      expect(
        root.querySelector("aside [bind-x]")?.hasAttribute("data-scoped")
      ).toBe(false);
      quark.unregister();
    });

    it("top-level :scope rules stay host-anchored in a global sheet", async () => {
      const root = fixture<HTMLElement>(
        `<div><section><div id="sheet"></div><span bind-x></span></section>` +
          `<aside><span bind-x></span></aside></div>`
      );
      const quark = new Quark({
        src: `:scope [bind-x] { data-host: ""; }`,
        options: { isScoped: false },
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();

      expect(
        root.querySelector("section [bind-x]")?.hasAttribute("data-host")
      ).toBe(true);
      expect(
        root.querySelector("aside [bind-x]")?.hasAttribute("data-host")
      ).toBe(false);
      quark.unregister();
    });
  });

  describe("value semantics (wipe / preserve)", () => {
    it("wipes content and attributes when an expression resolves to undefined", async () => {
      const { root, quark, register } = createSheet(
        `<p bind-x>initial</p><span bind-y data-flag="on"></span>`,
        `[bind-x] { content: maybe(); }
         [bind-y] { data-flag: maybe(); }`,
        { maybe: () => undefined }
      );
      register();
      await flush();

      expect(root.querySelector("[bind-x]")?.textContent).toBe("");
      expect(root.querySelector("[bind-y]")?.hasAttribute("data-flag")).toBe(
        false
      );
      quark.unregister();
    });

    it("preserve keeps existing content and attributes untouched", async () => {
      const { root, quark, register } = createSheet(
        `<p bind-x>initial</p><span bind-y data-flag="on"></span>`,
        `[bind-x] { content: maybe() or preserve; }
         [bind-y] { data-flag: maybe() or preserve; }`,
        { maybe: () => undefined }
      );
      register();
      await flush();

      expect(root.querySelector("[bind-x]")?.textContent).toBe("initial");
      expect(root.querySelector("[bind-y]")?.getAttribute("data-flag")).toBe(
        "on"
      );
      quark.unregister();
    });

    it("preserve leaves an existing binding in place", async () => {
      const { root, quark, register } = createSheet(
        `<main><p bind-x></p></main>`,
        `main { $val: "kept"; }
         main { $val: preserve; }
         [bind-x] { content: $val; }`
      );
      register();
      await flush();

      expect(root.querySelector("[bind-x]")?.textContent).toBe("kept");
      quark.unregister();
    });

    it("no-ops instead of wiping when an expression fails to evaluate", async () => {
      const { root, quark, register } = createSheet(
        `<p bind-x>initial</p>`,
        `[bind-x] { content: explode(); }`,
        {
          explode: () => {
            throw new Error("boom");
          },
        }
      );
      register();
      await flush();

      expect(root.querySelector("[bind-x]")?.textContent).toBe("initial");
      quark.unregister();
    });

    it("logs the failing element as a tag label, never as a node tree", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { quark, register } = createSheet(
        `<p id="boom" bind-x>initial</p>`,
        `[bind-x] { content: explode(); }`,
        {
          explode: () => {
            throw new Error("boom");
          },
        }
      );
      register();
      await flush();

      expect(spy).toHaveBeenCalled();
      const args = spy.mock.calls.flat();
      const hasNode = (value: unknown): boolean =>
        value instanceof Node ||
        (Array.isArray(value) && value.some(hasNode)) ||
        (!!value &&
          typeof value === "object" &&
          !(value instanceof Error) &&
          Object.values(value).some(hasNode));
      expect(args.some(hasNode)).toBe(false);
      expect(args).toContain("<p#boom>");
      spy.mockRestore();
      quark.unregister();
    });
  });

  describe("CSS custom properties (--)", () => {
    const propOf = (el: Element | null, name: string) =>
      (el as HTMLElement | null)?.style.getPropertyValue(name);

    it("sets a custom property from a quoted string", async () => {
      const { root, quark, register } = createSheet(
        `<details><summary>panel</summary></details>`,
        `details { --border-color: "transparent"; }`
      );
      register();
      await flush();

      expect(propOf(root.querySelector("details"), "--border-color")).toBe(
        "transparent"
      );
      quark.unregister();
    });

    it("reacts to attribute state like any other property", async () => {
      const { root, quark, register } = createSheet(
        `<details><summary>panel</summary></details>`,
        `details {
           --border-color: "transparent";
           &[open] { --border-color: "#3fa9f5"; }
         }`
      );
      register();
      await flush();
      const details = root.querySelector("details") as HTMLElement;
      expect(propOf(details, "--border-color")).toBe("transparent");

      details.setAttribute("open", "");
      await flush();
      expect(propOf(details, "--border-color")).toBe("#3fa9f5");

      // no unmatch reversion (documented divergence from CSS): the closed
      // state must be written by its own rule, so the value persists here
      details.removeAttribute("open");
      await flush();
      expect(propOf(details, "--border-color")).toBe("#3fa9f5");
      quark.unregister();
    });

    it("resolves values from JS callouts and bindings reactively", async () => {
      const { root, quark, register } = createSheet(
        `<main><section></section></main>`,
        `main { $accent: "blue"; }
         section { --accent: getColor($accent); }`,
        { getColor: (base: string) => `var(--${base})` }
      );
      register();
      await flush();
      const section = root.querySelector("section");
      expect(propOf(section, "--accent")).toBe("var(--blue)");
      // a JS write on the owner re-runs the reader with the new value
      root.querySelector("main")!.quark.setProperty("$accent", "red");
      await flush();
      expect(propOf(section, "--accent")).toBe("var(--red)");
      quark.unregister();
    });

    it("passes a trailing !important to the priority argument", async () => {
      const { root, quark, register } = createSheet(
        `<section></section>`,
        `section { --accent: "red !important"; }`
      );
      register();
      await flush();

      const style = (root.querySelector("section") as HTMLElement).style;
      expect(style.getPropertyValue("--accent")).toBe("red");
      expect(style.getPropertyPriority("--accent")).toBe("important");
      quark.unregister();
    });

    it("allows numeric expression results", async () => {
      const { root, quark, register } = createSheet(
        `<section></section>`,
        `section { --columns: 2 + 1; --progress: (3 / 4 * 100) + "%"; }`
      );
      register();
      await flush();

      const section = root.querySelector("section");
      expect(propOf(section, "--columns")).toBe("3");
      expect(propOf(section, "--progress")).toBe("75%");
      quark.unregister();
    });

    it("removes the property on wipe values", async () => {
      const { root, quark, register } = createSheet(
        `<section data-x></section>`,
        `section { --accent: "red"; }
         section[data-x] { --accent: none; }`
      );
      register();
      await flush();

      expect(propOf(root.querySelector("section"), "--accent")).toBe("");
      quark.unregister();
    });

    it("preserve leaves the current value untouched", async () => {
      const { root, quark, register } = createSheet(
        `<section></section>`,
        `section { --accent: "red"; }
         section { --accent: preserve; }`
      );
      register();
      await flush();

      expect(propOf(root.querySelector("section"), "--accent")).toBe("red");
      quark.unregister();
    });

    it("rejects bare CSS literals at construction (quote them)", async () => {
      QuarkLogger.suppress();
      const errorSpy = vi.spyOn(QuarkLogger, "error");
      const { root, quark, register } = createSheet(
        `<section></section>`,
        `section { --accent: #ccc; --width: 10px; }`
      );
      register();
      await flush();

      expect(
        errorSpy.mock.calls.filter((args) =>
          String((args[0] as { message?: string })?.message).includes(
            "must be quoted"
          )
        )
      ).toHaveLength(2);
      const section = root.querySelector("section");
      expect(propOf(section, "--accent")).toBe("");
      expect(propOf(section, "--width")).toBe("");
      errorSpy.mockRestore();
      QuarkLogger.unsuppress();
      quark.unregister();
    });

    it("no-ops (with a logged error) on unquoted identifiers", async () => {
      // `red` parses as an identifier lookup, not defined, so the standard
      // failed-evaluation no-op applies
      QuarkLogger.suppress();
      const { root, quark, register } = createSheet(
        `<section></section>`,
        `section { --accent: red; }`
      );
      register();
      await flush();
      QuarkLogger.unsuppress();

      expect(propOf(root.querySelector("section"), "--accent")).toBe("");
      quark.unregister();
    });

    it("errors (without crashing) on non-string results", async () => {
      QuarkLogger.suppress();
      const errorSpy = vi.spyOn(QuarkLogger, "error");
      const { root, quark, register } = createSheet(
        `<section></section>`,
        `section { --meta: getObj(); }`,
        { getObj: () => ({ nope: true }) }
      );
      register();
      await flush();

      expect(
        errorSpy.mock.calls.some((args) =>
          String((args[0] as { message?: string })?.message).includes(
            "must resolve to a string"
          )
        )
      ).toBe(true);
      expect(propOf(root.querySelector("section"), "--meta")).toBe("");
      errorSpy.mockRestore();
      QuarkLogger.unsuppress();
      quark.unregister();
    });
  });

  describe("lifecycle", () => {
    it("stops reacting after unregister", async () => {
      const { root, quark, register } = createSheet(
        `<details><p bind-status></p></details>`,
        `details[open] [bind-status] { content: "opened"; }`
      );
      register();
      await flush();
      quark.unregister();

      const meter = measureComplexity(quark);
      root.querySelector("details")!.setAttribute("open", "");
      await flush();
      const budget = meter.take();
      meter.stop();

      expect(root.querySelector("[bind-status]")?.textContent).toBe("");
      expectComplexity(budget);
    });

    it("supports two sheets on the same host", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet-a"></div>
        <div id="sheet-b"></div>
        <span bind-a></span>
        <span bind-b></span>
      </section>`);
      const a = new Quark({
        options: { isScoped: true },
        src: `[bind-a] { content: "A"; }`,
      });
      const b = new Quark({
        options: { isScoped: true },
        src: `[bind-b] { content: "B"; }`,
      });
      const meterA = measureComplexity(a);
      const meterB = measureComplexity(b);
      a.register({
        sheetElement: root.querySelector("#sheet-a") as HTMLElement,
      });
      b.register({
        sheetElement: root.querySelector("#sheet-b") as HTMLElement,
      });
      await flush();
      const budgetA = meterA.take();
      const budgetB = meterB.take();
      meterA.stop();
      meterB.stop();

      expect(root.querySelector("[bind-a]")?.textContent).toBe("A");
      expect(root.querySelector("[bind-b]")?.textContent).toBe("B");
      expectComplexity(budgetA);
      expectComplexity(budgetB);
      a.unregister();
      b.unregister();
    });
  });
});
