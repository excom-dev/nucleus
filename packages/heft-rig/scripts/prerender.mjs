#!/usr/bin/env node
/**
 * `npm run build:prerender`: static HTML for every route of a built site,
 * from `@excom/nucleus-ssr`. Run from the package directory:
 *
 *   node node_modules/@excom/heft-rig/scripts/prerender.mjs <config>
 *
 * `<config>` (relative to the package) default-exports the `prerender()`
 * options, or a function returning them. The config, its `entry` and
 * nucleus-ssr load from workspace source through Vite's module runner with
 * the test aliases (`@excom/x` → `packages/x/index.ts`): no published
 * `exports` map needed. Prints one line per page and a summary. Exits 1 when
 * a page failed, a route has no file, or a written page links a page of the
 * site that has no file (see `checkLinks`); a page `onError` sends to the
 * shell is a fallback, not a failure.
 *
 * Besides the `prerender()` options, the config's object may hold
 * `servedElsewhere(absoluteUrl)`, kept from `prerender()`: true for the URLs
 * the site serves without a file of their own (a service worker, a host
 * rewrite), which the link check skips.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
import { createRigViteConfig } from "./vite-config.mjs";

/** Pages listed by size in the summary. */
const LARGEST = 3;

/**
 * A Vite module runner over workspace source, resolving like the package's
 * tests. Third-party dependencies load natively.
 * @param {string} packageRoot
 * @returns {Promise<{ import: (id: string) => Promise<any>, close: () => Promise<void> }>}
 */
export async function createWorkspaceRunner(packageRoot) {
  const { resolve } = await createRigViteConfig({ mode: "test", root: packageRoot });
  const config = await resolveConfig(
    {
      configFile: false,
      envDir: false,
      root: packageRoot,
      logLevel: "warn",
      resolve,
      environments: {
        prerender: {
          consumer: "server",
          dev: { moduleRunnerTransform: true },
          resolve: { external: true, mainFields: [], conditions: ["node"] },
        },
      },
    },
    "serve",
  );
  const environment = createRunnableDevEnvironment("prerender", config, {
    runnerOptions: { hmr: false },
    hot: false,
  });
  await environment.init();
  return {
    import: (id) => environment.runner.import(id),
    close: () => environment.close(),
  };
}

/**
 * The `prerender()` options a config module default-exports (an object, or
 * a function returning one).
 * @param {{ import: (id: string) => Promise<any> }} runner
 * @param {string} file absolute path
 */
export async function loadPrerenderConfig(runner, file) {
  const { default: config } = await runner.import(file);
  const options = await (typeof config === "function" ? config() : config);
  if (!options?.routes) throw new Error(`prerender: ${file} exports no options with routes`);
  return options;
}

/** `onError` as a function of the page URL. */
const policyOf = ({ onError = "fail" }) =>
  typeof onError === "function" ? onError : () => onError;

/** An absolute path from a path (cwd-relative) or a `file:` URL, as nucleus-ssr reads `out`. */
const pathOf = (location) =>
  String(location).startsWith("file:") ? fileURLToPath(location) : path.resolve(String(location));

/**
 * Each page's outcome: `ok`, `shell` (it failed and `onError` sent it to the
 * shell) or `failed` (it failed, or its file is missing). `written: false`:
 * nucleus-ssr wrote nothing (a page failed), so no file is expected.
 * @param {{ pages: { url: string, file: string, diagnostics: { errors: string[] } }[] }} report
 * @param {{ out: string | URL, onError?: string | ((url: string) => string) }} options
 * @param {boolean} [written]
 */
export function classifyPages({ pages }, options, written = true) {
  const policy = policyOf(options);
  const out = pathOf(options.out);
  return pages.map((page) => {
    const { errors } = page.diagnostics;
    const missing = written && !existsSync(path.join(out, page.file));
    const failed = (errors.length && policy(page.url) !== "shell") || missing;
    return {
      ...page,
      status: failed ? "failed" : errors.length ? "shell" : "ok",
      problems: errors.length ? errors : missing ? [`no file at ${page.file}`] : [],
    };
  });
}

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/**
 * One line per page, its errors indented under it, then the summary:
 * counts, time, whether files were written, the largest pages and islands,
 * each distinct warning.
 * @param {ReturnType<typeof classifyPages>} pages
 * @param {number} ms
 * @param {boolean} [written]
 */
export function formatReport(pages, ms, written = true) {
  const width = Math.max(0, ...pages.map(({ file }) => file.length));
  const lines = pages.flatMap(({ file, bytes, ms: pageMs, status, problems, diagnostics }) => [
    [
      `  ${status.padEnd(6)} ${file.padEnd(width)}`,
      (bytes ? kB(bytes) : "-").padStart(10),
      `${pageMs} ms`.padStart(9),
      diagnostics.islandBytes ? ` island ${kB(diagnostics.islandBytes)}` : "",
      diagnostics.warnings.length ? ` ${diagnostics.warnings.length} warning(s)` : "",
    ].join(""),
    ...(status === "ok" ? [] : problems.map((problem) => `           ${problem}`)),
  ]);
  const count = (status) => pages.filter((page) => page.status === status).length;
  const largest = (size) =>
    [...pages]
      .sort((a, b) => size(b) - size(a))
      .slice(0, LARGEST)
      .filter((page) => size(page))
      .map((page) => `${page.file} ${kB(size(page))}`)
      .join(", ");
  const warnings = Map.groupBy(
    pages.flatMap(({ diagnostics }) => diagnostics.warnings),
    (warning) => warning,
  );
  return [
    ...lines,
    `prerender: ${count("ok")} rendered, ${count("shell")} shell fallback(s), ${count("failed")} failed, in ${(ms / 1000).toFixed(1)} s${written ? "" : "; nothing written"}`,
    `  largest pages: ${largest(({ bytes }) => bytes)}`,
    `  largest islands: ${largest(({ diagnostics }) => diagnostics.islandBytes)}`,
    ...[...warnings].map(([warning, all]) => `  warning ×${all.length}: ${warning}`),
  ];
}

/** Markup that is never part of the page: comments, scripts (the island too), styles. */
const UNRENDERED = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** A `<template>` start or end tag; quoted attribute values may hold `>`. */
const TEMPLATE_TAG = /<template\b((?:[^>"']|"[^"]*"|'[^']*')*)>|<\/template\s*>/gi;
/** A `<spa-a>` or `<a>` start tag, with its attributes. */
const LINK_TAG = /<(spa-a|a)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
/** A last path segment with a file extension: `.md`, `.txt`, `.xml`… */
const EXTENSION = /\.[^/.]+$/;
const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

/**
 * The markup a visitor gets: without `UNRENDERED` and without the content of
 * `<template>`s, which is inert (a declarative shadow root's is not).
 * @param {string} html
 */
export function liveMarkup(html) {
  const source = html.replace(UNRENDERED, "");
  // per open template: whether its content is inert
  const open = [];
  let live = "";
  let from = 0;
  for (const tag of source.matchAll(TEMPLATE_TAG)) {
    if (!open.includes(true)) live += source.slice(from, tag.index);
    if (tag[0][1] === "/") open.pop();
    else open.push(!/(?:^|\s)shadowrootmode\s*=/i.test(tag[1]));
    from = tag.index + tag[0].length;
  }
  return open.includes(true) ? live : live + source.slice(from);
}

/** `&amp;`, `&quot;`, `&#39;`, `&#x41;`… decoded. */
const decodeEntities = (value) =>
  value.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|quot|apos|lt|gt));/gi, (entity, decimal, hex, name) =>
    name ? ENTITIES[name.toLowerCase()] : String.fromCodePoint(decimal ? Number(decimal) : parseInt(hex, 16)),
  );

/** An attribute's value from a start tag's attributes, entities decoded; `undefined` when absent. */
const attributeOf = (attributes, name) => {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i");
  const [, double, single, bare] = pattern.exec(attributes) ?? [];
  const value = double ?? single ?? bare;
  return value === undefined ? undefined : decodeEntities(value);
};

/** Every `.html` file under `dir`, as `/`-separated paths relative to it. */
const htmlFiles = (dir) =>
  new Set(
    readdirSync(dir, { recursive: true })
      .map((file) => String(file).replaceAll("\\", "/"))
      .filter((file) => file.endsWith(".html")),
  );

/** Whether a path has a page: `/` → `index.html`, `/a/b` and `/a/b/` → `a/b.html` or `a/b/index.html`. */
const hasPage = (files, pathname) => {
  const route = pathname.replace(/^\/+|\/+$/g, "");
  return route ? files.has(`${route}.html`) || files.has(`${route}/index.html`) : files.has("index.html");
};

const decodePath = (pathname) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

/**
 * The links of the written pages to pages of the site that have no file in
 * `out`: each `<spa-a route-href>` and `<a href>` of the live markup (see
 * `liveMarkup`) that resolves, against its page's URL, to `origin`. The
 * fragment and query are ignored; paths with a file extension and URLs
 * `servedElsewhere` accepts are not checked. Pages without a file are skipped.
 * Each broken link is listed once per page, as written.
 * @param {{ url: string, file: string }[]} pages
 * @param {{ out: string | URL, origin: string, servedElsewhere?: (absoluteUrl: string) => boolean }} options
 * @returns {{ checked: number, broken: { page: string, href: string }[] }}
 */
export function checkLinks(pages, { out, origin, servedElsewhere = () => false }) {
  const outPath = pathOf(out);
  const files = htmlFiles(outPath);
  const site = new URL(origin).origin;
  let checked = 0;
  const broken = [];
  for (const { url, file } of pages) {
    const target = path.join(outPath, file);
    if (!existsSync(target)) continue;
    const base = new URL(url, site);
    const listed = new Set();
    for (const [, tag, attributes] of liveMarkup(readFileSync(target, "utf8")).matchAll(LINK_TAG)) {
      const href = attributeOf(attributes, tag.toLowerCase() === "a" ? "href" : "route-href");
      if (href === undefined || !URL.canParse(href, base)) continue;
      const link = new URL(href, base);
      const pathname = decodePath(link.pathname);
      if (link.origin !== site || EXTENSION.test(pathname) || servedElsewhere(link.href)) continue;
      checked += 1;
      if (hasPage(files, pathname) || listed.has(href)) continue;
      listed.add(href);
      broken.push({ page: file, href });
    }
  }
  return { checked, broken };
}

/**
 * The link check's lines: the count, then each link to no file under the
 * page that has it.
 * @param {ReturnType<typeof checkLinks>} links
 */
export function formatLinks({ checked, broken }) {
  if (!broken.length) return [`  links: ${checked} checked, each to a page`];
  return [
    `  links: ${checked} checked, ${broken.length} to no page:`,
    ...broken.map(({ page, href }) => `    ${page} → ${href}`),
  ];
}

/**
 * Loads `configFile` and prerenders, then checks the written pages' links
 * (`checkLinks`). Resolves to the classified pages, the link check (none
 * when nothing was written) and the exit code: 1 when a page failed or a
 * link leads to no page.
 * @param {{ packageRoot?: string, configFile: string, log?: (line: string) => void }} options
 */
export async function runPrerender({ packageRoot = process.cwd(), configFile, log = console.log }) {
  if (!configFile) throw new Error("prerender: pass the config module, e.g. support/prerender/prerender.config.ts");
  const runner = await createWorkspaceRunner(packageRoot);
  try {
    const { servedElsewhere, ...options } = await loadPrerenderConfig(
      runner,
      path.resolve(packageRoot, configFile),
    );
    const { prerender } = await runner.import("@excom/nucleus-ssr");
    const started = performance.now();
    let written = true;
    // a page failure rejects once every route ran, writing nothing, with the report
    const report = await prerender(options).catch((error) => {
      if (!error?.report) throw error;
      written = false;
      return error.report;
    });
    const pages = classifyPages(report, options, written);
    formatReport(pages, performance.now() - started, written).forEach((line) => log(line));
    const links = written ? checkLinks(pages, { ...options, servedElsewhere }) : undefined;
    if (links) formatLinks(links).forEach((line) => log(line));
    const failed = pages.some(({ status }) => status === "failed") || !!links?.broken.length;
    return { pages, links, exitCode: failed ? 1 : 0 };
  } finally {
    await runner.close();
  }
}

function isMain() {
  try {
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const { exitCode } = await runPrerender({ configFile: process.argv[2] });
  process.exitCode = exitCode;
}
