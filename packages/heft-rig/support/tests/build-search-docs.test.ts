import { describe, expect, it } from "vitest";
import {
  MEMBER_TEXT_MAX,
  PACKAGE_TEXT_MAX,
  buildSearchDocs,
  capText,
  packageReadmeText,
  stripHtml,
  stripStopwords,
  titleCaseKey,
  titleFromDocHtml,
} from "../../scripts/build-search-docs.mjs";

describe("text helpers", () => {
  it("stripHtml removes tags, scripts and decodes entities", () => {
    expect(stripHtml(undefined)).toBe("");
    expect(
      stripHtml(
        '<p>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;&nbsp;f &hellip; &mdash; &ndash; &#65; &#x42; &zzz;</p><script>x()</script><style>p{}</style>',
      ),
    ).toBe("a & b <c> \"d\" 'e' f … — – A B &zzz;");
  });

  it("stripStopwords drops filler and punctuation-only tokens", () => {
    expect(stripStopwords("")).toBe("");
    expect(stripStopwords("The quick, brown fox is on a log — and it jumps!")).toBe(
      "quick, brown fox log jumps!",
    );
  });

  it("titleFromDocHtml / titleCaseKey", () => {
    expect(titleFromDocHtml("")).toBe("");
    expect(titleFromDocHtml("<p>x</p>")).toBe("");
    expect(titleFromDocHtml('<h1 id="a">Quick <em>Start</em></h1>')).toBe("Quick Start");
    expect(titleCaseKey("quick_start-guide")).toBe("Quick Start Guide");
    expect(titleCaseKey(undefined)).toBe("");
  });

  it("capText cuts at a word boundary when one is late enough", () => {
    expect(capText(undefined, 10)).toBe("");
    expect(capText("short", 10)).toBe("short");
    expect(capText("aaaaaaaa bbbbbbbb cccccccc", 20)).toBe("aaaaaaaa bbbbbbbb");
    expect(capText("aaaaaaaaaaaaaaaaaaaaaaa b", 20)).toBe("aaaaaaaaaaaaaaaaaaaa");
    expect(capText("a bbbbbbbbbbbbbbbbbbbbbbbbb", 20)).toBe("a bbbbbbbbbbbbbbbbbb");
  });
});

describe("packageReadmeText", () => {
  it("returns intro + Features + example titles without include islands", () => {
    const html = `
      <h1 id="md-x">Data table</h1>
      <p>Intro paragraph.</p>
      <include-content data-demo="a"><template>DROP</template></include-content>
      <include-content data-language="html"/>
      <h2>Features</h2><ul><li>Fast</li><li>Small</li></ul>
      <h2>Other</h2><p>skip</p>
      <h3>Examples</h3><h4>Basic <code>use</code></h4><p>x</p><h4>Sorting</h4>
      <h2>Tail</h2>`;
    expect(packageReadmeText(html)).toBe("Intro paragraph. Features Fast Small Basic use Sorting");
    expect(packageReadmeText("")).toBe("");
    expect(packageReadmeText("<p>no headings</p>")).toBe("");
  });
});

describe("buildSearchDocs", () => {
  it("emits doc entries for site packages", () => {
    const out = buildSearchDocs([
      {
        shortName: "docs-site",
        package: { excom: { packageType: "site" } },
        docs: {
          quick_start: "<h1>Quick Start</h1><p>Get going with the stack.</p>",
          no_title: "<p>Untitled body</p>",
        },
      },
      { shortName: "no-docs", package: { excom: { packageType: "site" } } },
    ]);
    expect(out).toEqual({
      version: 1,
      docs: [
        { kind: "doc", package: "quick_start", title: "Quick Start", text: "Quick Start Get going stack." },
        { kind: "doc", package: "no_title", title: "No Title", text: "Untitled body" },
      ],
    });
  });

  it("never routes the site package as a package or a package doc page", () => {
    const out = buildSearchDocs([
      {
        shortName: "docs-site",
        package: { excom: { packageType: "site" } },
        readme: "<h1>docs-site</h1><p>Site readme.</p>",
        docSections: [
          { id: "getting-started", title: "Getting Started", docs: [{ name: "core_concepts", title: "Core Concepts" }] },
        ],
        docs: { core_concepts: "<h1>Core Concepts</h1><p>Elements.</p>" },
        elementApis: [{ tag: "some-el", summary: "<p>Nope.</p>" }],
      },
    ]);
    expect(out.docs.every((d: any) => d.kind === "doc")).toBe(true);
    expect(out.docs.some((d: any) => d.package === "docs-site")).toBe(false);
    expect(out.docs.map((d: any) => d.package)).toEqual(["core_concepts"]);
  });

  it("emits package, element and member docs with slimming rules", () => {
    const long = "word ".repeat(200);
    const out = buildSearchDocs([
      {
        shortName: "data-table",
        package: { description: "fallback" },
        readme: `<h1>Data table</h1><p>${long}</p>`,
        elementApis: [
          {
            tag: "data-table",
            summary: "<p>The table.</p>",
            attributes: [
              { name: "rows", description: "<code>Rows</code> of the table", type: "number" },
              { name: "inh", inheritedFrom: "@excom/x" },
            ],
            cssAliases: [
              { name: ":--data-table", kind: "element" },
              { name: ":--data-table--on", kind: "state" },
              { name: ":--data-table-doc", kind: "element", description: "Documented" },
            ],
            cssProperties: [{ name: "--gap", syntax: "<length>", default: "4px" }],
          },
          { tag: "data-th", summary: "Header cell.", slots: [{ name: "x" }] },
          { summary: "Tagless summary." },
        ],
      },
      { shortName: "bare", package: { description: "Bare package for the win." } },
      { shortName: "nothing" },
    ]);
    const docs = out.docs;
    const pkg = docs.find((d: any) => d.kind === "package" && d.package === "data-table")!;
    expect(pkg.title).toBeUndefined();
    expect(pkg.tag).toBeUndefined();
    expect(pkg.text.length).toBeLessThanOrEqual(PACKAGE_TEXT_MAX);
    expect(pkg.text.startsWith("word word")).toBe(true);

    expect(docs.find((d: any) => d.kind === "element" && d.title === "data-table")).toBeUndefined();
    expect(docs.find((d: any) => d.kind === "element")).toEqual({
      kind: "element",
      package: "data-table",
      tag: "data-th",
      title: "data-th",
      text: "Header cell.",
    });

    expect(docs.find((d: any) => d.kind === "attribute")).toEqual({
      kind: "attribute",
      package: "data-table",
      title: "rows",
      text: "Rows table number",
    });
    expect(docs.filter((d: any) => d.kind === "attribute")).toHaveLength(1);
    expect(docs.filter((d: any) => d.kind === "css-alias").map((d: any) => d.title)).toEqual([
      ":--data-table--on",
      ":--data-table-doc",
    ]);
    expect(docs.find((d: any) => d.kind === "css-property").text).toBe("<length> 4px");
    expect(docs.find((d: any) => d.kind === "slot")).toEqual({
      kind: "slot",
      package: "data-table",
      tag: "data-th",
      title: "x",
    });

    expect(docs.find((d: any) => d.package === "bare")).toEqual({
      kind: "package",
      package: "bare",
      text: "Bare package win.",
    });
    expect(docs.find((d: any) => d.package === "nothing")).toEqual({
      kind: "package",
      package: "nothing",
    });
  });

  it("folds same-named element summaries into the package blurb and caps members", () => {
    const out = buildSearchDocs([
      {
        shortName: "p",
        elementApis: [
          { tag: "p", summary: "Folded summary." },
          { tag: "q", events: [{ name: "e", description: "x ".repeat(300) }] },
        ],
      },
    ]);
    expect(out.docs.find((d: any) => d.kind === "package")).toEqual({
      kind: "package",
      package: "p",
      text: "Folded summary.",
    });
    const ev = out.docs.find((d: any) => d.kind === "event")!;
    expect(ev.text.length).toBeLessThanOrEqual(MEMBER_TEXT_MAX);
  });

  it("emits a page entry per package doc page, never for the readme", () => {
    const out = buildSearchDocs([
      {
        shortName: "neutron",
        readme: "<h1>neutron</h1><p>Factory.</p>",
        docs: {
          readme: "<h1>neutron</h1><p>Factory.</p>",
          props: "<h1>Props</h1><p>Typed props reflect to the attributes.</p>",
          no_title: "<p>Body only</p>",
        },
      },
    ]);
    expect(out.docs.filter((d: any) => d.kind === "page")).toEqual([
      {
        kind: "page",
        package: "neutron",
        doc: "props",
        title: "Props",
        text: "Props Typed props reflect attributes.",
      },
      { kind: "page", package: "neutron", doc: "no_title", title: "No Title", text: "Body only" },
    ]);
    expect(out.docs.map((d: any) => d.kind)).toEqual(["package", "page", "page"]);
  });
});
