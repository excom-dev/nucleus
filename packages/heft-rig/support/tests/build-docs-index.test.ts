import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  buildDocsIndex,
  exampleAppLine,
  linkExampleApps,
  readExampleApps,
  rewriteOfflineLinks,
} from "../../scripts/build-docs-index.mjs";
import { makeTempDir, removeDir, writeFiles } from "./docs-pipeline-fixtures";

const read = (root: string, rel: string) => readFileSync(path.join(root, rel), "utf8");

const TODO_LINE =
  "[Open the Todo App example app](./examples/todo-app/todo-app.html) — source: " +
  "[HTML](./examples/todo-app/todo-app.html) · [Quark](./examples/todo-app/todo-app.quark) · " +
  "[CSS](./examples/todo-app/todo-app.css)";
const COUNTER_LINE =
  "[Open the Counter example app](./examples/counter-app/counter-app.html) — source: " +
  "[HTML](./examples/counter-app/counter-app.html) · [Quark](./examples/counter-app/counter-app.quark)";

/** A docs-site `index.html` sidebar + route table, and the example view folders. */
const SITE_FIXTURE = {
  "packages/docs-site/index.html": [
    '<spa-a route-href="/nucleus/examples/todos" role="link" class="secondary">Todo App</spa-a>',
    '<spa-a route-href="/nucleus/examples/counter" role="link"> Counter </spa-a>',
    '<spa-a route-href="/nucleus/examples/counter" role="link">Second link</spa-a>',
    '<spa-route route-href="/nucleus/docs/:name" template-ref="/views/package/package.html"></spa-route>',
    '<!-- <spa-route route-href="/nucleus/examples/old" data-app="todo-app"></spa-route> -->',
    '<spa-route route-href="/nucleus/examples/todos" template-ref="/views/live-app/live-app.html"',
    '  data-app="todo-app" data-files="html quark css"></spa-route>',
    '<spa-route route-href="/nucleus/examples/counter" template-ref="/views/live-app/live-app.html"',
    '  data-app="counter-app" data-files="html quark"></spa-route>',
    '<spa-route route-href="/nucleus/examples/cells" data-app="cells-app"></spa-route>',
    '<spa-route route-href="/nucleus/examples/ghost" data-app="ghost-app"></spa-route>',
    '<spa-route route-href="/nucleus/examples/bare"></spa-route>',
    '<spa-route route-href="/nucleus/demo" data-app="demo-app"></spa-route>',
  ].join("\n"),
  "packages/docs-site/public/views/todo-app/todo-app.html": "<h1>todos</h1>",
  "packages/docs-site/public/views/todo-app/todo-app.quark": "h1 { content: 'x'; }",
  "packages/docs-site/public/views/todo-app/todo-app.css": "h1 { color: red; }",
  "packages/docs-site/public/views/counter-app/counter-app.html": "<p>0</p>",
  "packages/docs-site/public/views/counter-app/counter-app.quark": "p { content: 1; }",
  "packages/docs-site/public/views/cells-app/cells-app.html": "<table></table>",
  "packages/docs-site/public/views/cells-app/cells-app.js": "export {};",
  "packages/docs-site/public/views/ghost-app/ghost-app.css": "",
  "packages/docs-site/public/views/live-app/live-app.html": "<div></div>",
  "packages/docs-site/public/views/demo-app/demo-app.html": "<div></div>",
};

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
        "See [guide](/nucleus/docs/extra) and [pkg](/nucleus/packages/a-el).\n\n" +
        '<include-content is-active template-ref="/views/live-app/live-app.html" data-app="todo-app"' +
        ' data-files="html quark css" data-mini></include-content>\n\n' +
        "Try the [counter](/nucleus/examples/counter).\n\n" +
        '<include-content data-app="counter-app" />\n',
      ...SITE_FIXTURE,
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
    expect(readdirSync(path.join(out, "docs")).sort()).toEqual([
      "blank.md",
      "examples",
      "extra.md",
      "intro.md",
    ]);
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
    expect(full).not.toContain("<include-content");
    expect(full).toContain(TODO_LINE);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Indexed 3 element docs + 3 site docs"));
  });

  it("replaces example-app playgrounds in guides with links to the copied sources", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await buildDocsIndex(repo);
    const intro = read(repo, "dist-docs/docs/intro.md");
    expect(intro).not.toContain("<include-content");
    // Playground with a CSS file, then a self-closing one without.
    expect(intro).toContain(`\n\n${TODO_LINE}\n\n`);
    expect(intro.trimEnd().endsWith(COUNTER_LINE)).toBe(true);
    // Example routes now have an offline file too.
    expect(intro).toContain("Try the [counter](./examples/counter-app/counter-app.html).");
  });

  it("copies every routed example app's view folder into dist-docs/docs/examples", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await buildDocsIndex(repo);
    const examples = path.join(repo, "dist-docs/docs/examples");
    // Not the playground chrome, not a non-example route, not an app without HTML.
    expect(readdirSync(examples).sort()).toEqual(["cells-app", "counter-app", "todo-app"]);
    expect(readdirSync(path.join(examples, "todo-app")).sort()).toEqual([
      "todo-app.css",
      "todo-app.html",
      "todo-app.quark",
    ]);
    expect(read(examples, "cells-app/cells-app.js")).toBe("export {};");
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
    // With the example apps known, their routes map to the copied HTML.
    const todo = { app: "todo-app", route: "/nucleus/examples/todos", name: "Todo App", files: [] };
    expect(rewriteOfflineLinks("[e](/nucleus/examples/todos) [f](/nucleus/examples/todos)", [todo])).toBe(
      "[e](./examples/todo-app/todo-app.html) [f](./examples/todo-app/todo-app.html)",
    );
    expect(rewriteOfflineLinks("[x](/nucleus/examples/timer)", [todo])).toBe(
      "[x](/nucleus/examples/timer)",
    );
  });

  describe("example apps", () => {
    const todo = {
      app: "todo-app",
      route: "/nucleus/examples/todos",
      name: "Todo App",
      files: ["todo-app.css", "todo-app.html", "todo-app.quark", "notes.txt"],
    };
    const cells = {
      app: "cells-app",
      route: "/nucleus/examples/cells",
      name: "Cells",
      files: ["cells-app.css", "cells-app.html", "cells-app.js", "cells-app.quark"],
    };

    it("exampleAppLine links the HTML plus each source file that exists", () => {
      expect(exampleAppLine(todo)).toBe(TODO_LINE);
      expect(exampleAppLine({ ...todo, files: ["todo-app.html"] })).toBe(
        "[Open the Todo App example app](./examples/todo-app/todo-app.html) — source: " +
          "[HTML](./examples/todo-app/todo-app.html)",
      );
      expect(exampleAppLine(cells)).toBe(
        "[Open the Cells example app](./examples/cells-app/cells-app.html) — source: " +
          "[HTML](./examples/cells-app/cells-app.html) · [Quark](./examples/cells-app/cells-app.quark) · " +
          "[CSS](./examples/cells-app/cells-app.css) · [JS](./examples/cells-app/cells-app.js)",
      );
    });

    it("linkExampleApps replaces known playgrounds only, and never inside code", () => {
      const md = [
        '<include-content is-active data-app="todo-app" data-mini></include-content>',
        '<include-content data-app="cells-app"/>',
        '<include-content data-app="nope-app"></include-content>',
        '<include-content template-ref="/views/x.html"></include-content>',
        '<include-content x-data-app="todo-app"></include-content>',
        '<include-content data-app="todo-app"><template>body</template></include-content>',
        'Inline: `<include-content data-app="todo-app"></include-content>`.',
        "```html",
        '<include-content data-app="todo-app"></include-content>',
        "```",
        "~~~",
        '<include-content data-app="cells-app" />',
        "~~~",
      ].join("\n");
      const out = linkExampleApps(md, [todo, cells]).split("\n");
      expect(out[0]).toBe(TODO_LINE);
      expect(out[1]).toBe(exampleAppLine(cells));
      expect(out.slice(2)).toEqual(md.split("\n").slice(2));
      expect(linkExampleApps(md, [])).toBe(md);
    });

    it("readExampleApps derives apps, routes and names from the site index.html", async () => {
      const site = path.join(tmp, "examples-repo");
      writeFiles(site, SITE_FIXTURE);
      expect(await readExampleApps(site)).toEqual([
        {
          app: "todo-app",
          route: "/nucleus/examples/todos",
          name: "Todo App",
          files: ["todo-app.css", "todo-app.html", "todo-app.quark"],
        },
        {
          app: "counter-app",
          route: "/nucleus/examples/counter",
          name: "Counter",
          files: ["counter-app.html", "counter-app.quark"],
        },
        // No sidebar link: named from the app.
        {
          app: "cells-app",
          route: "/nucleus/examples/cells",
          name: "Cells",
          files: ["cells-app.html", "cells-app.js"],
        },
      ]);
      expect(await readExampleApps(path.join(tmp, "no-such-repo"))).toEqual([]);
    });
  });

  it("skips the docs-site copy when dist/ does not exist", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const nodist = path.join(tmp, "nodist-repo");
    writeFiles(nodist, {
      "rush.json": "{}",
      "packages/x/support/dist-docs/x-el.md": "# x",
      "packages/docs-site/support/dist-docs/docs/intro.md": "# Introduction",
    });
    await buildDocsIndex(nodist);
    expect(existsSync(path.join(nodist, "dist-docs/llms.txt"))).toBe(true);
    expect(existsSync(path.join(nodist, "packages/docs-site/dist"))).toBe(false);
    expect(existsSync(path.join(nodist, "packages/docs-site/dist/sitemap.xml"))).toBe(false);
  });

  it("copies llms files and the markdown mirror into docs-site/dist when that folder exists", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeFiles(repo, {
      "packages/docs-site/dist/.keep": "",
      "packages/docs-site/dist/docs/examples/stale-app/stale-app.html": "stale",
    });
    await buildDocsIndex(repo);
    const dist = path.join(repo, "packages/docs-site/dist");
    expect(read(repo, "packages/docs-site/dist/llms.txt")).toContain("# @excom");
    expect(read(repo, "packages/docs-site/dist/llms-full.txt")).toContain("# Introduction");
    // Element docs land beside llms.txt; guides under dist/docs/ — both match
    // the relative links the index writes.
    expect(readdirSync(dist).sort()).toEqual([
      ".keep",
      "a-el.md",
      "docs",
      "helper-mixin.md",
      "llms-full.txt",
      "llms.txt",
      "sitemap.xml",
      "zed.md",
    ]);
    expect(readdirSync(path.join(dist, "docs")).sort()).toEqual([
      "blank.md",
      "examples",
      "extra.md",
      "intro.md",
    ]);
    // The guides' `./examples/<app>/…` links resolve beside them; stale apps go.
    expect(readdirSync(path.join(dist, "docs/examples")).sort()).toEqual([
      "cells-app",
      "counter-app",
      "todo-app",
    ]);
    expect(read(dist, "docs/examples/todo-app/todo-app.quark")).toBe("h1 { content: 'x'; }");
    expect(read(repo, "packages/docs-site/dist/a-el.md")).toBe("# a-el\n\nA body.");
    expect(read(repo, "packages/docs-site/dist/docs/intro.md")).toContain(
      "[guide](./extra.md) and [pkg](../a-el.md)",
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Copied 2 llms file(s) + 6 markdown file(s) + 3 example app(s) → packages/docs-site/dist",
      ),
    );
    // No `dist/package-metas/index.json` here: no package URLs.
    expect(read(dist, "sitemap.xml")).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url><loc>https://excom.dev/</loc></url>",
        "  <url><loc>https://excom.dev/nucleus</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/docs/intro</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/docs/blank</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/docs/extra</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/examples/todos</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/examples/counter</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/examples/cells</loc></url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
  });

  it("writes a sitemap of the docs home, guides, packages with their doc pages, and examples", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const site = path.join(tmp, "sitemap-repo");
    writeFiles(site, {
      "rush.json": "{}",
      ...SITE_FIXTURE,
      "packages/docs-site/support/docs-sections.json": JSON.stringify({
        sections: [{ id: "start", title: "Start", docs: ["introduction", "styling"] }],
      }),
      "packages/docs-site/support/dist-docs/docs/introduction.md": "# The Nucleus Stack",
      "packages/docs-site/support/dist-docs/docs/styling.md": "# Styling",
      "packages/docs-site/dist/index.html": "<html></html>",
      "packages/docs-site/dist/package-metas/index.json": JSON.stringify({
        packages: [
          { shortName: "content-tabs", packageType: "kit-element" },
          {
            shortName: "quark",
            packageType: "library",
            docSections: [
              { id: "a", title: "A", docs: [{ name: "readme" }, { name: "sheets" }, { name: "syntax" }] },
              { id: "b", title: "B" },
              { id: "c", title: "C", docs: [{ name: "sheets" }, { name: "js_api" }] },
            ],
          },
        ],
        docs: [],
      }),
    });
    await buildDocsIndex(site);
    expect(read(site, "packages/docs-site/dist/sitemap.xml")).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url><loc>https://excom.dev/</loc></url>",
        "  <url><loc>https://excom.dev/nucleus</loc></url>",
        // `introduction` is the docs home, not `/nucleus/docs/introduction`.
        "  <url><loc>https://excom.dev/nucleus/docs/styling</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/packages/content-tabs</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/packages/quark</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/packages/quark/sheets</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/packages/quark/syntax</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/packages/quark/js_api</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/examples/todos</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/examples/counter</loc></url>",
        "  <url><loc>https://excom.dev/nucleus/examples/cells</loc></url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
    expect(log).toHaveBeenCalledWith("Wrote 11 URL(s) → packages/docs-site/dist/sitemap.xml");
  });
});
