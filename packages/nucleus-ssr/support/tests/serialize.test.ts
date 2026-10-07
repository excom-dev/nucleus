import { inertDom } from "../../src/inert";
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
  NO_SSR_ATTR,
  SSR_ATTR,
  STAMP_ATTR,
} from "@excom/kit-utils";
import { createDom } from "@excom/nucleus-dom";
import { describe, expect, it } from "@excom/nucleus-test";

const SEPARATORS = String.fromCharCode(0x2028, 0x2029);
const NAMES = {
  HYDRATION_ISLAND_ID,
  SSR_ATTR,
  INERT_ATTR,
  STAMP_ATTR,
  NO_SSR_ATTR,
};

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
        names: NAMES,
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

describe("serialize: island", () => {
  it("writes the responses by method and URL, whichever order they were recorded in", async () => {
    const { document, dispose } = createDom({
      html: `<!DOCTYPE html><html><head></head><body></body></html>`,
    });
    const response = (method: "GET" | "HEAD", url: string) => ({
      method,
      url,
      record: { url, status: 200, statusText: "OK", ok: true, redirected: false, type: "basic" as const, headers: [], body: url },
    });
    try {
      const recorded = [
        response("HEAD", "/a"),
        response("GET", "/b?x=2"),
        response("GET", "/B"),
        response("GET", "/b?x=10"),
        response("GET", "/a"),
      ];
      const { html } = serialize(document, {
        names: NAMES,
        responses: recorded,
        shell: { head: new Set(document.head.childNodes), parsed: document.implementation.createHTMLDocument() },
        doctype: "",
      });
      const island = JSON.parse(parse(html).getElementById(HYDRATION_ISLAND_ID)!.textContent!);
      expect(island.responses.map(({ method, url }: { method: string; url: string }) => `${method} ${url}`)).toEqual([
        "GET /B",
        "GET /a",
        "GET /b?x=10",
        "GET /b?x=2",
        "HEAD /a",
      ]);
      // what the render recorded stays as it was
      expect(recorded[0]!.method).toBe("HEAD");
    } finally {
      await dispose();
    }
  });
});

describe("serialize: no-ssr regions", () => {
  it("fails a Neutron element no-ssr reached once it had started; none there gets an n-ssr id", async () => {
    const { window, document, dispose } = createDom({
      html: `<!DOCTYPE html><html><head></head><body><x-kept id="stamped" no-ssr n-tpl="html#1"></x-kept><section no-ssr><x-kept id="loaded" did-load></x-kept><x-kept id="waiting" is-loading></x-kept><x-kept id="provided"></x-kept><x-kept id="untouched"></x-kept><x-plain id="plain" did-load></x-plain></section><x-kept id="outside" did-load></x-kept></body></html>`,
    });
    try {
      // a Neutron element's class has `getConfig()`
      window.customElements.define(
        "x-kept",
        class extends window.HTMLElement {
          static getConfig() {
            return {};
          }
        }
      );
      window.customElements.define("x-plain", class extends window.HTMLElement {});
      // happy-dom upgrades by replacing the element; its id cache keeps the old one
      const provide = (id: string, provision: unknown) =>
        Object.assign(document.querySelector(`#${id}`)!, { provision });
      provide("provided", { n: 1 });
      provide("outside", { n: 2 });
      const { html, errors } = serialize(document, {
        names: NAMES,
        responses: [],
        shell: {
          head: new Set(document.head.childNodes),
          parsed: document.implementation.createHTMLDocument(),
        },
        doctype: "<!DOCTYPE html>",
      });
      const late =
        ": no-ssr reached it after it had started, and belongs in the markup or first in the rule that activates it";
      expect(errors).toEqual([
        `<x-kept id="stamped" no-ssr n-tpl="html#1"> holds [n-tpl]${late}`,
        `<x-kept id="loaded" did-load> holds [did-load]${late}`,
        `<x-kept id="waiting" is-loading> holds [is-loading]${late}`,
        `<x-kept id="provided"> holds a provision${late}`,
      ]);
      expect(
        Array.from(parse(html).querySelectorAll("body [n-ssr]"), ({ id }) => id)
      ).toEqual(["outside"]);
    } finally {
      await dispose();
    }
  });
});

describe("serialize head", () => {
  it("keeps the title, meta, canonical and alternate link nodes a render added, and drops any other (an alternate stylesheet too)", async () => {
    const { document, dispose } = inertDom(
      `<!DOCTYPE html><html><head><link rel="stylesheet" href="/shell.css"><link rel="alternate" href="/shell.md"></head><body></body></html>`
    );
    try {
      const shellHead = new Set(document.head.childNodes);
      document.head.insertAdjacentHTML(
        "beforeend",
        [
          "<title>Page</title>",
          '<meta name="description" content="About the page">',
          '<link rel="canonical" href="/page">',
          '<link rel="alternate" type="text/markdown" href="/page.md">',
          '<link rel="alternate stylesheet" title="Dark" href="/dark.css">',
          '<link rel="stylesheet" href="/added.css">',
          '<link rel="modulepreload" href="/chunk.js">',
          "<style>p { color: red; }</style>",
        ].join("")
      );
      const { html } = serialize(document, {
        names: NAMES,
        responses: [],
        shell: {
          head: shellHead,
          parsed: document.implementation.createHTMLDocument(),
        },
        doctype: "<!DOCTYPE html>",
      });
      expect(Array.from(parse(html).head.children, (node) => node.outerHTML)).toEqual([
        '<link rel="stylesheet" href="/shell.css">',
        '<link rel="alternate" href="/shell.md">',
        "<title>Page</title>",
        '<meta name="description" content="About the page">',
        '<link rel="canonical" href="/page">',
        '<link rel="alternate" type="text/markdown" href="/page.md">',
      ]);
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
