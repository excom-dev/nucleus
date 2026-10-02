import {
  isExecutable,
  isPlainData,
  scriptJson,
  serialize,
} from "../../src/serialize";
import { parse } from "./helpers";
import {
  HYDRATION_ISLAND_ID,
  INERT_ATTR,
  SSR_ATTR,
} from "@excom/kit-utils";
import { createDom } from "@excom/nucleus-dom";
import { describe, expect, it } from "@excom/nucleus-test";

const SEPARATORS = String.fromCharCode(0x2028, 0x2029);

describe("isPlainData", () => {
  it("accepts what a JSON round trip gives back as the same data", () => {
    const shared = { n: 1 };
    const match = "/menu/7".match(/\/menu\/(?<id>\d+)/)!;
    const values = [
      null,
      true,
      "text",
      0,
      -1.5,
      [],
      [1, "a", [null]],
      {},
      { a: { b: [shared, shared] } },
      Object.assign(Object.create(null), { a: 1 }),
      { dropped: undefined },
      // an array's own extras (`index`, `input`, `groups`) are dropped
      match,
      match.groups,
      // comes back `0`
      -0,
    ];
    expect(values.filter((value) => !isPlainData(value))).toEqual([]);
  });

  it("refuses what JSON would drop, change or throw on", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    class Point {
      x = 1;
    }
    const values = [
      undefined,
      () => 1,
      Symbol("s"),
      10n,
      NaN,
      Infinity,
      new Date(0),
      new Map(),
      /re/,
      new Point(),
      // eslint-disable-next-line no-sparse-arrays
      [1, , 3],
      [undefined],
      { method() {} },
      { [Symbol("s")]: 1 },
      [{ deep: () => 1 }],
      cycle,
      {
        get boom() {
          throw new Error("boom");
        },
      },
      document.body,
      // JSON would call it, not copy the array
      Object.assign([1], { toJSON: () => "one" }),
      // JSON would drop it
      Object.defineProperty({ shown: 1 }, "hidden", { value: 2 }),
    ];
    expect(values.filter(isPlainData)).toEqual([]);
  });
});

describe("isExecutable", () => {
  const script = (type?: string) => {
    const element = document.createElement("script");
    if (type !== undefined) element.setAttribute("type", type);
    return element;
  };

  it("tells the scripts a browser runs from data blocks", () => {
    const runs = [
      undefined,
      "",
      " module ",
      "text/javascript",
      "Application/JavaScript",
      "text/javascript; charset=utf-8",
      "application/x-javascript",
      "text/ecmascript",
      "text/javascript1.5",
      "text/jscript",
      "importmap",
      "speculationrules",
    ];
    const data = [
      "application/json",
      "application/ld+json",
      "text/plain",
      "text/template",
      "text/javascript2",
      "module/x",
    ];
    expect(runs.filter((type) => !isExecutable(script(type)))).toEqual([]);
    expect(data.filter((type) => isExecutable(script(type)))).toEqual([]);
  });
});

describe("serialize", () => {
  it("makes marked scripts inert inside templates too, nested ones included", async () => {
    // an html paint into a template, or html holding one: run once cloned
    const { document, dispose } = createDom({
      html: `<!DOCTYPE html><html><head></head><body><div><template><script n-inert>run(1)</script><template><script n-inert>run(2)</script></template></template></div></body></html>`,
    });
    try {
      const { html, neutralizedScripts } = serialize(document, {
        names: { HYDRATION_ISLAND_ID, SSR_ATTR, INERT_ATTR },
        responses: [],
        shell: {
          head: new Set(document.head.childNodes),
          parsed: document.implementation.createHTMLDocument(),
        },
        doctype: "<!DOCTYPE html>",
      });
      expect(neutralizedScripts).toBe(2);
      const outer = parse(html).querySelector("div > template") as HTMLTemplateElement;
      const inner = outer.content.querySelector("template") as HTMLTemplateElement;
      expect(
        [outer.content, inner.content].map((content) =>
          content.firstElementChild!.getAttribute("type")
        )
      ).toEqual(["text/plain", "text/plain"]);
    } finally {
      await dispose();
    }
  });
});

describe("scriptJson", () => {
  it("escapes what could close the script, open a comment or break a line", () => {
    const value = {
      html: `</script><!--<script id="nucleus-hydration">`,
      lines: `a${SEPARATORS}b`,
    };
    const json = scriptJson(value);
    expect(json).not.toMatch(new RegExp(`[<${SEPARATORS}]`));
    expect(json).toBe(
      '{"html":"\\u003c/script>\\u003c!--\\u003cscript id=\\"nucleus-hydration\\">","lines":"a\\u2028\\u2029b"}'
    );
    expect(JSON.parse(json)).toEqual(value);
  });
});
