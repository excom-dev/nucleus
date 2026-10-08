import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  readFileRelative,
  vi,
} from "@excom/nucleus-test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { KitRoute, KitRouter } from "@excom/kit-router";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "@excom/heft-rig/scripts/render-markdown.mjs";
import { NOT_FOUND } from "../prerender/prerender.config";
import {
  addLengths,
  buildAppFileLink,
  buildGitHubLink,
  copySource,
  didCompleteLink,
  displayName,
  docMetaUrl,
  docNeighbors,
  escapeRegexChars,
  fileNameOf,
  filterSearchResults,
  formatCode,
  formatTsType,
  getDemoId,
  getDemoSource,
  getDocHtml,
  getPackagesByType,
  highlightQuery,
  joinSelectors,
  mapPackageType,
  pickDefault,
  renderLang,
  renderLangCopy,
  renderPre,
  renderPreFormatted,
  resetDemo,
  searchResultHref,
  SITE_BASE,
  SITE_HOME,
  SITE_HOME_DOC,
  SITE_PACKAGE,
  siteDocHref,
  sumLengths,
  unescapeCssType,
  unescapeHtml,
  updateTemplate,
  upgradeTemplateCode,
  type DocsIndex,
  type PackageIndexEntry,
  type PackageMeta,
  type SearchCorpus,
} from "../../shell";

const entry = (
  shortName: string,
  packageType: string
): PackageIndexEntry => ({ shortName, packageType, version: "1.0.0" });

const packages: PackageIndexEntry[] = [
  entry("spa-route", "kit-element"),
  entry("quark", "library"),
  entry("fetchable-element", "element-base"),
  entry("quark-formatter", "tool"),
  entry("docs-site", "site"),
  entry("mystery", "other"),
];

const docsIndex: DocsIndex = {
  packages,
  docs: [{ name: "introduction", title: "Introduction" }],
};

const meta = {
  shortName: "quark",
  package: { name: "@excom/quark", version: "1.0.0" },
  demos: { basic: "<p>demo</p>" },
  readme: "<h1>Readme</h1>",
  docs: { introduction: "<h1>Intro</h1>" },
  elementApis: [],
  exportedFiles: {},
} as PackageMeta;

const corpus: SearchCorpus = {
  version: 1,
  docs: [
    {
      kind: "element",
      package: "spa-route",
      tag: "spa-route",
      title: "route-href",
      text: "Attribute route-href matches the current location",
    },
    {
      kind: "doc",
      package: "introduction",
      title: "Introduction",
      text: "Adapter State Orchestrator overview",
    },
    { kind: "package", package: "quark", text: "Quark stylesheet engine" },
  ],
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("catalog helpers", () => {
  it("fileNameOf returns the last path segment", () => {
    expect(fileNameOf("a/b/c.ts")).toBe("c.ts");
    expect(fileNameOf("plain")).toBe("plain");
  });

  it("getPackagesByType groups by excom packageType from either index shape", () => {
    expect(getPackagesByType(docsIndex, "tool")).toEqual([
      entry("quark-formatter", "tool"),
    ]);
    expect(getPackagesByType(packages, "library")).toEqual([
      entry("quark", "library"),
    ]);
    expect(getPackagesByType(docsIndex, "kit-element")).toHaveLength(1);
    expect(getPackagesByType(docsIndex, "element-base")).toHaveLength(1);
    expect(getPackagesByType(docsIndex, "unknown")).toEqual([]);
  });

  it("getPackagesByType tolerates missing / partial indexes", () => {
    expect(getPackagesByType(undefined as never, "tool")).toEqual([]);
    expect(getPackagesByType({} as DocsIndex, "tool")).toEqual([]);
    expect(
      getPackagesByType([null, entry("x", "tool")] as never, "tool")
    ).toEqual([entry("x", "tool")]);
  });

  it("displayName labels the libraries in prose and leaves every other package on its shortName", () => {
    expect(displayName("quark")).toBe("Quark");
    expect(displayName("nucleus-kit")).toBe("NucleusKit");
    expect(displayName("valence")).toBe("Valence.css");
    expect(displayName("neutron")).toBe("Neutron");
    expect(displayName("spa-route")).toBe("spa-route");
    expect(displayName("")).toBe("");
  });

  it("siteDocHref puts the home guide at the home route, every other guide under /docs", () => {
    // an empty base: the docs own the root, and the home is `/`, never ""
    expect(SITE_BASE).toBe("");
    expect(SITE_HOME).toBe("/");
    expect(siteDocHref(SITE_HOME_DOC)).toBe("/");
    expect(siteDocHref("quick_start")).toBe("/docs/quick_start");
  });

  /* `index.html`'s guides route excludes the home guide with a lookahead, which
     only works because `route-href` is compiled into a RegExp verbatim. */
  it("the guides route pattern keeps :name and drops the home guide", () => {
    const route = new KitRoute(
      `${SITE_BASE}/docs/(?!${SITE_HOME_DOC}$):name`,
      () => {}
    );
    expect(route.match(`${SITE_BASE}/docs/${SITE_HOME_DOC}`).match).toBeNull();
    expect(route.match("/docs/quick_start").params).toEqual({
      name: "quick_start",
    });
  });

  it("docMetaUrl reads the package meta for package routes, the site meta for guides", () => {
    expect(docMetaUrl("props", "quark")).toBe("/package-metas/quark.json");
    expect(docMetaUrl(undefined, "quark")).toBe("/package-metas/quark.json");
    expect(docMetaUrl("introduction")).toBe("/package-metas/docs-site.json");
    expect(docMetaUrl()).toBeNull();
  });

  it("docMetaUrl refuses the site package as a package route", () => {
    expect(docMetaUrl(undefined, SITE_PACKAGE)).toBeNull();
    expect(docMetaUrl("introduction", SITE_PACKAGE)).toBeNull();
    expect(docMetaUrl("core_concepts", "docs-site")).toBeNull();
  });

  it("getDocHtml picks the doc page or the readme", () => {
    expect(getDocHtml(meta, "introduction")).toBe("<h1>Intro</h1>");
    expect(getDocHtml(meta, "missing")).toBe("");
    expect(getDocHtml({ ...meta, docs: undefined }, "introduction")).toBe("");
    expect(getDocHtml(undefined, "introduction")).toBe("");
    expect(getDocHtml(meta)).toBe("<h1>Readme</h1>");
    expect(getDocHtml({ ...meta, readme: undefined })).toBe("");
    expect(getDocHtml(undefined)).toBe("");
  });

  it("docNeighbors walks the readme and the sections in order", () => {
    const paged: PackageMeta = {
      ...meta,
      shortName: "neutron",
      docSections: [
        { id: "a", title: "A", docs: [{ name: "props", title: "Props" }] },
        {
          id: "b",
          title: "B",
          docs: [
            { name: "effects", title: "Effects" },
            { name: "events", title: "Events" },
          ],
        },
      ],
    };
    expect(docNeighbors(paged)).toEqual({
      prev: null,
      next: { href: "/packages/neutron/props", title: "Props" },
    });
    expect(docNeighbors(paged, "effects")).toEqual({
      prev: { href: "/packages/neutron/props", title: "Props" },
      next: { href: "/packages/neutron/events", title: "Events" },
    });
    expect(docNeighbors(paged, "events").next).toBeNull();
    expect(docNeighbors(paged, "missing")).toEqual({ prev: null, next: null });
    expect(docNeighbors(meta, "props")).toEqual({ prev: null, next: null });
    expect(docNeighbors(undefined)).toEqual({ prev: null, next: null });
  });

  it("docNeighbors keeps the site's own guides inside /docs, with no overview page", () => {
    const guides = {
      ...meta,
      shortName: SITE_PACKAGE,
      package: {
        name: "@excom/docs-site",
        version: "1.0.0",
        excom: { packageType: "site" },
      },
      docSections: [
        {
          id: "getting-started",
          title: "Getting Started",
          docs: [
            { name: "introduction", title: "Introduction" },
            { name: "quick_start", title: "Quick Start" },
          ],
        },
        {
          id: "guides",
          title: "Guides",
          docs: [{ name: "styling", title: "Styling" }],
        },
      ],
    } as PackageMeta;

    // the first guide starts the walk: no `/packages/docs-site` overview
    expect(docNeighbors(guides, "introduction")).toEqual({
      prev: null,
      next: { href: "/docs/quick_start", title: "Quick Start" },
    });
    // the Introduction is the docs home route, so it is linked as the site base
    expect(docNeighbors(guides, "quick_start")).toEqual({
      prev: { href: "/", title: "Introduction" },
      next: { href: "/docs/styling", title: "Styling" },
    });
    expect(docNeighbors(guides, "styling").next).toBeNull();
    expect(docNeighbors(guides, "missing")).toEqual({ prev: null, next: null });
  });

  it("getDemoSource reads baked demo html", () => {
    expect(getDemoSource(meta, "basic")).toBe("<p>demo</p>");
    expect(getDemoSource(meta, "nope")).toBeUndefined();
    expect(getDemoSource(undefined as never, "basic")).toBeUndefined();
  });

  it("getDemoId / buildGitHubLink / buildAppFileLink build stable ids and urls", () => {
    expect(getDemoId("quark", "basic")).toBe("demo-quark-basic");
    expect(buildGitHubLink("quark", "basic")).toBe(
      "https://github.com/excom-dev/nucleus/tree/main/packages/quark/support/demos/basic.html"
    );
    expect(buildGitHubLink("quark")).toBe(
      "https://github.com/excom-dev/nucleus/tree/main/packages/quark/"
    );
    expect(buildAppFileLink("cells-app", "js")).toBe(
      "https://github.com/excom-dev/nucleus/tree/main/packages/docs-site/public/views/cells-app/cells-app.js"
    );
  });
});

describe("string helpers", () => {
  it("unescapeHtml / escapeRegexChars / unescapeCssType", () => {
    expect(unescapeHtml("&lt;a&gt; &amp; b")).toBe("<a> & b");
    expect(unescapeHtml()).toBe("");
    expect(unescapeHtml("")).toBe("");
    expect(escapeRegexChars("a.b*c(d)")).toBe("a\\.b\\*c\\(d\\)");
    expect(escapeRegexChars()).toBe("");
    expect(unescapeCssType("&lt;length&gt;")).toBe("<length>");
  });

  it("sumLengths / addLengths / joinSelectors / pickDefault", () => {
    expect(sumLengths([1, 2], null, undefined, [3])).toBe(3);
    expect(addLengths([1], [2, 3])).toBe("(3)");
    expect(joinSelectors(["a", "b"])).toBe("a, b");
    expect(joinSelectors()).toBe("");
    expect(pickDefault({ type: "boolean" })).toBe("false");
    expect(pickDefault({ type: "string", default: "'x'" })).toBe("'x'");
    expect(pickDefault({ type: "string" })).toBe("null");
  });

  it("formatTsType expands object shapes and substitutes {tag}", () => {
    expect(formatTsType("{tag}Event", "spa-route")).toBe("spa-routeEvent");
    expect(formatTsType("{ type: string; detail: { id: number } }", "x")).toBe(
      "{\n  type: string;\n  detail: {\n    id: number\n  }\n}"
    );
    expect(formatTsType("{ a: string; }", "x")).toBe("{\n  a: string;\n}");
  });
});

describe("formatCode", () => {
  it("re-indents html and keeps quark-sheet bodies one level past the open tag", () => {
    const src = [
      "<div>",
      "<quark-sheet>",
      "      p { color: red; }",
      "",
      "          span { color: blue; }",
      "</quark-sheet>",
      "<p>hi</p>",
      "</div>",
      "\n\n",
    ].join("\n");
    expect(formatCode(src)).toBe(
      [
        "<div>",
        "    <quark-sheet>",
        "        p { color: red; }",
        "",
        "            span { color: blue; }",
        "    </quark-sheet>",
        "    <p>hi</p>",
        "</div>",
      ].join("\n")
    );
  });

  it("leaves empty and single-line sheets untouched", () => {
    const empty = "<div>\n<quark-sheet>\n\n</quark-sheet>\n</div>";
    expect(formatCode(empty)).toContain("<quark-sheet>\n\n</quark-sheet>");
    const inline = "<div>\n<quark-sheet>p { color: red; }</quark-sheet>\n</div>";
    expect(formatCode(inline)).toContain(
      "<quark-sheet>p { color: red; }</quark-sheet>"
    );
  });
});

describe("renderLang / renderPre", () => {
  it("returns empty for empty input and highlights known + raw shiki languages", () => {
    expect(renderLang("", "html")).toBe("");
    expect(renderLang("<p>hi</p>", "html")).toContain('class="shiki');
    expect(renderLang("const a = 1;", "js")).toContain("shiki");
    expect(renderLang("<my-el></my-el>", "html-custom-elements")).toContain(
      "shiki"
    );
    expect(renderLang("p { color: red; }", "quark")).toContain("shiki");
  });

  it("normalizes CRLF and keeps empty lines with a ZWSP", () => {
    const out = renderLang("a\r\n\r\nb\rc", "html");
    expect(out).toContain("​");
    expect((out.match(/class="line"/g) ?? []).length).toBe(4);
    expect(out).not.toContain("bind-copy-button");
  });

  it("appends a copy button when asked", () => {
    expect(renderLang("x", "text", { includeCopyButton: true })).toContain(
      "<div bind-copy-button></div>"
    );
    expect(renderLangCopy("x", "text")).toContain("bind-copy-button");
  });

  it("renderPre re-renders the overlay from the target value / innerHTML", () => {
    document.body.innerHTML = `
      <div class="code-editor" data-language="css">
        <textarea>p { color: red; }</textarea>
        <div data-highlight></div>
      </div>`;
    const textarea = document.querySelector("textarea")!;
    const overlay = document.querySelector("[data-highlight]")!;
    renderPre({ target: textarea });
    expect(overlay.innerHTML).toContain("shiki");
    expect(overlay.innerHTML).toContain("color");

    // custom event carrying the target in `detail`, html default language
    document.body.innerHTML = `
      <div>
        <div bind-source>&lt;p&gt;hi&lt;/p&gt;</div>
        <div data-highlight></div>
      </div>`;
    const source = document.querySelector("[bind-source]")!;
    const overlay2 = document.querySelector("[data-highlight]")!;
    renderPreFormatted({ target: source, detail: { target: source } });
    expect(overlay2.innerHTML).toContain("shiki");
    expect(overlay2.innerHTML).toContain("hi");
  });

  it("renderPre keeps an overlay that shows the same code already (a prerendered page)", () => {
    document.body.innerHTML = `
      <div data-language="css">
        <textarea>p { color: red; }</textarea>
        <div data-highlight></div>
      </div>`;
    const textarea = document.querySelector("textarea")!;
    const overlay = document.querySelector("[data-highlight]")!;
    renderPre({ target: textarea });
    const pre = overlay.firstElementChild;
    renderPre({ target: textarea });
    expect(overlay.firstElementChild).toBe(pre);
    textarea.value = "p { color: blue; }";
    renderPre({ target: textarea });
    expect(overlay.firstElementChild).not.toBe(pre);
    expect(overlay.textContent).toBe("p { color: blue; }");
  });
});

describe("editor helpers", () => {
  it("updateTemplate writes the editor value into the preview template", () => {
    document.body.innerHTML = `
      <div class="live-demo">
        <div aria-label="preview"><template></template></div>
        <textarea>&lt;b&gt;x&lt;/b&gt;</textarea>
      </div>`;
    const textarea = document.querySelector("textarea")!;
    const template = document.querySelector("template")!;
    updateTemplate.call(textarea, { target: textarea });
    expect(template.innerHTML).toBe("<b>x</b>");
  });

  it("resetDemo restores the textarea and fires input", () => {
    document.body.innerHTML = `
      <div class="live-demo"><textarea>edited</textarea></div>`;
    const textarea = document.querySelector("textarea")!;
    const onInput = vi.fn();
    textarea.addEventListener("input", onInput);
    resetDemo("<p>orig</p>")({ target: textarea });
    expect(textarea.value).toBe("<p>orig</p>");
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it("copySource copies textarea value, shiki text, or element html", () => {
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    document.body.innerHTML = `
      <textarea>value text</textarea>
      <pre class="shiki"><span>code</span> text</pre>
      <div id="raw"><i>html</i></div>`;
    copySource({ target: document.querySelector("textarea") });
    expect(write).toHaveBeenLastCalledWith("value text");
    copySource({ target: document.querySelector("pre") });
    expect(write).toHaveBeenLastCalledWith("code text");
    copySource({ target: document.querySelector("#raw") });
    expect(write).toHaveBeenLastCalledWith("<i>html</i>");
    copySource({ target: { innerHTML: "plain" } });
    expect(write).toHaveBeenLastCalledWith("plain");
  });

  it("upgradeTemplateCode highlights template content with a copy button", () => {
    document.body.innerHTML = `
      <div data-language="js"><template>const a = 1;</template></div>
      <div id="empty"><template></template></div>
      <div id="nolang"><template>plain</template></div>`;
    const [withLang, empty, noLang] = document.querySelectorAll("div");
    upgradeTemplateCode({ target: withLang });
    expect(withLang.querySelector("template")!.innerHTML).toContain(
      "bind-copy-button"
    );
    upgradeTemplateCode({ target: empty });
    expect(empty.querySelector("template")!.innerHTML).toBe("");
    upgradeTemplateCode({ target: noLang });
    expect(noLang.querySelector("template")!.innerHTML).toContain("shiki");
    expect(noLang.querySelector("template")!.innerHTML).toContain("plain");
  });

  it("upgradeTemplateCode leaves a highlighted template alone (a prerendered page)", () => {
    document.body.innerHTML = `
      <div data-language="js"><template>const a = 1;</template></div>`;
    const host = document.querySelector("div")!;
    upgradeTemplateCode({ target: host });
    const highlighted = host.querySelector("template")!.innerHTML;
    upgradeTemplateCode({ target: host });
    expect(host.querySelector("template")!.innerHTML).toBe(highlighted);
  });
});

describe("didCompleteLink", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** A `spa-a` under a `spa-manager` stand-in whose router reports `past`. */
  const linkIn = (href: string, past?: Array<{ url: string }>) => {
    const manager = document.createElement("spa-manager") as HTMLElement & {
      router?: { previousStates: Array<{ url: string }> };
    };
    if (past) manager.router = { previousStates: past };
    manager.innerHTML = `<ul><li><spa-a route-href="${href}"></spa-a></li></ul>`;
    document.body.append(manager);
    return manager.querySelector("spa-a")!;
  };

  it("is true when the link's route is a state before the active one", () => {
    const past = [{ url: "/" }, { url: "/docs/quick_start" }];
    expect(didCompleteLink(linkIn("/docs/quick_start", past))).toBe(
      true
    );
  });

  it("is false for an unvisited route or one only reachable forward", () => {
    const past = [{ url: "/" }];
    expect(didCompleteLink(linkIn("/docs/styling", past))).toBe(false);
    expect(didCompleteLink(linkIn("/docs/styling", []))).toBe(false);
  });

  it("is false outside a spa-manager or before it has a router", () => {
    document.body.innerHTML = `<spa-a route-href="/"></spa-a>`;
    expect(didCompleteLink(document.querySelector("spa-a")!)).toBe(false);
    expect(didCompleteLink(linkIn("/"))).toBe(false);
  });
});

describe("search", () => {
  it("filterSearchResults returns nothing for short / empty queries or unknown corpus versions", () => {
    expect(filterSearchResults(corpus, "")).toEqual([]);
    expect(filterSearchResults(corpus, "  ")).toEqual([]);
    expect(filterSearchResults(corpus, "ro")).toEqual([]);
    expect(filterSearchResults(corpus, undefined as never)).toEqual([]);
    expect(filterSearchResults({ ...corpus, version: 2 }, "route")).toEqual(
      []
    );
  });

  it("filterSearchResults ranks docs and inverts matches by field", () => {
    const results = filterSearchResults(corpus, "route");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].package).toBe("spa-route");
    expect(results[0].id).toBe(0);
    // hyphenated tokens are not split, so "route" prefix-matches "route-href"
    expect(results[0].matches).toEqual({
      title: ["route-href"],
      text: ["route-href"],
    });
    expect(filterSearchResults(corpus, "spa")[0].matches).toEqual({
      package: ["spa-route"],
    });
    // index is cached per corpus docs array
    const quark = filterSearchResults(corpus, "quark");
    expect(quark[0].package).toBe("quark");
    expect(quark[0].matches).toEqual({ package: ["quark"], text: ["quark"] });
    expect(filterSearchResults(corpus, "zzzz-no-match")).toEqual([]);
  });


  it("searchResultHref routes docs, doc pages and packages", () => {
    // the home guide has no `/docs/…` url
    expect(searchResultHref({ kind: "doc", package: SITE_HOME_DOC })).toBe(
      "/"
    );
    expect(searchResultHref({ kind: "doc", package: "styling" })).toBe(
      "/docs/styling"
    );
    expect(searchResultHref({ kind: "element", package: "spa-route" })).toBe(
      "/packages/spa-route"
    );
    expect(
      searchResultHref({ kind: "page", package: "neutron", doc: "props" })
    ).toBe("/packages/neutron/props");
    expect(searchResultHref({ kind: "page", package: "neutron" })).toBe(
      "/packages/neutron"
    );
  });

  it("searchResultHref sends site-package pages under /docs, home page to the home route", () => {
    expect(
      searchResultHref({
        kind: "page",
        package: SITE_PACKAGE,
        doc: "core_concepts",
      })
    ).toBe("/docs/core_concepts");
    expect(
      searchResultHref({
        kind: "page",
        package: SITE_PACKAGE,
        doc: SITE_HOME_DOC,
      })
    ).toBe("/");
  });

  it("mapPackageType labels results by kind and package type", () => {
    expect(mapPackageType(docsIndex, "doc", "introduction")).toBe("Overview");
    expect(mapPackageType(docsIndex, "package", "quark")).toBe("Packages");
    expect(mapPackageType(docsIndex, "element", "spa-route")).toBe("Elements");
    expect(mapPackageType(docsIndex, "element", "quark")).toBe("Libraries");
    expect(mapPackageType(docsIndex, "element", "fetchable-element")).toBe(
      "Element Bases"
    );
    expect(mapPackageType(packages, "element", "quark-formatter")).toBe(
      "Tools"
    );
    expect(mapPackageType(docsIndex, "element", "mystery")).toBe("other");
    expect(mapPackageType(docsIndex, "element", "missing")).toBe("");
  });

  it("highlightQuery escapes, clips and marks exact vs fuzzy matches", () => {
    expect(highlightQuery("", ["a"], "a")).toBe("");
    expect(highlightQuery("<b> & c", undefined, "")).toBe("&lt;b&gt; &amp; c");
    expect(highlightQuery("a <b>", undefined, undefined as never)).toBe(
      "a &lt;b&gt;"
    );
    expect(highlightQuery("Route href", ["route"], "route")).toBe(
      "<mark>Route</mark> href"
    );
    expect(highlightQuery("Route href", undefined, " href ")).toBe(
      "Route <mark>href</mark>"
    );
    expect(highlightQuery("routing table", ["routing"], "route")).toBe(
      "<mark class='fuzzy-match'>routing</mark> table"
    );
    expect(highlightQuery("nothing here", ["zzz"], "zzz")).toBe(
      "nothing here"
    );
    expect(highlightQuery("a <b> c", ["<b>"], "<b>")).toBe(
      "a <mark>&lt;b&gt;</mark> c"
    );
    const long = `${"x".repeat(60)} target ${"y".repeat(10)}`;
    // clipped to 40 chars before the earliest match, ellipsis prefixed
    expect(highlightQuery(long, ["target", "yyyy"], "target")).toBe(
      `…${"x".repeat(39)} <mark>target</mark> <mark class='fuzzy-match'>yyyy</mark><mark class='fuzzy-match'>yyyy</mark>yy`
    );
  });
});

/** One `<spa-route>` of the shell's table, in document order. */
type SiteRoute = {
  key: string | RegExp;
  isFallback: boolean;
  templateRef: string | null;
  flavour: string;
  docName: string | null;
  documentTitle: string | null;
};

const siteRoutes = (): SiteRoute[] => {
  // `<link>`s are dropped: happy-dom would try to fetch them while parsing.
  const shell = readFileRelative(import.meta.url, "../../index.html").replace(
    /<link[\s\S]*?>/g,
    ""
  );
  const doc = new DOMParser().parseFromString(shell, "text/html");
  return [...doc.querySelectorAll("spa-manager > spa-route")].map((el) => {
    const regex = el.getAttribute("route-regex");
    return {
      key: regex ? new RegExp(regex) : el.getAttribute("route-href")!,
      isFallback: el.hasAttribute("is-fallback"),
      templateRef: el.getAttribute("template-ref"),
      flavour: el.getAttribute("class") ?? "",
      docName: el.getAttribute("data-doc-name"),
      documentTitle: el.getAttribute("document-title"),
    };
  });
};

const matches = (route: SiteRoute, pathname: string) =>
  new KitRoute(route.key, () => {}).match(pathname);

/** `spa-manager` semantics: first match in document order, `is-fallback` last. */
const activate = (routes: SiteRoute[], pathname: string) => {
  const hit = routes.find((r) => !r.isFallback && matches(r, pathname).match);
  return hit
    ? { route: hit, params: matches(hit, pathname).params }
    : { route: routes.find((r) => r.isFallback)!, params: null };
};

describe("site route table", () => {
  const routes = siteRoutes();

  it("opens with the docs home and closes with the 404", () => {
    expect(routes[0]).toMatchObject({
      key: SITE_HOME,
      docName: SITE_HOME_DOC,
      templateRef: "/views/package/package.html",
      isFallback: false,
    });
    expect(routes.filter((r) => r.isFallback)).toHaveLength(1);
    expect(routes.at(-1)!.isFallback).toBe(true);
  });

  it("every route is a docs page: none runs without the docs chrome", () => {
    expect(routes.map((r) => r.flavour).filter(Boolean)).toEqual([]);
    expect(routes.every((r) => r.templateRef?.startsWith("/views/"))).toBe(true);
    expect(new Set(routes.map((r) => String(r.key))).size).toBe(routes.length);
  });

  /* Markup titles the pages whose names are no data: each example, the 404.
     The shell sheet titles guides and package pages; the docs home keeps
     `index.html`'s own `<title>`. */
  it("titles each example and the 404 in markup", () => {
    const shell = readFileRelative(import.meta.url, "../../index.html");
    expect(shell).toContain("<title>Nucleus · docs</title>");
    const titled = routes.filter((r) => r.documentTitle);
    expect(titled.map((r) => r.key)).toEqual([
      ...routes
        .map((r) => r.key)
        .filter((key) => String(key).startsWith(`${SITE_BASE}/examples/`)),
      /.*/,
    ]);
    for (const { documentTitle } of titled) {
      expect(documentTitle).toMatch(/^[A-Z][\w ]+ · Nucleus · docs$/);
    }
    expect(activate(routes, SITE_HOME).route.documentTitle).toBeNull();
  });

  it("renders the not-found page from a path only the fallback matches", () => {
    expect(activate(routes, NOT_FOUND).route.isFallback).toBe(true);
  });

  it("/ activates the Introduction guide and nothing else", () => {
    expect(routes.filter((r) => !r.isFallback && matches(r, "/").match)).toEqual(
      [routes[0]]
    );
    expect(activate(routes, "/").route).toMatchObject({
      docName: SITE_HOME_DOC,
      templateRef: "/views/package/package.html",
      flavour: "",
    });
  });

  /* The paths of the old address (`/nucleus…`) are no pages here. */
  it("the pre-move urls and the excluded home guide fall through to the 404", () => {
    for (const path of [
      "/nucleus",
      "/nucleus/docs/quick_start",
      "/nucleus/examples/todos",
      "/nucleus/packages/neutron",
      "/nucleus/packages/neutron/props",
      `${SITE_BASE}/docs/${SITE_HOME_DOC}`,
    ]) {
      expect(activate(routes, path).route.isFallback).toBe(true);
    }
  });

  it("package and example urls resolve under the base", () => {
    expect(activate(routes, `${SITE_BASE}/packages/neutron`).params).toEqual({
      packageName: "neutron",
    });
    expect(
      activate(routes, `${SITE_BASE}/packages/neutron/props`).params
    ).toEqual({ packageName: "neutron", docName: "props" });
    expect(activate(routes, `${SITE_BASE}/docs/quick_start`).params).toEqual({
      name: "quick_start",
    });
    expect(
      activate(routes, `${SITE_BASE}/examples/todos`).route.templateRef
    ).toBe("/views/live-app/live-app.html");
  });
});

/* An example is a route (the playground, told which app and which files),
   a sidebar entry, a view folder and an intro. */
describe("examples", () => {
  const shell = readFileRelative(import.meta.url, "../../index.html").replace(
    /<link[\s\S]*?>/g,
    ""
  );
  const doc = new DOMParser().parseFromString(shell, "text/html");
  const views = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../public/views"
  );
  const isExample = (el: Element) =>
    el.getAttribute("route-href")?.startsWith("/examples/");
  const examples = [...doc.querySelectorAll("spa-manager > spa-route")]
    .filter(isExample)
    .map((route) => ({
      href: route.getAttribute("route-href"),
      app: route.getAttribute("data-app")!,
      files: route.getAttribute("data-files")!,
      title: route.getAttribute("document-title"),
    }));
  /** The seven 7GUIs tasks, by task number. */
  const SEVEN_GUIS = [
    "counter-app",
    "temperature-app",
    "flight-booker-app",
    "timer-app",
    "crud-app",
    "circle-drawer-app",
    "cells-app",
  ];

  it("routes each example to the playground, in the sidebar's order", () => {
    expect(examples).toEqual([
      { href: "/examples/todos", app: "todo-app", files: "html quark css", title: "Todo App · Nucleus · docs" },
      { href: "/examples/counter", app: "counter-app", files: "html quark", title: "Counter · Nucleus · docs" },
      { href: "/examples/temperature", app: "temperature-app", files: "html quark css", title: "Temperature Converter · Nucleus · docs" },
      { href: "/examples/flight-booker", app: "flight-booker-app", files: "html quark css", title: "Flight Booker · Nucleus · docs" },
      { href: "/examples/timer", app: "timer-app", files: "html quark css", title: "Timer · Nucleus · docs" },
      { href: "/examples/crud", app: "crud-app", files: "html quark css", title: "CRUD · Nucleus · docs" },
      { href: "/examples/circle-drawer", app: "circle-drawer-app", files: "html quark js css", title: "Circle Drawer · Nucleus · docs" },
      { href: "/examples/cells", app: "cells-app", files: "html quark js css", title: "Cells · Nucleus · docs" },
      { href: "/examples/returns", app: "returns-app", files: "html quark css", title: "Furniture Returns · Nucleus · docs" },
      { href: "/examples/view-transitions", app: "view-transitions-app", files: "html quark css", title: "View Transitions · Nucleus · docs" },
    ]);
    expect(
      [
        ...doc
          .querySelector<HTMLTemplateElement>("#template-site-nav")!
          .content.querySelectorAll("spa-a"),
      ]
        .filter(isExample)
        .map((link) => [
          link.getAttribute("route-href"),
          link.textContent!.replace(/\s+/g, " ").trim(),
        ])
    ).toEqual(
      examples.map(({ href, title }) => [
        href,
        title!.replace(" · Nucleus · docs", ""),
      ])
    );
  });

  it("ends the sidebar's examples with a link out to the Wrenfield demo app", () => {
    const nav = doc.querySelector<HTMLTemplateElement>("#template-site-nav")!.content;
    const items = [...nav.querySelector('summary[title="Examples"]')!.parentElement!.querySelectorAll("li")];
    const link = items[items.length - 1].querySelector("a")!;
    expect(link.textContent).toBe("Wrenfield");
    expect(link.getAttribute("href")).toBe("https://wrenfield.excom.dev");
    expect([link.target, link.rel]).toEqual(["_blank", "noopener"]);
    expect(items).toHaveLength(examples.length + 1);
  });

  it("every example has the files its route lists, and an intro", () => {
    const missing = examples.flatMap(({ app, files }) =>
      [
        ...files.split(" ").map((ext) => `${app}/${app}.${ext}`),
        `demo-headers/${app}.html`,
      ].filter((file) => !existsSync(resolve(views, file)))
    );
    expect(missing).toEqual([]);
  });

  it("the seven 7GUIs intros end with the same line, numbered by task", () => {
    const lastLines = SEVEN_GUIS.map((app) => {
      const file = resolve(views, `demo-headers/${app}.html`);
      if (!existsSync(file)) return `${app}: no intro`;
      const intro = new DOMParser().parseFromString(
        readFileSync(file, "utf8"),
        "text/html"
      );
      return intro.querySelector("hgroup")?.lastElementChild?.outerHTML;
    });
    expect(lastLines).toEqual(
      SEVEN_GUIS.map(
        (_app, i) =>
          `<p>Task ${i + 1} of <a href="https://eugenkiss.github.io/7guis/tasks" target="_blank" rel="noopener">7GUIs</a>, a GUI programming benchmark.</p>`
      )
    );
    expect(examples.map(({ app }) => app)).toEqual(
      expect.arrayContaining(SEVEN_GUIS)
    );
  });
});

describe("docs home route", () => {
  let router: KitRouter;

  beforeEach(() => {
    history.replaceState(null, "", `${SITE_BASE}/docs/quick_start`);
  });

  afterEach(() => {
    router?.destroy();
    sessionStorage.removeItem("__kit_router_history__");
    history.replaceState(null, "", "/");
  });

  /* The base is empty: its home is `/`, a path the router keeps as it is. */
  it("`/` lands on the docs home, from another page", () => {
    router = new KitRouter();
    const home = vi.fn();
    for (const route of siteRoutes()) {
      router.on(
        new KitRoute(route.key, route.docName === SITE_HOME_DOC ? home : () => {})
      );
    }
    home.mockClear();

    router.pushState({ url: SITE_HOME });

    expect(location.pathname).toBe(SITE_HOME);
    expect(home).toHaveBeenCalledTimes(1);
    expect(home.mock.lastCall![0].match).not.toBeNull();
  });
});

describe("site guides", () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../docs");
  const guides = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "INTERNAL.md")
    .map((file) => ({ file, md: readFileSync(resolve(dir, file), "utf8") }));
  const names = new Set(
    guides.map(({ file }) => file.slice(0, -3).toLowerCase())
  );

  it("link only to guides that exist", () => {
    const broken = guides.flatMap(({ file, md }) =>
      [...md.matchAll(/\]\(\/docs\/(\w+)/g)]
        .filter(([, name]) => !names.has(name))
        .map(([, name]) => `${file} → ${name}`)
    );
    expect(broken).toEqual([]);
  });

  /* `package.quark` / `package.css` style these two lists as `+ ul` cards. */
  it("render Start here / Next steps as a bullet list of spa links", () => {
    const lists = guides.flatMap(({ file, md }) => {
      const doc = new DOMParser().parseFromString(
        renderMarkdown(md),
        "text/html"
      );
      return [...doc.querySelectorAll("#md-start-here, #md-next-steps")].map(
        (h) => ({ file, list: h.nextElementSibling })
      );
    });
    expect(lists.map(({ file }) => file)).toContain("INTRODUCTION.md");
    expect(lists.length).toBeGreaterThan(1);
    for (const { file, list } of lists) {
      expect(list?.tagName, file).toBe("UL");
      expect(
        list!.querySelectorAll("spa-a[route-href]").length,
        file
      ).toBeGreaterThan(0);
    }
  });
});

describe("shiki grammar imports", () => {
  // `@use "/shell"` is a native `import()` in the browser, so the highlighter's
  // grammar imports must be something Vite dev can rewrite. es-module-lexer
  // does not recognise a `with { type: "json", }` clause (trailing comma) as
  // import attributes, Vite then leaves the clause in place while serving the
  // JSON as a JS module, and the browser rejects the MIME type.
  it("carry import attributes es-module-lexer can strip", () => {
    const entry = createRequire(import.meta.url).resolve(
      "@excom/nucleus-quark-highlighter/shiki"
    );
    const source = readFileSync(entry, "utf8");
    const clauses =
      source.match(/\bfrom\s+"[^"]+"\s+with\s*\{[^}]*\}/g) ?? [];
    expect(clauses.length).toBeGreaterThan(0);
    for (const clause of clauses) {
      expect(clause).not.toMatch(/,\s*\}$/);
    }
  });
});

describe("inline sheets", () => {
  // An inline `<quark-sheet>` is ordinary HTML content: a browser reads `<`
  // followed by a letter, `/`, `!` or `?` as markup, even inside a sheet
  // comment, and a title or textarea tag then swallows the rest of the page.
  // happy-dom parses those differently, so no view test sees it.
  it("hold no text a browser would parse as markup", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const pages = [
      "index.html",
      "sandbox.html",
      ...readdirSync(resolve(root, "public"), { recursive: true })
        .map((file) => `public/${file}`)
        .filter((file) => file.endsWith(".html")),
    ];
    const hazards = pages.flatMap((page) => {
      const html = readFileSync(resolve(root, page), "utf8");
      return [
        ...html.matchAll(/<quark-sheet\b[^>]*>([\s\S]*?)<\/quark-sheet>/g),
      ]
        .flatMap(([, sheet]) => sheet!.match(/<[a-zA-Z/!?][^\n]{0,40}/g) ?? [])
        .map((text) => `${page}: ${text}`);
    });
    expect(pages.length).toBeGreaterThan(2);
    expect(hazards).toEqual([]);
  });
});
