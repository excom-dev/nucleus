/**
 * Built-in expression functions and the lazy scope: edge inputs for each
 * built-in, `iterate()` row reuse when a keyed row changes in place, and
 * module-scope resolution without a rule / host.
 */
import { createScope } from "../../src/variables";
import { Quark } from "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mount, unregisterAll } from "./helpers";

describe("built-ins", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("scope", () => {
    it("resolves keywords and built-ins without a rule, and rejects unknown names", () => {
      const element = document.createElement("div");
      const scope = createScope({ element, options: {} });
      expect(scope.lookup("none")).toBeNull();
      expect(scope.lookup("$unbound")).toBeUndefined();
      expect(() => scope.lookup("nope")).toThrow('"nope" is not defined');
      // one instance per name per evaluation
      expect(scope.lookup("ternary")).toBe(scope.lookup("ternary"));
      // list helpers moved to `quark:list` (2026-09-13)
      expect(() => scope.lookup("find")).toThrow('"find" is not defined');
      expect(() => scope.lookup("reverse")).toThrow('"reverse" is not defined');
      expect(scope.lookup("item")).toBeUndefined();
      expect(scope.lookup("index")).toBeUndefined();
      expect(scope.lookup("element")).toBe(element);
    });

    it("falls back to an empty module scope when the host is gone", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const element = document.createElement("div");
      const scope = createScope({
        element,
        options: {
          rule: {
            quarkInstance: { host: { deref: () => undefined }, hash: "h" },
          },
        } as any,
      });
      expect(() => scope.lookup("greet")).toThrow('"greet" is not defined');
      expect(error).toHaveBeenCalled();
    });

    it("exposes the helper built-ins with lenient inputs", () => {
      const scope = createScope({
        element: document.createElement("div"),
        options: {},
      });
      const ternary = scope.lookup("ternary") as Function;
      expect(ternary(true, "a", "b")).toBe("a");
      expect(ternary(false, "a", "b")).toBe("b");
      expect(ternary(false, "a")).toBeNull();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      expect((scope.lookup("log") as Function)("x", 1)).toEqual(["x", 1]);
      expect(log).toHaveBeenCalledTimes(1);
      expect((scope.lookup("debug") as Function)("y")).toEqual(["y"]);
      const html = scope.lookup("dangerous-html") as Function;
      expect(html("<b>x</b>")).toEqual({ type: "html", value: "<b>x</b>" });
      expect(html({ not: "primitive" })).toBeUndefined();
    });
  });

  describe("prop() / attr()", () => {
    it('reads nothing for a non-string prop name and innerHTML for attr("content")', async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { root } = mount(
        `<p bind-x><b>in</b></p>`,
        `:scope { $n: 5; }
         [bind-x] { data-p: prop($n) or "none"; data-html: attr("content"); }`
      );
      await flush();
      const p = root.querySelector("[bind-x]")!;
      expect(p.getAttribute("data-p")).toBe("none");
      expect(p.getAttribute("data-html")).toBe("<b>in</b>");
      warn.mockRestore();
    });
  });

  describe("template() / iterate()", () => {
    it("defaults the template reference to the element's own <template>", async () => {
      const { root } = mount(
        `<article><template><p bind-body>own</p></template></article>`,
        `article { content: template(); }`
      );
      await flush();
      expect(root.querySelector("article > p")?.textContent).toBe("own");
    });

    it("wipes rows for a missing collection and for a non-collection", async () => {
      const { root } = mount(
        `<ul bind-a><template><li></li></template><li>old</li></ul>
         <ul bind-b><template><li></li></template><li>old</li></ul>`,
        `[bind-a] { content: iterate($missing); }
         [bind-b] { content: iterate("text"); }`
      );
      await flush();
      expect(root.querySelectorAll("[bind-a] li")).toHaveLength(0);
      expect(root.querySelectorAll("[bind-b] li")).toHaveLength(0);
      expect(root.querySelectorAll("template")).toHaveLength(2);
    });

    it("re-runs only the keyed row whose data changed in place", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <ul><template><li bind-label></li></template></ul>
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
      await flush();
      const rows = [...root.querySelectorAll("ul > li")];
      expect(rows.map((r) => r.textContent)).toEqual(["one", "two"]);

      provider.provision = [
        { id: "1", label: "one" },
        { id: "2", label: "two!" },
      ];
      await flush();
      const after = [...root.querySelectorAll("ul > li")];
      expect(after[0]).toBe(rows[0]);
      expect(after[1]).toBe(rows[1]);
      expect(after.map((r) => r.textContent)).toEqual(["one", "two!"]);
      quark.unregister();
    });

    it("reuses unkeyed rows by content hash when the list grows", async () => {
      const root = fixture<HTMLElement>(`<section>
        <div id="sheet"></div>
        <data-provider is-success>
          <ul><template><li bind-label></li></template></ul>
        </data-provider>
      </section>`);
      const provider = root.querySelector("data-provider") as HTMLElement & {
        provision?: string[];
      };
      provider.provision = ["a", "b"];
      const quark = new Quark({
        options: { isScoped: true },
        src: `data-provider[is-success] {
          $items: prop("provision");
          ul { content: iterate($items); }
          [bind-label] { content: item; }
        }`,
      });
      quark.register({
        sheetElement: root.querySelector("#sheet") as HTMLElement,
      });
      await flush();
      const rows = [...root.querySelectorAll("ul > li")];
      provider.provision = ["b", "a", "c"];
      await flush();
      const after = [...root.querySelectorAll("ul > li")];
      expect(after.map((r) => r.textContent)).toEqual(["b", "a", "c"]);
      expect(after[0]).toBe(rows[1]);
      expect(after[1]).toBe(rows[0]);
      quark.unregister();
    });
  });
});
