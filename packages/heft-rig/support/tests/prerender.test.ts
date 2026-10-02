import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RIG_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(RIG_ROOT, "scripts/prerender.mjs");
// inside the repo: the runner finds rush.json and aliases the real workspace
const FIXTURE = path.join(__dirname, "fixtures/prerender");
const originalArgv = process.argv;

let out: string;

beforeEach(() => {
  out = mkdtempSync(path.join(os.tmpdir(), "rig-prerender-"));
  process.env.RIG_PRERENDER_OUT = out;
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
  delete process.env.RIG_PRERENDER_OUT;
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

const load = async () => {
  process.argv = [process.execPath, "/elsewhere.mjs"];
  return import("../../scripts/prerender.mjs");
};

const diagnostics = (overrides = {}) => ({
  errors: [],
  warnings: [],
  requests: [],
  skippedProvisions: [],
  neutralizedScripts: 0,
  heldTimers: [],
  islandBytes: 0,
  ...overrides,
});

describe("createWorkspaceRunner", () => {
  it("loads workspace modules from source through the rig's aliases", async () => {
    const { createWorkspaceRunner } = await load();
    const runner = await createWorkspaceRunner(FIXTURE);
    try {
      const { SITE_BASE } = await runner.import("@excom/heft-rig/scripts/site-base.mjs");
      expect(SITE_BASE).toBe("/nucleus");
      const { options } = await runner.import(path.join(FIXTURE, "options.ts"));
      expect(options()).toMatchObject({ out, routes: ["/", "/nucleus/broken"] });
    } finally {
      await runner.close();
    }
  });
});

describe("loadPrerenderConfig", () => {
  const runner = (config: unknown) => ({ import: async () => ({ default: config }) });

  it("takes the default export, or what a default-exported function returns", async () => {
    const { loadPrerenderConfig } = await load();
    expect(await loadPrerenderConfig(runner({ routes: ["/"] }), "a.ts")).toEqual({ routes: ["/"] });
    expect(await loadPrerenderConfig(runner(async () => ({ routes: [] })), "b.ts")).toEqual({
      routes: [],
    });
  });

  it("refuses a config without routes", async () => {
    const { loadPrerenderConfig } = await load();
    await expect(loadPrerenderConfig(runner({ root: "dist" }), "c.ts")).rejects.toThrow(
      "prerender: c.ts exports no options with routes",
    );
    await expect(loadPrerenderConfig(runner(undefined), "d.ts")).rejects.toThrow("d.ts");
  });
});

describe("classifyPages", () => {
  it("marks failures by the onError policy and routes whose file is missing", async () => {
    const { classifyPages } = await load();
    const written = mkdtempSync(path.join(os.tmpdir(), "rig-prerender-out-"));
    try {
      ["index.html", "a.html", "b.html"].forEach((file) => writeFileSync(path.join(written, file), ""));
      const page = (url: string, file: string, errors: string[] = []) => ({
        url,
        file,
        bytes: 1,
        ms: 1,
        diagnostics: diagnostics({ errors }),
      });
      const report = {
        pages: [
          page("/", "index.html"),
          page("/a", "a.html", ["boom"]),
          page("/b", "b.html", ["bang"]),
          page("/gone", "gone.html"),
        ],
        failed: ["/a", "/b"],
      };
      const statuses = (onError?: unknown) =>
        classifyPages(report, { out: written, onError }).map(({ status, problems }) => [status, problems]);
      expect(statuses()).toEqual([
        ["ok", []],
        ["failed", ["boom"]],
        ["failed", ["bang"]],
        ["failed", ["no file at gone.html"]],
      ]);
      expect(statuses((url: string) => (url === "/a" ? "shell" : "fail"))).toEqual([
        ["ok", []],
        ["shell", ["boom"]],
        ["failed", ["bang"]],
        ["failed", ["no file at gone.html"]],
      ]);
      expect(statuses("shell").map(([status]) => status)).toEqual(["ok", "shell", "shell", "failed"]);
      // nucleus-ssr wrote nothing: no file is missing
      expect(classifyPages(report, { out: written }, false).map(({ status }) => status)).toEqual([
        "ok",
        "failed",
        "failed",
        "ok",
      ]);
    } finally {
      rmSync(written, { recursive: true, force: true });
    }
  });
});

describe("formatReport", () => {
  it("prints a line per page, problems under failures, then counts, sizes and warnings", async () => {
    const { formatReport } = await load();
    const lines = formatReport(
      [
        {
          url: "/",
          file: "index.html",
          bytes: 12_345,
          ms: 40,
          status: "ok",
          problems: [],
          diagnostics: diagnostics({ islandBytes: 2_000, warnings: ["slow"] }),
        },
        {
          url: "/docs/a",
          file: "docs/a.html",
          bytes: 3_000,
          ms: 7,
          status: "shell",
          problems: ["Refused DELETE"],
          diagnostics: diagnostics({ errors: ["Refused DELETE"], warnings: ["slow"] }),
        },
        {
          url: "/x",
          file: "x.html",
          bytes: 0,
          ms: 5_001,
          status: "failed",
          problems: ["Not settled"],
          diagnostics: diagnostics({ errors: ["Not settled"] }),
        },
      ],
      61_250,
    );
    expect(lines).toEqual([
      "  ok     index.html    12.3 kB    40 ms island 2.0 kB 1 warning(s)",
      "  shell  docs/a.html    3.0 kB     7 ms 1 warning(s)",
      "           Refused DELETE",
      "  failed x.html              -  5001 ms",
      "           Not settled",
      "prerender: 1 rendered, 1 shell fallback(s), 1 failed, in 61.3 s",
      "  largest pages: index.html 12.3 kB, docs/a.html 3.0 kB",
      "  largest islands: index.html 2.0 kB",
      "  warning ×2: slow",
    ]);
  });
});

describe("liveMarkup", () => {
  it("drops comments, scripts, styles and inert template content, keeping declarative shadow roots", async () => {
    const { liveMarkup } = await load();
    expect(
      liveMarkup(
        [
          "<p>a</p><!-- <p>comment</p> -->",
          '<script type="application/json">{"html":"<template>"}</script>',
          "<STYLE>p > a {}</STYLE>",
          '<template data-note="a > b"><p>inert</p><template><p>nested</p></template><p>inert</p></template>',
          "<p>b</p>",
          '<template shadowrootmode="open"><p>shadow</p><template><p>inert</p></template><p>shadow</p></template>',
          "<p>c</p><template><p>unclosed",
        ].join(""),
      ),
    ).toBe("<p>a</p><p>b</p><p>shadow</p><p>shadow</p><p>c</p>");
  });
});

describe("checkLinks", () => {
  const PAGE = [
    '<html><head><link rel="alternate" href="/missing-link-element"></head><body>',
    '<spa-a route-href="/a/b">a page</spa-a>',
    '<spa-a route-href="/a/b/">trailing slash</spa-a>',
    '<spa-a route-href="/docs">folder index</spa-a>',
    '<spa-a route-href="/">home</spa-a>',
    '<a href="b">relative, to /a/b</a>',
    '<a href="#top">fragment</a>',
    '<a href="?page=2">query</a>',
    '<a href="/a/b?x=1&amp;y=2#z">query and fragment</a>',
    '<a href="/caf%C3%A9">encoded</a>',
    '<a href="/missing">missing</a>',
    "<a href='/missing-single'>single quotes</a>",
    "<a href=/missing-bare>no quotes</a>",
    '<a title="x > y" href="/missing-after-gt">> in a value</a>',
    '<a href="/missing">the same link again</a>',
    '<a class="a" data-href="/data" href="/missing-&#x41;&amp;b">entities</a>',
    '<a href="/llms.txt">a file</a>',
    '<a href="/sandbox/app">served elsewhere</a>',
    '<a href="https://elsewhere.test/missing">another site</a>',
    '<a href="mailto:someone@example.com">mail</a>',
    '<a href="http://[broken">unparsable</a>',
    '<a name="anchor">no href</a>',
    '<a-b href="/missing-custom">custom element</a-b>',
    '<abbr href="/missing-abbr">abbreviation</abbr>',
    '<spa-route route-href="/missing-route/:pattern"></spa-route>',
    '<template><a href="/missing-template">inert</a></template>',
    '<template shadowrootmode="open"><a href="/missing-shadow">live</a></template>',
    '<!-- <a href="/missing-comment"> -->',
    '<script type="application/json">{"html":"<a href=\\"/missing-script\\">"}</script>',
    "</body></html>",
  ].join("\n");

  it("lists each link of a written page to no page of the site, once per page", async () => {
    const { checkLinks } = await load();
    for (const file of ["index.html", "a/b.html", "a/x.html", "docs/index.html", "café.html"]) {
      mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
      writeFileSync(path.join(out, file), file === "a/x.html" ? PAGE : "<p>page</p>");
    }
    const pages = [
      { url: "/a/x", file: "a/x.html" },
      { url: "/gone", file: "gone.html" },
    ];
    const servedElsewhere = (url: string) => new URL(url).pathname.startsWith("/sandbox/");
    const missing = [
      "/missing",
      "/missing-single",
      "/missing-bare",
      "/missing-after-gt",
      "/missing-&#x41;&amp;b",
      "/missing-shadow",
    ].map((href) => ({ page: "a/x.html", href: href.replace("&#x41;&amp;", "A&") }));
    expect(checkLinks(pages, { out, origin: "https://rig.test/base", servedElsewhere })).toEqual({
      checked: 16,
      broken: missing,
    });
    // without the predicate, the sandbox link leads to no page either
    expect(checkLinks(pages, { out: pathToFileURL(out), origin: "https://rig.test" })).toEqual({
      checked: 17,
      broken: [...missing.slice(0, 5), { page: "a/x.html", href: "/sandbox/app" }, missing[5]],
    });
  });
});

describe("formatLinks", () => {
  it("prints the count, then each link to no page with its page", async () => {
    const { formatLinks } = await load();
    expect(formatLinks({ checked: 12, broken: [] })).toEqual(["  links: 12 checked, each to a page"]);
    expect(
      formatLinks({
        checked: 12,
        broken: [
          { page: "index.html", href: "/gone" },
          { page: "docs/a.html", href: "../gone#top" },
        ],
      }),
    ).toEqual([
      "  links: 12 checked, 2 to no page:",
      "    index.html → /gone",
      "    docs/a.html → ../gone#top",
    ]);
  });
});

describe("runPrerender", () => {
  const read = (file: string) => readFileSync(path.join(out, file), "utf8");

  it("exits 1 naming the route that failed, writing nothing", async () => {
    const { runPrerender } = await load();
    const log = vi.fn();
    const { exitCode, pages } = await runPrerender({
      packageRoot: FIXTURE,
      configFile: "fail.config.ts",
      log,
    });
    expect(exitCode).toBe(1);
    expect(pages.map(({ url, status }) => [url, status])).toEqual([
      ["/", "ok"],
      ["/nucleus/broken", "failed"],
    ]);
    expect(existsSync(path.join(out, "index.html"))).toBe(false);
    const printed = log.mock.calls.map(([line]) => line).join("\n");
    expect(printed).toContain("broken on purpose");
    expect(printed).toContain("prerender: 1 rendered, 0 shell fallback(s), 1 failed");
    expect(printed).toContain("; nothing written");
  });

  it("writes every page and exits 0 when the config's onError sends the failing route to the shell", async () => {
    const { runPrerender } = await load();
    const log = vi.fn();
    const { exitCode, pages, links } = await runPrerender({
      packageRoot: FIXTURE,
      configFile: "shell.config.ts",
      log,
    });
    expect(exitCode).toBe(0);
    expect(pages.map(({ status }) => status)).toEqual(["ok", "shell"]);
    expect(read("index.html")).toContain("<rig-greeting>Rendered by the entry</rig-greeting>");
    expect(read("nucleus/broken.html")).toBe(readFileSync(path.join(FIXTURE, "site/index.html"), "utf8"));
    // each page links /nucleus/broken; the config serves /sandbox/ elsewhere
    expect(links).toEqual({ checked: 2, broken: [] });
    expect(log).toHaveBeenCalledWith("  links: 2 checked, each to a page");
  });

  it("exits 1 naming the page and its link when a written page links a page with no file", async () => {
    const { runPrerender } = await load();
    const log = vi.fn();
    const { exitCode, pages, links } = await runPrerender({
      packageRoot: FIXTURE,
      configFile: "links.config.ts",
      log,
    });
    expect(exitCode).toBe(1);
    expect(pages.map(({ status }) => status)).toEqual(["ok"]);
    expect(links).toEqual({ checked: 1, broken: [{ page: "index.html", href: "/nucleus/broken#top" }] });
    expect(log.mock.calls.map(([line]) => line).slice(-2)).toEqual([
      "  links: 1 checked, 1 to no page:",
      "    index.html → /nucleus/broken#top",
    ]);
  });

  it("asks for a config module", async () => {
    const { runPrerender } = await load();
    await expect(runPrerender({ configFile: "" })).rejects.toThrow("prerender: pass the config module");
  });

  it("runs the config given on the command line when executed directly, setting the exit code", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(FIXTURE);
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = [process.execPath, SCRIPT, "fail.config.ts"];
    vi.resetModules();
    await import("../../scripts/prerender.mjs");
    expect(process.exitCode).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 failed"));
  });
});
