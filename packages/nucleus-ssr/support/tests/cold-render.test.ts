import { compareRender } from "../../src/cold-render";
import { compareColdRender } from "../../testing";
import { afterEach, describe, expect, it, vi } from "@excom/nucleus-test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A page: the prerendered one carries `<html n-ssr>`. */
const page = (body: string, { head = "", html = "" } = {}) =>
  `<!doctype html><html lang="en"${html}><head><meta charset="utf-8"><title>Menu</title>${head}</head><body>${body}</body></html>`;
const served = (body: string, options: { head?: string } = {}) =>
  page(body, { ...options, html: ` n-ssr=""` });

const compare = (
  server: string,
  browser: string,
  rules: Partial<Parameters<typeof compareRender>[2]> = {}
) => compareRender(server, browser, { clientOnly: [], allow: [], ...rules });

const SAME = { serverOnly: 0, browserOnly: 0, different: 0 };

describe("compareRender", () => {
  it("finds nothing between a page and itself, attribute order aside", () => {
    const body = `<main id="content"><p class="a" data-x="1">Menu</p><!-- note --></main>`;
    const report = compare(
      served(body),
      page(body.replace(`class="a" data-x="1"`, `data-x="1" class="a"`))
    );
    expect(report).toEqual({
      serverOnly: [],
      browserOnly: [],
      different: [],
      counts: SAME,
      lazyViews: 0,
    });
  });

  it("reports what only the server has, what only the browser has, and what differs in place, apart", () => {
    const report = compare(
      served(
        `<ul bind-items><li>a</li><li>b</li><li>c</li></ul><p class="x" title="t">Text</p><h2>Head</h2>`
      ),
      page(
        `<ul bind-items><li>a</li><li>c</li></ul><p class="y" lang="en">Other</p><h3>Head</h3><aside></aside>`
      )
    );
    expect(report.serverOnly).toEqual([
      {
        path: "html > body > ul[bind-items]",
        server: "<li>",
        browser: "nothing",
      },
      {
        path: `html > body > p[class="x"]`,
        server: `[title="t"]`,
        browser: "nothing",
      },
    ]);
    expect(report.browserOnly).toEqual([
      {
        path: `html > body > p[class="x"]`,
        server: "nothing",
        browser: `[lang="en"]`,
      },
      { path: "html > body", server: "nothing", browser: "<aside>" },
    ]);
    expect(report.different).toEqual([
      {
        path: `html > body > p[class="x"]`,
        server: `[class="x"]`,
        browser: `[class="y"]`,
      },
      {
        path: `html > body > p[class="x"]`,
        server: `"Text"`,
        browser: `"Other"`,
      },
      { path: "html > body", server: "<h2>", browser: "<h3>" },
    ]);
    expect(report.counts).toEqual({
      serverOnly: 2,
      browserOnly: 2,
      different: 3,
    });
  });

  it("pairs equal subtrees first: a missing row is that row, not a shift of the others", () => {
    const rows = ["Tea", "Coffee", "Juice"].map(
      (name) => `<li><b>${name}</b></li>`
    );
    const report = compare(
      served(`<ul>${rows.join("")}</ul>`),
      page(`<ul>${rows.slice(1).join("")}</ul>`)
    );
    expect(report.counts).toEqual({ ...SAME, serverOnly: 1 });
    expect(report.serverOnly).toEqual([
      { path: "html > body > ul", server: "<li>", browser: "nothing" },
    ]);
  });

  it("names an element in a path by its tag, id, bind-*, class and api-url, and shows what each side has", () => {
    const report = compare(
      served(
        `<section id="s" bind-list="" class="c" api-url="/x" data-y="1"><p>A long text that goes on and on, well past sixty characters in all</p></section>`
      ),
      page(
        `<section id="s" bind-list="" class="c" api-url="/x" data-y="1"><p>B</p></section>`
      )
    );
    expect(report.different).toEqual([
      {
        path: `html > body > section#s[bind-list][class="c"][api-url="/x"] > p`,
        server: `"A long text that goes on and on, well past sixty characters …"`,
        browser: `"B"`,
      },
    ]);
  });

  it("keeps the first 20 of each kind and counts them all", () => {
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => `<p data-i="${i}"></p>`).join("");
    const report = compare(served(items(25)), page(""));
    expect([report.serverOnly.length, report.counts.serverOnly]).toEqual([
      20, 25,
    ]);
  });

  it("compares the doctype", () => {
    const report = compare(
      served("<p></p>"),
      page("<p></p>").replace("<!doctype html>", "")
    );
    expect(report.serverOnly).toEqual([
      { path: "#document", server: "<!doctype html>", browser: "nothing" },
    ]);
  });

  describe("1. what each side writes for itself", () => {
    it("leaves out the prerender's markers, the island and Quark's host ids, not an attribute beside them", () => {
      const report = compare(
        served(
          `<x-list n-ssr="0" n-tpl="/v.html#1" data-v="1"><template n-tpl-id="9"><li></li></template><li q-key="a">a</li></x-list>` +
            `<script type="application/json" id="nucleus-hydration">{"v":1}</script>`
        ),
        page(
          `<x-list q-scope="2" n-util-select-id-k3j="" data-v="2"><template><li></li></template><li>a</li></x-list>`
        )
      );
      expect(report.different).toEqual([
        {
          path: "html > body > x-list",
          server: `[data-v="1"]`,
          browser: `[data-v="2"]`,
        },
      ]);
      expect(report.counts).toEqual({ ...SAME, different: 1 });
      // the same markers where the other side writes them are differences
      expect(
        compare(served(`<p q-scope="1"></p>`), page(`<p n-tpl="x"></p>`)).counts
      ).toEqual({
        ...SAME,
        serverOnly: 1,
        browserOnly: 1,
      });
    });

    it("leaves out the type the serializer gave an inert script, not another script's", () => {
      const report = compare(
        served(
          `<div><script n-inert="" type="text/plain">go()</script><script type="text/plain">x</script></div>`
        ),
        page(
          `<div><script type="module">go()</script><script type="module">x</script></div>`
        )
      );
      expect(report.different).toEqual([
        {
          path: "html > body > div > script",
          server: `[type="text/plain"]`,
          browser: `[type="module"]`,
        },
      ]);
      expect(report.counts).toEqual({ ...SAME, different: 1 });
    });

    it("leaves out a loaded state only the browser has on an element written not loaded (no n-ssr id)", () => {
      const report = compare(
        served(
          `<x-a api-url="/api/me"></x-a><x-b did-load="" is-success=""></x-b><x-c n-ssr="0"></x-c>`
        ),
        page(
          `<x-a api-url="/api/me" did-load="" is-success=""></x-a><x-b></x-b><x-c did-load=""></x-c>`
        )
      );
      expect(report.serverOnly).toEqual([
        { path: "html > body > x-b", server: "[did-load]", browser: "nothing" },
        {
          path: "html > body > x-b",
          server: "[is-success]",
          browser: "nothing",
        },
      ]);
      // its provision is in the island: it was loaded, and says so
      expect(report.browserOnly).toEqual([
        { path: "html > body > x-c", server: "nothing", browser: "[did-load]" },
      ]);
      expect(report.counts).toEqual({ ...SAME, serverOnly: 2, browserOnly: 1 });
    });

    it("leaves out declarative shadow roots: the shell's, which a browser attached, and a render's, made inert", () => {
      const report = compare(
        served(
          `<x-card><template shadowrootmode="open"><slot></slot></template><span>light</span></x-card>` +
            `<div><template><p>inert</p></template></div>` +
            `<template><x-card><template shadowrootmode="open"><b></b></template></x-card></template>`
        ),
        page(
          `<x-card><span>light</span></x-card>` +
            `<div><template shadowrootmode="open"><p>inert</p></template></div>` +
            `<template><x-card></x-card></template>`
        )
      );
      // in template content nothing is attached: what differs there is reported
      expect(report.serverOnly).toEqual([
        {
          path: "html > body > template > x-card",
          server: `<template shadowrootmode="open">`,
          browser: "nothing",
        },
      ]);
      expect(report.counts).toEqual({ ...SAME, serverOnly: 1 });
      // an attribute other than the one the serializer strips is compared
      expect(
        compare(
          served(`<template shadowrootdelegatesfocus=""></template>`),
          page(`<template shadowrootmode="open"></template>`)
        ).serverOnly
      ).toEqual([
        {
          path: "html > body > template",
          server: "[shadowrootdelegatesfocus]",
          browser: "nothing",
        },
      ]);
    });
  });

  it("2. compares in <head> what the serializer keeps of a render's additions: <title>, <meta>, canonical and alternate links that are no stylesheet", () => {
    const report = compare(
      served("<p></p>", {
        head: `<link rel="canonical" href="https://a.test/menu"><meta name="description" content="Menu"><link rel="stylesheet" href="/a.css"><link rel="alternate stylesheet" title="dark" href="/d.css">`,
      }),
      page("<p></p>", {
        head: `<link rel="modulepreload" href="/assets/x.js"><style>p{}</style><meta name="description" content="Menus"><link rel="alternate" type="text/markdown" href="/menu.md"><script type="module" src="/x.js"></script>`,
      })
    );
    expect(report.serverOnly).toEqual([
      {
        path: "html > head",
        server: `<link rel="canonical" href="https://a.test/menu">`,
        browser: "nothing",
      },
    ]);
    expect(report.browserOnly).toEqual([
      {
        path: "html > head",
        server: "nothing",
        browser: `<link rel="alternate" type="text/markdown" href="/menu.md">`,
      },
    ]);
    expect(report.different).toEqual([
      {
        path: "html > head > meta",
        server: `[content="Menu"]`,
        browser: `[content="Menus"]`,
      },
    ]);
  });

  describe("3. regions kept out of the prerender", () => {
    it("leaves out a no-ssr element's attributes and what it holds; on one side only, its no-ssr is a difference", () => {
      const report = compare(
        served(
          `<div no-ssr=""><p>Loading…</p></div><p>a</p><x-demo no-ssr=""></x-demo><x-late></x-late>`
        ),
        page(
          `<div no-ssr="" data-mounted=""><section>Demo</section></div><p>b</p><x-demo no-ssr="" is-ready=""><b></b></x-demo><x-late no-ssr="" is-ready=""><b></b></x-late>`
        )
      );
      expect(report.different).toEqual([
        { path: "html > body > p", server: `"a"`, browser: `"b"` },
      ]);
      expect(report.browserOnly).toEqual([
        {
          path: "html > body > x-late",
          server: "nothing",
          browser: "[no-ssr]",
        },
      ]);
      expect(report.counts).toEqual({ ...SAME, different: 1, browserOnly: 1 });
    });

    it("leaves out a client-only tag's own attributes, not what it holds", () => {
      const report = compare(
        served(`<detect-media><p>Wide</p></detect-media><x-other></x-other>`),
        page(
          `<detect-media is-phone=""><p>Narrow</p></detect-media><x-other is-phone=""></x-other>`
        ),
        { clientOnly: ["detect-media", "service-worker"] }
      );
      expect(report.different).toEqual([
        {
          path: "html > body > detect-media > p",
          server: `"Wide"`,
          browser: `"Narrow"`,
        },
      ]);
      expect(report.browserOnly).toEqual([
        {
          path: "html > body > x-other",
          server: "nothing",
          browser: "[is-phone]",
        },
      ]);
    });
  });

  it("4. counts a lazy-load view the browser has not activated, without comparing it; one in template content is compared", () => {
    const view = (active: string, text: string) =>
      `<include-content lazy-load=""${active}><p>${text}</p></include-content>`;
    const report = compare(
      served(
        view(` is-active="" did-load="" n-tpl="#1"`, "Rendered") +
          view(` is-active=""`, "Rendered") +
          `<template>${view("", "Row")}</template>`
      ),
      page(
        `<include-content lazy-load=""></include-content>` +
          view(` is-active=""`, "Other") +
          `<template>${view("", "Rows")}</template>`
      )
    );
    expect(report.lazyViews).toBe(1);
    expect(report.different).toEqual([
      {
        path: "html > body > include-content > p",
        server: `"Rendered"`,
        browser: `"Other"`,
      },
      {
        path: "html > body > template > include-content > p",
        server: `"Row"`,
        browser: `"Rows"`,
      },
    ]);
    expect(report.counts).toEqual({ ...SAME, different: 2 });
  });

  it("5. leaves out what `allow` matches, tested against `<path>: server <server>, browser <browser>`", () => {
    const server = served(`<p>a</p>`, {
      head: `<link rel="canonical" href="https://a.test/">`,
    });
    const browser = page(`<p>b</p>`);
    const allow = [/^html > head: server <link rel="canonical"/, /^nowhere/];
    const report = compare(server, browser, { allow });
    expect(report.counts).toEqual({ ...SAME, different: 1 });
    expect(
      compare(server, browser, {
        allow: [/^html > body > p: server "a", browser "b"$/],
      }).counts
    ).toEqual({
      ...SAME,
      serverOnly: 1,
    });
  });
});

// A Chrome document recorded beside its prerendered page: `<name>.chrome.html`
// (`documentHtml()` on the cold page) and `<name>.prerendered.html`.
const RECORDED = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/chrome"
);
const recorded = (existsSync(RECORDED) ? readdirSync(RECORDED) : [])
  .filter((file) => file.endsWith(".chrome.html"))
  .map((file) => file.slice(0, -".chrome.html".length));

// What a recording differs in by design, per name: a prerender knows no
// viewport, so a browser alone sets the layout and what follows from it
const BY_DESIGN: Record<string, readonly RegExp[]> = {
  story: [
    // `data-layout` of a width query (`detect-media`)
    /^html > body: server nothing, browser \[data-layout="regular"\]$/,
    // `from-side` of a drawer, which follows `data-layout`
    / > content-drawer#bag-sheet: server nothing, browser \[from-side="right"\]$/,
  ],
};

describe("compareRender on recorded Chrome documents", () => {
  it.skipIf(!recorded.length)(
    recorded.length
      ? `matches each recorded Chrome document with its prerendered page, what is by design aside: ${recorded.join(", ")}`
      : "no Chrome document recorded in fixtures/chrome yet (<name>.chrome.html beside <name>.prerendered.html)",
    async () => {
      const { SERVER_EXCLUDED_TAGS } =
        await import("@excom/nucleus-kit/server");
      for (const name of recorded) {
        const read = (kind: string) =>
          readFileSync(join(RECORDED, `${name}.${kind}.html`), "utf8");
        const report = compare(read("prerendered"), read("chrome"), {
          clientOnly: SERVER_EXCLUDED_TAGS,
          allow: BY_DESIGN[name] ?? [],
        });
        // the differences, not their count, name what a failure found
        const { serverOnly, browserOnly, different } = report;
        expect({ name, serverOnly, browserOnly, different }).toEqual({
          name,
          serverOnly: [],
          browserOnly: [],
          different: [],
        });
      }
    }
  );
});

describe("compareColdRender", () => {
  const COLD = `<head><meta charset="utf-8"><title>Menu</title></head><body><main is-loading=""><p>Menu</p></main><div no-ssr=""><p is-loading="">Demo</p></div><p delaying-ready="">Menu</p></body>`;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    ["n-ssr", "lang"].forEach((name) =>
      document.documentElement.removeAttribute(name)
    );
  });

  /**
   * A browser page on the test's own document: `goto` loads `html`, which
   * stops loading after a while. Functions run from their source as in a page
   * (`fromSource`), or called, so that coverage sees them.
   */
  const fakePage = (html = COLD, { fromSource = false } = {}) => {
    const visited: string[] = [];
    return {
      visited,
      goto: async (url: string) => {
        visited.push(url);
        // a browser's document has the shell's doctype
        if (!document.doctype)
          document.prepend(
            document.implementation.createDocumentType("html", "", "")
          );
        document.documentElement.setAttribute("lang", "en");
        document.documentElement.innerHTML = html;
        setTimeout(
          () => document.querySelector("main")?.removeAttribute("is-loading"),
          100
        );
        // a state of the kit's, waited for whatever `loading` says
        setTimeout(
          () =>
            document
              .querySelector("[delaying-ready]")
              ?.removeAttribute("delaying-ready"),
          250
        );
      },
      run: async <A extends unknown[], T>(fn: (...args: A) => T, ...args: A) =>
        (await (fromSource
          ? (0, eval)(
              `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(", ")})`
            )
          : fn(...(JSON.parse(JSON.stringify(args)) as A)))) as Awaited<T>,
      cdp: async () => ({}),
    };
  };

  const serve = (html: string, status = 200) => {
    const fetch = vi.fn(async () => new Response(html, { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };

  const SERVED = `<main><p>Menus</p></main><div no-ssr=""></div><p>Menu</p>`;
  const ORIGINS = {
    served: "http://localhost:4173",
    cold: "http://localhost:4174",
  };

  it.each([
    ["called", false],
    ["run from their source, as in a page", true],
  ])(
    "compares the prerendered file with the page the browser renders from the shell, once nothing loads outside a no-ssr region: in-page functions %s",
    async (_, fromSource) => {
      const fetch = serve(served(SERVED));
      const browser = fakePage(COLD, { fromSource });
      const report = await compareColdRender(browser, "/menu?x=1", {
        ...ORIGINS,
        loading: "main[is-loading]",
      });
      expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
        "http://localhost:4173/menu?x=1"
      );
      expect(browser.visited).toEqual(["http://localhost:4174/menu?x=1"]);
      expect(report).toMatchObject({
        serverOnly: [],
        browserOnly: [],
        different: [
          {
            path: "html > body > main > p",
            server: `"Menus"`,
            browser: `"Menu"`,
          },
        ],
      });
    }
  );

  it("compares the 404 page the host answers a path no page has with", async () => {
    serve(served(SERVED), 404);
    const report = await compareColdRender(fakePage(), "/nowhere", ORIGINS);
    expect(report.counts).toEqual({ ...SAME, different: 1 });
  });

  it("refuses an answer that is no page, a page that is not prerendered, and a cold page that is", async () => {
    serve("Server error", 500);
    await expect(
      compareColdRender(fakePage(), "/menu", ORIGINS)
    ).rejects.toThrow("http://localhost:4173 answered /menu with 500");
    serve(page(SERVED));
    await expect(
      compareColdRender(fakePage(), "/menu", ORIGINS)
    ).rejects.toThrow(
      "http://localhost:4173 does not serve /menu prerendered (no <html n-ssr>)"
    );
    serve(served(SERVED));
    const prerendered = fakePage();
    prerendered.goto = async (url) => {
      prerendered.visited.push(url);
      document.documentElement.setAttribute("n-ssr", "");
      document.documentElement.innerHTML = "<head></head><body></body>";
    };
    await expect(
      compareColdRender(prerendered, "/menu", ORIGINS)
    ).rejects.toThrow(
      "http://localhost:4174 serves /menu prerendered, not the shell"
    );
  });

  it("gives up on a cold page still loading after 15 s", async () => {
    serve(served(SERVED));
    const browser = fakePage();
    browser.goto = async () => {
      document.documentElement.innerHTML = COLD;
    };
    // 10 s pass at each look at the clock
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 10_000));
    await expect(compareColdRender(browser, "/menu", ORIGINS)).rejects.toThrow(
      "the cold page is still loading after 15 s"
    );
  });
});
