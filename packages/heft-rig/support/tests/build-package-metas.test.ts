import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildPackageMetas, rewriteDocLinks } from "../../scripts/build-package-metas.mjs";
import { SITE_BASE, SITE_HOME } from "../../scripts/site-base.mjs";
import {
  changelogJson,
  makeTempDir,
  packageJson,
  removeDir,
  writeFiles,
} from "./docs-pipeline-fixtures";

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
        // Only `neutron` is named; `kit-utils` is reached through it.
        dependencies: { "@excom/neutron": "workspace:^", "@excom/base-el": "workspace:^" },
        peerDependencies: { "@excom/neutron": "^1.0.0" },
        exports: {
          ".": "./index.js",
          "./fx-el.css": { default: "./fx-el.css" },
          "./dist/internal": "./dist/internal.js",
        },
      }),
      "index.ts": 'export * from "./fx-el.ts";',
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
      "node_modules/@excom/neutron/package.json": packageJson("@excom/neutron", {
        version: "2.0.0",
        dependencies: { "@excom/kit-utils": "workspace:^" },
      }),
      "node_modules/@excom/neutron/node_modules/@excom/kit-utils/package.json": packageJson(
        "@excom/kit-utils",
        { version: "3.4.5" },
      ),
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
        '<script src="https://unpkg.com/@excom/kit-utils@3.4.5/dist/index.umd.min.js"></script>',
        '<script src="https://unpkg.com/@excom/neutron@2.0.0/dist/index.umd.min.js"></script>',
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
      // No `exports` in package.json (applied only at publish time): the
      // build's generated map is the fallback, `./dist/*` aliases dropped.
      "dist/exports.generated.json": JSON.stringify({
        ".": "./dist/index.css",
        "./index.css": { default: "./dist/index.css" },
        "./dist/index.css": { default: "./dist/index.css" },
      }),
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);
    expect(meta.readme).toBeUndefined();
    expect(meta.docs).toBeUndefined();
    expect(meta.exportedFiles).toEqual({
      ".": { default: "./dist/index.css" },
      "./index.css": { default: "./dist/index.css" },
    });
    expect(meta.package.exports).toEqual({
      ".": "./dist/index.css",
      "./index.css": { default: "./dist/index.css" },
      "./dist/index.css": { default: "./dist/index.css" },
    });
    expect(meta.installation.imports).toEqual({
      js: undefined,
      css: '@import "@excom/themes/index.css";',
      html: undefined,
    });
    // No `index.ts`, so no UMD — the CDN snippet is the stylesheet alone.
    expect(meta.installation.cdn).toBe(
      '<link rel="stylesheet" href="https://unpkg.com/@excom/themes@1.2.3/dist/index.css">',
    );
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

  it("carries excom.navGroup in the package block for the catalog to read", async () => {
    const root = path.join(tmp, "grouped-lib");
    writeFiles(root, {
      "package.json": packageJson("@excom/grouped-lib", {
        excom: { documented: true, navGroup: "libraries", packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
    });
    await buildPackageMetas(root);
    expect(readMeta(root).package.excom).toEqual({
      documented: true,
      navGroup: "libraries",
      packageType: "library",
    });
  });

  it("gives a library the prerequisite UMDs its own dependencies reach", async () => {
    const root = path.join(tmp, "tiny-lib");
    writeFiles(root, {
      "package.json": packageJson("@excom/tiny-lib", {
        excom: { documented: true, packageType: "library" },
        dependencies: {
          "@excom/kit-utils": "workspace:^",
          "@excom/quark-parser": "workspace:^",
          pathval: "^2.0.0",
        },
      }),
      "index.ts": "export const x = 1;",
      "node_modules/@excom/kit-utils/package.json": packageJson("@excom/kit-utils", {
        version: "3.4.5",
      }),
      // Bundled into the UMD, so never a CDN prerequisite.
      "node_modules/@excom/quark-parser/package.json": packageJson("@excom/quark-parser"),
    });
    await buildPackageMetas(root);
    expect(readMeta(root).installation.cdn).toBe(
      [
        '<script src="https://unpkg.com/@excom/kit-utils@3.4.5/dist/index.umd.min.js"></script>',
        '<script src="https://unpkg.com/@excom/tiny-lib@1.2.3/dist/index.umd.min.js"></script>',
      ].join("\n"),
    );
  });

  it("orders a prerequisite before the dependency that pulls it in", async () => {
    const root = path.join(tmp, "ordered-el");
    writeFiles(root, {
      "package.json": packageJson("@excom/ordered-el", {
        excom: { documented: true, packageType: "kit-element" },
        // Declared neutron-first; kit-utils must still load first.
        dependencies: {
          "@excom/neutron": "workspace:^",
          "@excom/kit-utils": "workspace:^",
        },
      }),
      "index.ts": "export const x = 1;",
      "node_modules/@excom/neutron/package.json": packageJson("@excom/neutron", {
        version: "2.0.0",
        dependencies: { "@excom/kit-utils": "workspace:^" },
      }),
      "node_modules/@excom/neutron/node_modules/@excom/kit-utils/package.json": packageJson(
        "@excom/kit-utils",
        { version: "3.4.5" },
      ),
      "node_modules/@excom/kit-utils/package.json": packageJson("@excom/kit-utils", {
        version: "3.4.5",
      }),
    });
    await buildPackageMetas(root);
    expect(readMeta(root).installation.cdn).toBe(
      [
        '<script src="https://unpkg.com/@excom/kit-utils@3.4.5/dist/index.umd.min.js"></script>',
        '<script src="https://unpkg.com/@excom/neutron@2.0.0/dist/index.umd.min.js"></script>',
        '<script src="https://unpkg.com/@excom/ordered-el@1.2.3/dist/index.umd.min.js"></script>',
      ].join("\n"),
    );
  });

  it("gives a self-contained UMD no prerequisites", async () => {
    const root = path.join(tmp, "nucleus-kit");
    writeFiles(root, {
      "package.json": packageJson("@excom/nucleus-kit", {
        excom: { documented: true, packageType: "library" },
        dependencies: { "@excom/neutron": "workspace:^" },
      }),
      "index.ts": "export const x = 1;",
      "basic.css": ".b {}",
      "custom-elements.css": ".c {}",
      "node_modules/@excom/neutron/package.json": packageJson("@excom/neutron", {
        version: "2.0.0",
        dependencies: { "@excom/kit-utils": "workspace:^" },
      }),
    });
    await buildPackageMetas(root);
    expect(readMeta(root).installation.cdn).toBe(
      [
        '<script src="https://unpkg.com/@excom/nucleus-kit@1.2.3/dist/index.umd.min.js"></script>',
        '<link rel="stylesheet" href="https://unpkg.com/@excom/nucleus-kit@1.2.3/dist/basic.css">',
      ].join("\n"),
    );
  });

  it("lists no UMD script for a package that sets excom.umd to false", async () => {
    const withCss = path.join(tmp, "no-umd-css");
    writeFiles(withCss, {
      "package.json": packageJson("@excom/no-umd-css", {
        excom: { documented: true, packageType: "library", umd: false },
        dependencies: { "@excom/neutron": "workspace:^" },
      }),
      "index.ts": "export const x = 1;",
      "basic.css": ".b {}",
      "node_modules/@excom/neutron/package.json": packageJson("@excom/neutron", {
        version: "2.0.0",
      }),
    });
    await buildPackageMetas(withCss);
    expect(readMeta(withCss).installation.cdn).toBe(
      '<link rel="stylesheet" href="https://unpkg.com/@excom/no-umd-css@1.2.3/dist/basic.css">',
    );

    const scriptOnly = path.join(tmp, "no-umd");
    writeFiles(scriptOnly, {
      "package.json": packageJson("@excom/no-umd", {
        excom: { documented: true, packageType: "library", umd: false },
      }),
      "index.ts": "export const x = 1;",
    });
    await buildPackageMetas(scriptOnly);
    expect(readMeta(scriptOnly).installation.cdn).toBeUndefined();
  });

  it("leaves an uninstalled prerequisite unpinned and skips CDN for private packages", async () => {
    const root = path.join(tmp, "uninstalled");
    writeFiles(root, {
      "package.json": packageJson("@excom/uninstalled", {
        excom: { documented: true, packageType: "library" },
        dependencies: { "@excom/neutron": "workspace:^" },
      }),
      "index.ts": "export const x = 1;",
    });
    await buildPackageMetas(root);
    expect(readMeta(root).installation.cdn).toBe(
      [
        '<script src="https://unpkg.com/@excom/neutron/dist/index.umd.min.js"></script>',
        '<script src="https://unpkg.com/@excom/uninstalled@1.2.3/dist/index.umd.min.js"></script>',
      ].join("\n"),
    );

    const secret = path.join(tmp, "secret");
    writeFiles(secret, {
      "package.json": packageJson("@excom/secret", {
        private: true,
        excom: { documented: true, packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
    });
    await buildPackageMetas(secret);
    expect(readMeta(secret).installation.cdn).toBeUndefined();
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
      '<spa-a route-href="/packages/paged-lib/props" role="link">Props</spa-a>',
    );
    expect(meta.readme).toContain('route-href="/packages/paged-lib/events#md-emit"');
    expect(meta.readme).toContain('route-href="/packages/paged-lib"');
    expect(meta.readme).toContain('<a href="https://example.com/X.md">out</a>');
    expect(meta.docSections).toEqual([
      { id: "define", title: "Defining", docs: [{ name: "props", title: "Props" }] },
      { id: "behave", title: "Behavior", docs: [{ name: "events", title: "Events" }] },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"missing"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"gone"'));
  });

  it("puts the releases in the meta as data, with notes as inline HTML, and keeps them out of the README", async () => {
    const name = "@excom/noted-lib";
    const root = path.join(tmp, "noted-lib");
    writeFiles(root, {
      "package.json": packageJson(name, {
        excom: { documented: true, packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
      "support/docs/README.md":
        "# noted-lib\n\nIntro.\n\n### API Reference\n\n" +
        '<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>\n',
      "support/docs/PROPS.md": "# Props",
      "CHANGELOG.json": changelogJson(name, [
        {
          version: "0.2.0",
          date: "Thu, 01 Oct 2026 23:59:59 GMT",
          comments: {
            minor: ["Add `newApi()`"],
            dependency: ["Bump `@excom/other` to 9.9.9"],
          },
        },
        { version: "0.1.0", comments: { patch: ["Fix a crash"] } },
      ]),
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);

    expect(meta.releases).toEqual([
      { version: "0.2.0", day: "2026-10-01", notesHtml: ["Add <code>newApi()</code>"] },
      { version: "0.1.0", day: "2026-09-30", notesHtml: ["Fix a crash"] },
    ]);
    expect(meta.readme).not.toContain("release-notes");
    expect(meta.readme).not.toContain("<details");
    // the README already includes the view: no second include
    expect(meta.readme.match(/api-reference\.html/g)).toHaveLength(1);
    expect(meta.docs.readme).not.toContain("release-notes");
    expect(meta.docs.props).toBe('<h1 id="md-props">Props</h1>\n');
    expect(meta).not.toHaveProperty("changelog");
  });

  it("ends a README without an API section with the api-reference include when there are releases", async () => {
    const name = "@excom/no-api-lib";
    const root = path.join(tmp, "no-api-lib");
    writeFiles(root, {
      "package.json": packageJson(name, {
        excom: { documented: true, packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
      "support/docs/README.md": "# no-api-lib\n\nIntro.",
      "support/docs/PROPS.md": "# Props",
      "CHANGELOG.json": changelogJson(name, [
        { version: "0.1.0", comments: { minor: ["Add a thing"] } },
      ]),
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);

    expect(meta.readme).toBe(
      '<h1 id="md-no-api-lib">no-api-lib</h1>\n<p>Intro.</p>\n' +
        '<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>\n',
    );
    expect(meta.releases).toHaveLength(1);
    // doc pages never carry the include
    expect(meta.docs.props).toBe('<h1 id="md-props">Props</h1>\n');
    expect(meta.docs.readme).not.toContain("api-reference");
  });

  it("adds neither releases nor the include without CHANGELOG.json or when nothing survives the filter", async () => {
    const readme = '<h1 id="md-lib">lib</h1>\n';
    const none = path.join(tmp, "no-notes");
    writeFiles(none, {
      "package.json": packageJson("@excom/no-notes", {
        excom: { documented: true, packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
      "support/docs/README.md": "# lib",
    });
    await buildPackageMetas(none);
    expect(readMeta(none).readme).toBe(readme);
    expect(readMeta(none)).not.toHaveProperty("releases");

    const noise = path.join(tmp, "noise-only");
    writeFiles(noise, {
      "package.json": packageJson("@excom/noise-only", {
        excom: { documented: true, packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
      "support/docs/README.md": "# lib",
      "CHANGELOG.json": changelogJson("@excom/noise-only", [
        { version: "0.1.1", comments: { dependency: ["Bump `@excom/other`"], none: ["Tidy"] } },
        { version: "0.1.0", comments: {} },
      ]),
    });
    await buildPackageMetas(noise);
    expect(readMeta(noise).readme).toBe(readme);
    expect(readMeta(noise)).not.toHaveProperty("releases");
  });

  it("keeps release notes out of the slim meta of a site package", async () => {
    const root = path.join(tmp, "site-with-notes");
    writeFiles(root, {
      "package.json": packageJson("@excom/site-with-notes", {
        excom: { documented: false, packageType: "site" },
      }),
      "support/docs/README.md": "# Site",
      "CHANGELOG.json": changelogJson("@excom/site-with-notes", [
        { version: "0.1.0", comments: { minor: ["Add a page"] } },
      ]),
    });
    await buildPackageMetas(root);
    const meta = readMeta(root);
    expect(meta).not.toHaveProperty("releases");
    expect(JSON.stringify(meta)).not.toContain("api-reference");
  });

  it("names the package and CHANGELOG.json when the file is malformed", async () => {
    const name = "@excom/broken-notes";
    const root = path.join(tmp, "broken-notes");
    writeFiles(root, {
      "package.json": packageJson(name, {
        excom: { documented: true, packageType: "library" },
      }),
      "index.ts": "export const x = 1;",
      "CHANGELOG.json": `{ "name": "${name}", "entries": [{ "version": "0.1.0"`,
    });
    await expect(buildPackageMetas(root)).rejects.toThrow(
      /@excom\/broken-notes: invalid CHANGELOG\.json/,
    );
  });

  it("rewriteDocLinks routes site-package links under SITE_BASE on href and route-href, leaves other hrefs alone", () => {
    expect(
      rewriteDocLinks(
        '<spa-a route-href="./QUICK_START.md">a</spa-a><a href="/x.md">b</a><a href="README.md">c</a>',
        { shortName: "docs-site", packageType: "site" },
      ),
    ).toBe(
      '<spa-a route-href="/docs/quick_start">a</spa-a><a href="/x.md">b</a><a href="/docs/readme">c</a>',
    );
    expect(rewriteDocLinks('<a href="./A.md">a</a>', {})).toBe('<a href="./A.md">a</a>');
    expect(rewriteDocLinks("", { shortName: "x" })).toBe("");
  });

  it("rewriteDocLinks maps the site Introduction to the home route `/`, not /docs/introduction or an empty link", () => {
    // an empty base: the docs own the root, and the home is `/`, never ""
    expect(SITE_BASE).toBe("");
    expect(SITE_HOME).toBe("/");
    expect(
      rewriteDocLinks(
        '<spa-a route-href="./INTRODUCTION.md">home</spa-a><a href="INTRODUCTION.md#md-why">why</a>',
        { shortName: "docs-site", packageType: "site" },
      ),
    ).toBe(
      '<spa-a route-href="/">home</spa-a><a href="/#md-why">why</a>',
    );
    // Only the site package: a library page named the same stays a package route.
    expect(
      rewriteDocLinks('<a href="./INTRODUCTION.md">x</a>', {
        shortName: "some-lib",
        packageType: "library",
      }),
    ).toBe('<a href="/packages/some-lib/introduction">x</a>');
  });
});
