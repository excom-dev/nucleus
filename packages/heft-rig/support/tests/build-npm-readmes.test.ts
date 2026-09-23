import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildNpmReadmes,
  footer,
  orderDocs,
  rewriteNpmLinks,
} from "../../scripts/build-npm-readmes.mjs";
import { makeTempDir, packageJson, removeDir, writeFiles } from "./docs-pipeline-fixtures";

const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");
const has = (root: string, rel: string) => existsSync(path.join(root, rel));

describe("buildNpmReadmes", () => {
  let tmp: string;
  let repo: string;
  const cwd = process.cwd();

  beforeAll(() => {
    tmp = makeTempDir("heft-rig-npm-readmes-");
    repo = path.join(tmp, "repo");
    writeFiles(repo, {
      "rush.json": "{}",

      // Multi-element package: the package's own doc leads, rest A→Z.
      "packages/content-tabs/package.json": packageJson("@excom/content-tabs"),
      "packages/content-tabs/support/dist-docs/content-tabs-header.md": "# header\n",
      "packages/content-tabs/support/dist-docs/content-tabs.md": "# content-tabs\n",
      "packages/content-tabs/support/dist-docs/content-tabs-body.md": "# body\n",
      "packages/content-tabs/support/dist-docs/notes.txt": "not markdown",
      // The hand-written overview loses to the compiled docs.
      "packages/content-tabs/support/docs/README.md": "# should not be used\n",

      // Library package: no compiled element docs, overview used verbatim.
      "packages/quark/package.json": packageJson("@excom/quark"),
      "packages/quark/support/docs/README.md":
        "# quark\n\nSee [selectors](./SELECTORS.md) and [modules](/nucleus/packages/quark/modules).\n",

      // A `support/dist-docs/` with only a `docs/` subfolder (site-style
      // guides, no top-level `*.md`) also falls back to the overview.
      "packages/nucleus-kit/package.json": packageJson("@excom/nucleus-kit"),
      "packages/nucleus-kit/support/dist-docs/docs/readme.md": "# guide\n",
      "packages/nucleus-kit/support/docs/README.md": "# nucleus-kit\n",

      // Private: skipped even though it has docs.
      "packages/docs-site/package.json": packageJson("@excom/docs-site", { private: true }),
      "packages/docs-site/support/docs/README.md": "# docs-site\n",

      // Published but undocumented: skipped (neither source).
      "packages/hash-object/package.json": packageJson("@excom/hash-object"),

      // Not a package at all.
      "packages/stray/notes.md": "no package.json here",
    });
  });

  afterAll(() => {
    process.chdir(cwd);
    removeDir(tmp);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(cwd);
  });

  it("concatenates element docs with the package's own doc first, then A→Z", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await buildNpmReadmes(repo);
    expect(read(repo, "packages/content-tabs/README.md")).toBe(
      [
        "# content-tabs",
        "",
        "---",
        "",
        "# body",
        "",
        "---",
        "",
        "# header",
        "",
        "---",
        "",
        "Full documentation: https://excom.dev/nucleus/packages/content-tabs",
        "",
      ].join("\n"),
    );
  });

  it("falls back to support/docs/README.md for library packages", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await buildNpmReadmes(repo);
    expect(read(repo, "packages/quark/README.md")).toBe(
      [
        "# quark",
        "",
        "See [selectors](https://excom.dev/nucleus/packages/quark/selectors) and " +
          "[modules](https://excom.dev/nucleus/packages/quark/modules).",
        "",
        "---",
        "",
        "Full documentation: https://excom.dev/nucleus/packages/quark",
        "",
      ].join("\n"),
    );
    // `support/dist-docs/docs/` without top-level `*.md` is not element docs.
    expect(read(repo, "packages/nucleus-kit/README.md")).toContain("# nucleus-kit");
    expect(read(repo, "packages/nucleus-kit/README.md")).not.toContain("# guide");
  });

  it("skips private packages, sourceless packages and non-packages", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const written = await buildNpmReadmes(repo);
    expect(has(repo, "packages/docs-site/README.md")).toBe(false);
    expect(has(repo, "packages/hash-object/README.md")).toBe(false);
    expect(has(repo, "packages/stray/README.md")).toBe(false);
    expect(written).toBe(3);
    expect(log).toHaveBeenCalledWith(
      "Generated 3 npm README(s) in packages/ (3 package(s) skipped)",
    );
  });

  it("is idempotent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await buildNpmReadmes(repo);
    const first = read(repo, "packages/content-tabs/README.md");
    await buildNpmReadmes(repo);
    expect(read(repo, "packages/content-tabs/README.md")).toBe(first);
  });

  it("finds the repo root from cwd when no root is passed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.chdir(path.join(repo, "packages", "quark"));
    await buildNpmReadmes();
    expect(has(repo, "packages/quark/README.md")).toBe(true);
  });

  it("throws when no rush.json is found above cwd", async () => {
    const orphan = path.join(tmp, "orphan");
    writeFiles(orphan, { "x.txt": "" });
    process.chdir(orphan);
    await expect(buildNpmReadmes()).rejects.toThrow(/Could not find rush.json/);
  });
});

describe("rewriteNpmLinks", () => {
  const rewrite = (md: string) => rewriteNpmLinks(md, "quark");

  it("makes site-relative routes absolute", () => {
    expect(rewrite("[g](/nucleus/docs/best_practices)")).toBe(
      "[g](https://excom.dev/nucleus/docs/best_practices)",
    );
    expect(rewrite("[p](/nucleus/packages/neutron)")).toBe(
      "[p](https://excom.dev/nucleus/packages/neutron)",
    );
    expect(rewrite("[s](/nucleus/packages/quark/modules)")).toBe(
      "[s](https://excom.dev/nucleus/packages/quark/modules)",
    );
    expect(rewrite("[home](/nucleus)")).toBe("[home](https://excom.dev/nucleus)");
  });

  it("maps ./PAGE.md page links to the package's site route", () => {
    expect(rewrite("[a](./SELECTORS.md)")).toBe(
      "[a](https://excom.dev/nucleus/packages/quark/selectors)",
    );
    expect(rewrite("[b](AT_RULES.md)")).toBe(
      "[b](https://excom.dev/nucleus/packages/quark/at_rules)",
    );
    expect(rewrite("[c](./ON.md#md-events)")).toBe(
      "[c](https://excom.dev/nucleus/packages/quark/on#md-events)",
    );
    // The README is the package page itself, not a sub-page.
    expect(rewrite("[d](./README.md)")).toBe("[d](https://excom.dev/nucleus/packages/quark)");
  });

  it("resolves other relative references, including images, against the package page", () => {
    expect(rewrite("![logo](./logo.png)")).toBe(
      "![logo](https://excom.dev/nucleus/packages/quark/logo.png)",
    );
    expect(rewrite("![i](img/diagram.svg)")).toBe(
      "![i](https://excom.dev/nucleus/packages/quark/img/diagram.svg)",
    );
  });

  it("leaves external, scheme and #hash links alone", () => {
    const untouched = [
      "[x](https://excom.dev/nucleus/packages/quark)",
      "[y](http://example.com/a.md)",
      "[z](mailto:joe@excom.global)",
      "[w](//cdn.example.com/x.png)",
      "[h](#md-features)",
    ];
    for (const md of untouched) expect(rewrite(md)).toBe(md);
  });

  it("keeps link titles and does not touch HTML inside fenced code", () => {
    expect(rewrite('[t](./ON.md "The on guide")')).toBe(
      '[t](https://excom.dev/nucleus/packages/quark/on "The on guide")',
    );
    const fenced = '```html\n<script src="/node_modules/@excom/quark"></script>\n```';
    expect(rewrite(fenced)).toBe(fenced);
    // CSS attribute selectors in code blocks look nothing like `](`.
    expect(rewrite("```css\n[bind-progress]::after { width: 1px; }\n```")).toBe(
      "```css\n[bind-progress]::after { width: 1px; }\n```",
    );
  });
});

describe("orderDocs", () => {
  it("puts the package's own doc first and sorts the rest", () => {
    expect(orderDocs(["b-x.md", "spa-route.md", "a-x.md"], "spa-route")).toEqual([
      "spa-route.md",
      "a-x.md",
      "b-x.md",
    ]);
  });

  it("sorts alphabetically when nothing matches the package name", () => {
    expect(orderDocs(["z.md", "a.md"], "nope")).toEqual(["a.md", "z.md"]);
  });
});

describe("footer", () => {
  it("points at the package's docs page", () => {
    expect(footer("content-tabs")).toBe(
      "Full documentation: https://excom.dev/nucleus/packages/content-tabs",
    );
  });
});
