import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildDocsIndex, rewriteOfflineLinks } from "../../scripts/build-docs-index.mjs";
import { makeTempDir, removeDir, writeFiles } from "./docs-pipeline-fixtures";

const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("buildDocsIndex", () => {
  let tmp: string;
  let repo: string;
  const cwd = process.cwd();

  beforeAll(() => {
    tmp = makeTempDir("heft-rig-index-");
    repo = path.join(tmp, "repo");
    writeFiles(repo, {
      "rush.json": "{}",
      "dist-docs/stale.md": "stale",
      "packages/a/support/dist-docs/a-el.md": "# a-el\n\nA body.",
      "packages/a/support/dist-docs/notes.txt": "skip",
      "packages/a/support/custom-elements.json": JSON.stringify({
        modules: [
          { path: "no-declarations.ts" },
          {
            declarations: [
              { kind: "class", tagName: "a-el", name: "AEl", summary: "A summary." },
              { kind: "mixin", name: "NoSummary" },
              { kind: "mixin", name: "HelperMixin", summary: "Helper summary." },
            ],
          },
        ],
      }),
      "packages/b/support/dist-docs/helper-mixin.md": "# HelperMixin",
      "packages/b/support/dist-docs/zed.md": "# zed",
      "packages/c/package.json": "{}",
      "packages/docs-site/support/docs-sections.json": JSON.stringify({
        sections: [
          { id: "start", title: "Getting Started", docs: ["intro", "missing_doc"] },
          { id: "empty", title: "Empty", docs: ["gone"] },
        ],
      }),
      "packages/docs-site/support/dist-docs/docs/intro.md":
        "# Introduction\n\n> Quoted *first* sentence. Second one.\n\n" +
        "See [guide](/nucleus/docs/extra) and [pkg](/nucleus/packages/a-el).",
      "packages/docs-site/support/dist-docs/docs/extra.md": "No heading here\n\nMore.",
      "packages/docs-site/support/dist-docs/docs/blank.md": "",
      "packages/docs-site/support/dist-docs/docs/skip.txt": "x",
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

  it("mirrors element docs and guides, and writes llms indexes", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await buildDocsIndex(repo);
    const out = path.join(repo, "dist-docs");
    expect(readdirSync(out).sort()).toEqual([
      "a-el.md",
      "docs",
      "helper-mixin.md",
      "llms-full.txt",
      "llms.txt",
      "zed.md",
    ]);
    expect(readdirSync(path.join(out, "docs")).sort()).toEqual(["blank.md", "extra.md", "intro.md"]);
    expect(read(out, "docs/intro.md")).toContain("[guide](./extra.md) and [pkg](../a-el.md)");

    expect(read(out, "llms.txt")).toBe(
      [
        "# @excom",
        "",
        "> Nucleus Stack. Guides first, then each element or mixin reference (API, prose, demo source).",
        "",
        "## Docs",
        "",
        "### Getting Started",
        "",
        "- [Introduction](./docs/intro.md) — Quoted first sentence.",
        "",
        "### More",
        "",
        "- [blank](./docs/blank.md)",
        "- [extra](./docs/extra.md) — No heading here",
        "",
        "## Elements",
        "",
        "- [a-el](./a-el.md) — A summary.",
        "- [helper-mixin](./helper-mixin.md)",
        "- [zed](./zed.md)",
        "",
      ].join("\n"),
    );
    const full = read(out, "llms-full.txt");
    expect(full.startsWith("# Introduction")).toBe(true);
    expect(full).toContain("\n---\n");
    expect(full).toContain("# a-el\n\nA body.");
    expect(full.trim().endsWith("---")).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Indexed 3 element docs + 3 site docs"));
  });

  it("omits the Docs block when the site has no guides", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const bare = path.join(tmp, "bare-repo");
    writeFiles(bare, {
      "rush.json": "{}",
      "packages/x/support/dist-docs/x-el.md": "# x",
    });
    await buildDocsIndex(bare);
    const llms = read(bare, "dist-docs/llms.txt");
    expect(llms).not.toContain("## Docs");
    expect(llms).toContain("- [x-el](./x-el.md)\n");
    expect(existsSync(path.join(bare, "dist-docs/docs"))).toBe(false);
  });

  it("finds the repo root from cwd when no root is passed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.chdir(path.join(repo, "packages", "a"));
    await buildDocsIndex();
    expect(existsSync(path.join(repo, "dist-docs/llms.txt"))).toBe(true);
  });

  it("throws when no rush.json is found above cwd", async () => {
    const orphan = path.join(tmp, "orphan");
    writeFiles(orphan, { "x.txt": "" });
    process.chdir(orphan);
    await expect(buildDocsIndex()).rejects.toThrow(/Could not find rush.json/);
  });

  it("rewriteOfflineLinks maps SITE_BASE routes to sibling files, leaves the rest", () => {
    expect(rewriteOfflineLinks("[g](/nucleus/docs/styling)")).toBe("[g](./styling.md)");
    expect(rewriteOfflineLinks("[p](/nucleus/packages/quark-sheet)")).toBe(
      "[p](../quark-sheet.md)",
    );
    expect(rewriteOfflineLinks("[home](/nucleus)")).toBe("[home](./introduction.md)");
    // No offline file: package sub-pages, examples and unbased paths stay put.
    expect(rewriteOfflineLinks("[s](/nucleus/packages/quark/modules)")).toBe(
      "[s](/nucleus/packages/quark/modules)",
    );
    expect(rewriteOfflineLinks("[e](/nucleus/examples/todos)")).toBe(
      "[e](/nucleus/examples/todos)",
    );
    expect(rewriteOfflineLinks("[old](/docs/styling)")).toBe("[old](/docs/styling)");
  });

  it("copies llms files into docs-site/dist when that folder exists", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFiles(repo, { "packages/docs-site/dist/.keep": "" });
    await buildDocsIndex(repo);
    expect(read(repo, "packages/docs-site/dist/llms.txt")).toContain("# @excom");
    expect(read(repo, "packages/docs-site/dist/llms-full.txt")).toContain("# Introduction");
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Copied 2 llms file(s) → packages/docs-site/dist"),
    );
  });
});
