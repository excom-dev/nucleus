/**
 * `@use "quark:<name>"`: the built-in modules — resolved without a fetch,
 * namespaced like JS modules, documented in `language.ts` `BUILTIN_MODULES`
 * (the docs and the runtime export lists are kept in step here).
 */
import { AT_RULES, BUILTIN_MODULES } from "../../src/language";
import { QUARK_MODULES } from "../../src/builtin-modules";
import { QuarkLogger } from "../../src/utils";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { flush, mount, unregisterAll } from "./helpers";

const { math, list, map, string, date, url, util } = QUARK_MODULES;

describe("built-in modules", () => {
  afterEach(() => {
    unregisterAll();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("documentation", () => {
    it("documents exactly the modules and exports the runtime resolves", () => {
      expect(BUILTIN_MODULES.map((m) => m.name).sort()).toEqual(
        Object.keys(QUARK_MODULES).sort()
      );
      for (const doc of BUILTIN_MODULES) {
        expect(
          doc.functions.map((f) => f.name).sort(),
          `quark:${doc.name}`
        ).toEqual(Object.keys(QUARK_MODULES[doc.name]).sort());
        for (const fn of doc.functions) {
          expect(fn.signature.length, fn.name).toBeGreaterThan(0);
          expect(fn.description.length, fn.name).toBeGreaterThan(0);
        }
      }
    });

    it("documents @delay and @warn / @debug / @error as executed at-rules", () => {
      const syntaxes = AT_RULES.map((a) => a.syntax);
      expect(syntaxes.some((s) => s.startsWith("@delay "))).toBe(true);
      expect(syntaxes.some((s) => s.startsWith("@warn "))).toBe(true);
    });
  });

  describe("in sheets", () => {
    it("imports a module by namespace, by derived name, and bare with `as *`", async () => {
      const { root } = mount(
        `<p id="o"></p>`,
        `@use "quark:math" as m;
         @use "quark:list";
         @use "quark:string" as *;
         #o {
           $rows: ((name: "b", n: 2), (name: "a", n: 1));
           data-clamp: m.clamp(0, 5, 1);
           data-pi: m.round(m.$pi, 2);
           data-first: list.first(list.sort-by($rows, "name")).name;
           data-count: list.count($rows, "n", 2);
           data-plural: plural(list.sum($rows, "n"), (one: "# item", other: "# items"));
         }`
      );
      await flush();
      const out = root.querySelector("#o")!;
      expect(out.getAttribute("data-clamp")).toBe("1");
      expect(out.getAttribute("data-pi")).toBe("3.14");
      expect(out.getAttribute("data-first")).toBe("a");
      expect(out.getAttribute("data-count")).toBe("1");
      expect(out.getAttribute("data-plural")).toBe("3 items");
    });

    it("logs and skips an unknown quark: module, naming the available ones; the sheet still runs", async () => {
      const error = vi.spyOn(QuarkLogger, "error").mockImplementation(() => {});
      const { root } = mount(
        `<p id="o"></p>`,
        `@use "quark:nope" as nope; #o { data-ok: "yes"; }`
      );
      await flush();
      expect(root.querySelector("#o")!.getAttribute("data-ok")).toBe("yes");
      const failed = error.mock.calls.find(([arg]) =>
        String((arg as { message?: string })?.message).includes(
          'Failed to load @use module "quark:nope"'
        )
      );
      expect(failed).toBeDefined();
      expect(String((failed![0] as { error?: unknown[] }).error?.[0])).toMatch(
        /available: "quark:math"/
      );
    });

    it("never fetches a quark: module through the module loader", async () => {
      const loader = vi.fn(async () => ({}));
      const previous = (await import("../../index")).Quark.moduleLoader;
      (await import("../../index")).Quark.moduleLoader = loader;
      try {
        mount(
          `<p id="o"></p>`,
          `@use "quark:util" as u; #o { data-t: u.type-of(none); }`
        );
        await flush();
        expect(loader).not.toHaveBeenCalled();
        expect(document.querySelector("#o")!.getAttribute("data-t")).toBe(
          "null"
        );
      } finally {
        (await import("../../index")).Quark.moduleLoader = previous;
      }
    });
  });

  describe("quark:math", () => {
    it("handles the CSS argument order, rounding, wrapping modulo and coercion", () => {
      expect(math.clamp(0, 5, 1)).toBe(1);
      expect(math.clamp(0, -1, 1)).toBe(0);
      expect(math.clamp("0", "0.5", "1")).toBe(0.5);
      expect(math.min(3, 1, 2)).toBe(1);
      expect(math.max([3, 1], 2)).toBe(3);
      expect(math.round(3.14159, 2)).toBe(3.14);
      expect(math.round(2.5)).toBe(3);
      expect(math.floor(1.9)).toBe(1);
      expect(math.ceil(1.1)).toBe(2);
      expect(math.abs(-4)).toBe(4);
      expect(math.mod(-1, 3)).toBe(2);
      expect(math.mod(7, 3)).toBe(1);
      expect(math.mod(1, 0)).toBeNaN();
      expect(math.pow(2, 10)).toBe(1024);
      expect(math.sqrt(16)).toBe(4);
      expect(math.percentage(0.25)).toBe("25%");
      expect(math.abs("nope")).toBe(0);
      expect(math.$pi).toBe(Math.PI);
      expect(math.$e).toBe(Math.E);
    });
  });

  describe("quark:list", () => {
    const rows = [
      { id: 1, name: "Bea", done: true, tags: ["x"] },
      { id: 2, name: "al", done: false, tags: [] },
      { id: 3, name: "Cy", done: false, tags: null },
      { id: 10, name: "al", done: true },
    ];

    it("counts, finds, filters and rejects by path and value", () => {
      expect(list.count(rows)).toBe(4);
      expect(list.count(rows, "done", true)).toBe(2);
      expect(list.count(rows, "tags")).toBe(1);
      expect(list.count(null)).toBe(0);
      expect(list.count({ a: 1, b: 2 })).toBe(2);
      expect(list.find(rows, "id", "2")).toBe(rows[1]);
      expect(list.find(rows, "id", 99)).toBeUndefined();
      expect(list.find(undefined, "id", 1)).toBeUndefined();
      expect(list.find([{ a: { b: 1 } }, { a: { b: 2 } }], "a.b", 2)).toEqual({
        a: { b: 2 },
      });
      expect(list.reverse(undefined)).toEqual([]);
      expect(list.filter(rows, "done", false).map((r: any) => r.id)).toEqual([
        2, 3,
      ]);
      expect(list.filter(rows, "tags").map((r: any) => r.id)).toEqual([1]);
      expect(list.reject(rows, "done", false).map((r: any) => r.id)).toEqual([
        1, 10,
      ]);
      expect(list.reject(rows, "tags").map((r: any) => r.id)).toEqual([
        2, 3, 10,
      ]);
      expect(list.filter(undefined, "x", 1)).toEqual([]);
    });

    it("plucks, sorts, sums, groups and dedupes", () => {
      expect(list.pluck(rows, "name")).toEqual(["Bea", "al", "Cy", "al"]);
      expect(list["sort-by"](rows, "name").map((r: any) => r.id)).toEqual([
        2, 10, 1, 3,
      ]);
      expect(list["sort-by"](rows, "id", "desc").map((r: any) => r.id)).toEqual(
        [10, 3, 2, 1]
      );
      expect(list["sort-by"]([3, "10", 2])).toEqual([2, 3, "10"]);
      expect(
        list["sort-by"]([{ n: 2 }, { n: null }, { n: 1 }], "n").map(
          (r: any) => r.n
        )
      ).toEqual([1, 2, null]);
      expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 10]);
      expect(list.sum([1, "2", "x"])).toBe(3);
      expect(list.sum(rows, "id")).toBe(16);
      expect(list.sum(null)).toBe(0);
      expect(list["group-by"](rows, "done")).toEqual({
        true: [rows[0], rows[3]],
        false: [rows[1], rows[2]],
      });
      expect(list.unique([1, "1", 1, 2])).toEqual([1, "1", 2]);
      expect(list.unique(rows, "name").map((r: any) => r.id)).toEqual([
        1, 2, 3,
      ]);
    });

    it("builds ranges and reads ends", () => {
      expect(list.range(3)).toEqual([0, 1, 2]);
      expect(list.range(1, 4)).toEqual([1, 2, 3]);
      expect(list.range(0, 10, 5)).toEqual([0, 5]);
      expect(list.range(3, 0)).toEqual([3, 2, 1]);
      expect(list.range(0)).toEqual([]);
      expect(list.first(rows)).toBe(rows[0]);
      expect(list.last(rows)).toBe(rows[3]);
      expect(list.first([])).toBeUndefined();
      expect(list.reverse([1, 2])).toEqual([2, 1]);
      expect(
        list.compact([0, null, "", undefined, [], {}, "a", false])
      ).toEqual([0, "a", false]);
    });
  });

  describe("quark:map", () => {
    const source = { a: 1, b: { c: 2 }, d: null };
    it("reads paths, lists entries and builds copies", () => {
      expect(map.get(source, "b.c")).toBe(2);
      expect(map.get(source, "b.x", "fallback")).toBe("fallback");
      expect(map.get(source, "d", "fallback")).toBeNull();
      expect(map["has-key"](source, "b.c")).toBe(true);
      expect(map["has-key"](source, "z")).toBe(false);
      expect(map.keys(source)).toEqual(["a", "b", "d"]);
      expect(map.values(source)).toEqual([1, { c: 2 }, null]);
      expect(map.entries({ x: 1 })).toEqual([{ key: "x", value: 1 }]);
      expect(map.keys(null)).toEqual([]);
      expect(map.merge({ a: 1 }, null, { a: 2, b: 3 })).toEqual({ a: 2, b: 3 });
      expect(map.pick(source, "a", ["d"])).toEqual({ a: 1, d: null });
      expect(map.omit(source, "b")).toEqual({ a: 1, d: null });
      expect(source).toEqual({ a: 1, b: { c: 2 }, d: null });
    });
  });

  describe("quark:string", () => {
    it("pluralizes, escapes, truncates, capitalizes and slugifies", () => {
      const forms = { one: "# item", other: "# items" };
      expect(string.plural(1, forms)).toBe("1 item");
      expect(string.plural("2", forms)).toBe("2 items");
      expect(string.plural(0, forms)).toBe("0 items");
      expect(string.plural(1, { other: "things" })).toBe("things");
      expect(string.plural(1, null)).toBe("");
      expect(string["escape-html"]('<a href="x">&</a>')).toBe(
        "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;"
      );
      expect(string["escape-html"](null)).toBe("");
      expect(string.truncate("hello world", 8)).toBe("hello w…");
      expect(string.truncate("hello", 8)).toBe("hello");
      expect(string.truncate("hello world", 8, "...")).toBe("hello...");
      expect(string.capitalize("quark")).toBe("Quark");
      expect(string.capitalize(null)).toBe("");
      expect(string.slugify("Héllo, World! 2")).toBe("hello-world-2");
    });
  });

  describe("quark:date", () => {
    it("parses, validates, formats, adds and diffs", () => {
      const parsed = date.parse("2026-09-13T00:00:00Z");
      expect(parsed).toBeInstanceOf(Date);
      expect(date.parse("nope")).toBeNull();
      expect(date.parse(null)).toBeNull();
      expect(date["is-valid"]("2026-09-13")).toBe(true);
      expect(date["is-valid"]("")).toBe(false);
      expect(
        date.format("2026-09-13T12:00:00Z", "en-US", {
          year: "numeric",
          timeZone: "UTC",
        })
      ).toBe("2026");
      expect(date.format("nope")).toBe("");
      expect(date.add("2026-09-13T00:00:00Z", 3, "days")!.toISOString()).toBe(
        "2026-09-16T00:00:00.000Z"
      );
      expect(date.add("2026-01-31T00:00:00Z", 1, "month")!.getUTCMonth()).toBe(
        2
      );
      expect(
        date.add("2026-09-13T00:00:00Z", 2, "years")!.getUTCFullYear()
      ).toBe(2028);
      expect(date.add("nope", 1)).toBeNull();
      expect(date.diff("2026-09-16T00:00:00Z", "2026-09-13T00:00:00Z")).toBe(3);
      expect(
        date.diff("2026-09-13T00:00:00Z", "2026-09-16T00:00:00Z", "hours")
      ).toBe(-72);
      expect(date.diff("2027-03-01", "2026-01-01", "months")).toBe(14);
      expect(date.diff("2027-03-01", "2026-01-01", "years")).toBe(1);
      expect(date.diff("x", "2026-01-01")).toBeNull();
    });
  });

  describe("quark:url", () => {
    it("builds and reads query strings", () => {
      expect(
        url.query({
          q: "a b",
          page: 2,
          empty: "",
          none: null,
          tags: ["x", "y"],
        })
      ).toBe("q=a+b&page=2&tags=x&tags=y");
      expect(url.query(null)).toBe("");
      expect(url.params("/search?q=a&page=2&t=x&t=y")).toEqual({
        q: "a",
        page: "2",
        t: ["x", "y"],
      });
      expect(url.params("?only=1")).toEqual({ only: "1" });
      expect(url.params("plain=1")).toEqual({ plain: "1" });
      expect(url.params(null)).toEqual({});
      expect(url.encode("a b&c")).toBe("a%20b%26c");
    });
  });

  describe("quark:util", () => {
    it("coalesces, tests emptiness, names types and round-trips JSON", () => {
      expect(util.coalesce(null, undefined, 0, "x")).toBe(0);
      expect(util.coalesce(null)).toBeUndefined();
      expect(util["is-empty"]("")).toBe(true);
      expect(util["is-empty"]([])).toBe(true);
      expect(util["is-empty"]({})).toBe(true);
      expect(util["is-empty"](0)).toBe(false);
      expect(util["type-of"](null)).toBe("null");
      expect(util["type-of"]([])).toBe("list");
      expect(util["type-of"]({})).toBe("map");
      expect(util["type-of"](new Date())).toBe("date");
      expect(util["type-of"](1)).toBe("number");
      expect(util["to-json"]({ a: 1 })).toBe('{"a":1}');
      expect(util["to-json"]({ a: 1 }, 2)).toBe('{\n  "a": 1\n}');
      expect(util["to-json"](undefined)).toBe("");
      expect(util["from-json"]('{"a":1}')).toEqual({ a: 1 });
      expect(util["from-json"]("nope")).toBeNull();
      expect(util["from-json"](5)).toBeNull();
    });
  });
});
