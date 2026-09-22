import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildPackageMetas, rewriteDocLinks } from "../../scripts/build-package-metas.mjs";
import { SITE_BASE } from "../../scripts/site-base.mjs";
import { makeTempDir, packageJson, removeDir, writeFiles } from "./docs-pipeline-fixtures";

const readMeta = (root: string) =>
  JSON.parse(readFileSync(path.join(root, "support/package-meta.json"), "utf8"));

const ELEMENT_SRC = `
import { Neutron } from "@excom/neutron";
import { BaseEl } from "@excom/base-el";
import { LibThing } from "@excom/lib";
import { Ghost } from "@excom/ghost";
/**
 * A documented element with a long enough description.
 * @summary Summary with \`code\`.
 * @fires fx-change - Fired on *change*.
 * @default-action fx-change - Applies the \`change\`.
 * @slot - Default slot.
 */
export const FxEl = Neutron.compose([BaseEl, LibThing, Ghost, Neutron({
  tag: "fx-el",
  props: {
    /**
     * @option
     * Label \`text\`.
     */
    label: String,
  },
})]);
`;

const BASE_CEM = JSON.stringify({
  schemaVersion: "1.0.0",
  modules: [
    {
      path: "base-el.ts",
      declarations: [
        {
          kind: "mixin",
          name: "BaseEl",
          attributes: [{ name: "inherited-attr", type: { text: "string" }, fieldName: "inheritedAttr" }],
        },
      ],
    },
  ],
});

describe("buildPackageMetas", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = makeTempDir("heft-rig-metas-");
  });
  afterAll(() => removeDir(tmp));
  afterEach(() => vi.restoreAllMocks());

  it("skips undocumented packages entirely", async () => {
    const root = path.join(tmp, "undocumented");
    writeFiles(root, {
      "package.json": packageJson("@excom/undocumented"),
      "index.ts": "export const x = 1;",
    });
    await buildPackageMetas(root);
    expect(existsSync(path.join(root, "support"))).toBe(false);

    const site = path.join(tmp, "site-no-docs");
    writeFiles(site, {
      "package.json": packageJson("@excom/site-no-docs", {
        excom: { documented: false, packageType: "site" },
      }),
      "support/docs/notes.txt": "not markdown",
    });
    await buildPackageMetas(site);
    expect(existsSync(path.join(site, "support/package-meta.json"))).toBe(false);
  });

  it("emits a slim meta for site packages with support/docs", async () => {
    const root = path.join(tmp, "docs-site");
    writeFiles(root, {
      "package.json": packageJson("@excom/docs-site", {
        excom: { documented: false, packageType: "site" },
      }),
      "support/docs/QUICK_START.md": "# Quick Start\n\nHello.",
      "support/docs/README.md": "# Readme",
      "support/docs/ignored.txt": "x",
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);
    expect(meta).toEqual({
      shortName: "docs-site",
      package: {
        name: "@excom/docs-site",
        version: "1.2.3",
        description: "@excom/docs-site description",
        peerDependencies: {},
        excom: { documented: false, packageType: "site" },
        exports: undefined,
      },
      docs: {
        quick_start: '<h1 id="md-quick-start">Quick Start</h1>\n<p>Hello.</p>\n',
        readme: '<h1 id="md-readme">Readme</h1>\n',
      },
      demos: {},
      elementApis: [],
      exportedFiles: {},
    });
  });

  it("emits the full meta for a documented element package", async () => {
    const root = path.join(tmp, "fx-el");
    writeFiles(root, {
      "package.json": packageJson("@excom/fx-el", {
        excom: { documented: true, packageType: "kit-element" },
        peerDependencies: { "@excom/neutron": "^1.0.0" },
        exports: {
          ".": "./index.js",
          "./fx-el.css": { default: "./fx-el.css" },
          "./dist/internal": "./dist/internal.js",
        },
      }),
      "fx-el.ts": ELEMENT_SRC,
      "fx-el.css": ":host {}",
      "support/docs/README.md": "# fx-el\n\nIntro.",
      "support/docs/GUIDE.md": "# Guide",
      "support/demos/basic.html": "<fx-el></fx-el>\n",
      "support/demos/index.html": "<html></html>",
      "support/demos/notes.txt": "skip",
      "node_modules/@excom/base-el/package.json": packageJson("@excom/base-el", {
        excom: { packageType: "element-base" },
      }),
      "node_modules/@excom/base-el/support/custom-elements.json": BASE_CEM,
      "node_modules/@excom/lib/package.json": packageJson("@excom/lib", {
        excom: { packageType: "library" },
      }),
    });
    await buildPackageMetas(root);
    expect(existsSync(path.join(root, "support/custom-elements.json"))).toBe(true);
    const meta = readMeta(root);

    expect(meta.shortName).toBe("fx-el");
    expect(meta.readme).toContain('<h1 id="md-fx-el">fx-el</h1>');
    expect(Object.keys(meta.docs)).toEqual(["guide", "readme"]);
    expect(meta.demos).toEqual({ basic: "<fx-el></fx-el>\n" });
    expect(meta.exportedFiles).toEqual({
      ".": { default: "./index.js" },
      "./fx-el.css": { default: "./fx-el.css" },
    });
    expect(meta.installation).toEqual({
      name: "@excom/fx-el",
      shortName: "fx-el",
      version: "1.2.3",
      description: "@excom/fx-el description",
      packageType: "kit-element",
      cdn: [
        '<script src="https://unpkg.com/@excom/kit-utils/dist/index.umd.min.js"></script>',
        '<script src="https://unpkg.com/@excom/neutron/dist/index.umd.min.js"></script>',
        '<script src="https://unpkg.com/@excom/fx-el@1.2.3/dist/index.umd.min.js"></script>',
        '<link rel="stylesheet" href="https://unpkg.com/@excom/fx-el@1.2.3/dist/fx-el.css">',
      ].join("\n"),
      install: { npm: "npm install @excom/fx-el" },
      imports: {
        js: 'import "@excom/fx-el";',
        css: '@import "@excom/fx-el/fx-el.css";',
        html: '<!-- import path to `node_modules` will depend on your build setup -->\n<script type="module" src="/node_modules/@excom/fx-el"></script>\n<link rel="stylesheet" href="/node_modules/@excom/fx-el">',
      },
      peerDependencies: [{ name: "@excom/neutron", version: "^1.0.0" }],
    });

    const [api] = meta.elementApis;
    expect(api.tag).toBe("fx-el");
    expect(api.summary).toBe("Summary with <code>code</code>.");
    expect(api.attributes.map((a: any) => [a.name, a.inheritedFrom])).toEqual([
      ["inherited-attr", "@excom/base-el"],
      ["label", undefined],
    ]);
    expect(api.attributes[1].description).toBe("Label <code>text</code>.");
    expect(api.events[0]).toMatchObject({
      name: "fx-change",
      description: "Fired on <em>change</em>.",
      defaultAction: "Applies the <code>change</code>.",
    });
  });

  it("synthesizes a CSS-library API from stylesheets and scheme mixins", async () => {
    const root = path.join(tmp, "themes");
    writeFiles(root, {
      "package.json": packageJson("@excom/themes", {
        excom: { documented: true, packageType: "library" },
      }),
      "index.css": '@import "./src/theme.css";',
      "src/theme.css": `
@define-mixin scheme-light { --t-bg: white; }
@define-mixin scheme-dark { --t-bg: black; }
/**
 * Documented token.
 * @cssproperty
 */
--t-fg: black;
/**
 * Utility.
 * @cssclass
 */
.muted {}
@custom-selector :--card .card;
`,
      "node_modules/skip/x.css": "/**\n * @cssclass\n */\n.no {}",
      "dist/x.css": "/**\n * @cssclass\n */\n.no {}",
      "support/x.css": "/**\n * @cssclass\n */\n.no {}",
      "coverage/x.css": "/**\n * @cssclass\n */\n.no {}",
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);
    expect(meta.readme).toBeUndefined();
    expect(meta.docs).toBeUndefined();
    expect(meta.installation.imports).toEqual({
      js: undefined,
      css: '@import "@excom/themes";',
      html: undefined,
    });
    expect(meta.installation.cdn).toBeUndefined();
    const [api] = meta.elementApis;
    expect(api.tag).toBe("themes");
    expect(api.cssProperties).toEqual([
      { name: "--t-bg", description: "", syntax: undefined, default: "white" },
      { name: "--t-fg", description: "Documented token.", syntax: undefined, default: "black" },
    ]);
    expect(api.cssClasses).toEqual([{ name: "muted", description: "Utility." }]);
    expect(api.cssAliases).toEqual([
      { name: ":--card", selectors: [".card"], kind: "element", description: "" },
    ]);
  });

  it("picks basic.css / first css and honours sideEffectImport", async () => {
    const root = path.join(tmp, "side-effect");
    writeFiles(root, {
      "package.json": packageJson("@excom/side-effect", {
        excom: { documented: true, packageType: "library", sideEffectImport: true },
      }),
      "zzz.css": ".z {}",
      "basic.css": ".b {}",
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);
    expect(meta.installation.imports.js).toBe('import "@excom/side-effect";');
    expect(meta.installation.imports.css).toBe('@import "@excom/side-effect/basic.css";');
    expect(meta.elementApis).toEqual([]);

    const other = path.join(tmp, "other-css");
    writeFiles(other, {
      "package.json": packageJson("@excom/other-css", {
        excom: { documented: true, packageType: "tool" },
      }),
      "other.css": ".o {}",
    });
    await buildPackageMetas(other);
    expect(readMeta(other).installation.imports).toEqual({
      js: 'import { /* … */ } from "@excom/other-css";',
      css: '@import "@excom/other-css/other.css";',
      html: undefined,
    });
  });

  it("emits an empty API for libraries without stylesheets", async () => {
    const root = path.join(tmp, "plain-lib");
    writeFiles(root, {
      "package.json": packageJson("@excom/plain-lib", {
        excom: { documented: true, packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);
    expect(meta.elementApis).toEqual([]);
    expect(meta.installation.imports).toEqual({
      js: 'import { /* … */ } from "@excom/plain-lib";',
      css: undefined,
      html: undefined,
    });
  });

  it("groups doc pages by docs-sections.json, rewrites page links to spa-a routes, skips INTERNAL.md", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = path.join(tmp, "paged-lib");
    writeFiles(root, {
      "package.json": packageJson("@excom/paged-lib", {
        excom: { documented: true, packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
      "support/docs/README.md":
        "# paged-lib\n\nSee [Props](./PROPS.md), [events](EVENTS.md#md-emit), [this](README.md) and [out](https://example.com/X.md).\n\n## Usage",
      "support/docs/PROPS.md": "# Props\n\n## Shorthand\n\n## Rich config\n\n### Keys",
      "support/docs/EVENTS.md": "# Events\n\nno sub-headings",
      "support/docs/INTERNAL.md": "# Internal notes",
      "support/docs-sections.json": JSON.stringify({
        sections: [
          { id: "define", title: "Defining", docs: ["props", "missing"] },
          { id: "behave", title: "Behavior", docs: ["events"] },
          { id: "empty", title: "Nothing here", docs: ["gone"] },
        ],
      }),
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);

    expect(Object.keys(meta.docs).sort()).toEqual(["events", "props", "readme"]);
    expect(meta.readme).toContain(
      '<spa-a route-href="/nucleus/packages/paged-lib/props" role="link">Props</spa-a>',
    );
    expect(meta.readme).toContain('route-href="/nucleus/packages/paged-lib/events#md-emit"');
    expect(meta.readme).toContain('route-href="/nucleus/packages/paged-lib"');
    expect(meta.readme).toContain('<a href="https://example.com/X.md">out</a>');
    expect(meta.docSections).toEqual([
      { id: "define", title: "Defining", docs: [{ name: "props", title: "Props" }] },
      { id: "behave", title: "Behavior", docs: [{ name: "events", title: "Events" }] },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"missing"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"gone"'));
  });

  it("rewriteDocLinks routes site-package links under SITE_BASE on href and route-href, leaves other hrefs alone", () => {
    expect(
      rewriteDocLinks(
        '<spa-a route-href="./QUICK_START.md">a</spa-a><a href="/x.md">b</a><a href="README.md">c</a>',
        { shortName: "docs-site", packageType: "site" },
      ),
    ).toBe(
      '<spa-a route-href="/nucleus/docs/quick_start">a</spa-a><a href="/x.md">b</a><a href="/nucleus/docs/readme">c</a>',
    );
    expect(rewriteDocLinks('<a href="./A.md">a</a>', {})).toBe('<a href="./A.md">a</a>');
    expect(rewriteDocLinks("", { shortName: "x" })).toBe("");
  });

  it("rewriteDocLinks maps the site Introduction to SITE_BASE, not /nucleus/docs/introduction", () => {
    expect(SITE_BASE).toBe("/nucleus");
    expect(
      rewriteDocLinks(
        '<spa-a route-href="./INTRODUCTION.md">home</spa-a><a href="INTRODUCTION.md#md-why">why</a>',
        { shortName: "docs-site", packageType: "site" },
      ),
    ).toBe(
      '<spa-a route-href="/nucleus">home</spa-a><a href="/nucleus#md-why">why</a>',
    );
    // Only the site package: a library page named the same stays a package route.
    expect(
      rewriteDocLinks('<a href="./INTRODUCTION.md">x</a>', {
        shortName: "some-lib",
        packageType: "library",
      }),
    ).toBe('<a href="/nucleus/packages/some-lib/introduction">x</a>');
  });
});
