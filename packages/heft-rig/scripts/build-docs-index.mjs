#!/usr/bin/env node
/**
 * Per-element Markdown → `<repo>/dist-docs/`, plus `llms.txt` and
 * `llms-full.txt` for AI consumers.
 *
 * Inputs:
 *   - `<repo>/packages/<pkg>/support/dist-docs/<element>.md` — per-element
 *     docs from `build:docs`. Multi-element packages emit several files.
 *   - `<repo>/packages/docs-site/support/dist-docs/docs/<name>.md` —
 *     top-level guides (docs-site `build:docs`)
 *   - `<repo>/packages/docs-site/support/docs-sections.json` — guide order
 *     (same as the site sidebar)
 *   - `<repo>/packages/<pkg>/support/custom-elements.json` — summaries
 *     for index entries
 *   - `<repo>/packages/docs-site/index.html` — the example apps: every
 *     `<spa-route route-href="/nucleus/examples/<slug>" data-app="<app>">`,
 *     named by the sidebar `<spa-a>` linking the same route; sources from
 *     `packages/docs-site/public/views/<app>/`
 *   - `<repo>/packages/docs-site/dist/package-metas/index.json` — the
 *     documented packages and their `docSections` (sitemap only)
 *
 * Outputs (generated, not committed):
 *   - `<repo>/dist-docs/<element>.md` — flat mirror by element/mixin name
 *   - `<repo>/dist-docs/docs/<name>.md` — guides, `SITE_BASE` links
 *     rewritten to sibling files for offline reading, and each example-app
 *     playground (`<include-content … data-app="<app>">`) replaced by a
 *     Markdown line linking that app's sources
 *   - `<repo>/dist-docs/docs/examples/<app>/` — every example app's view
 *     folder (`.html`, `.quark`, `.css`, `.js`), for reading, not running
 *   - `<repo>/dist-docs/llms.txt` — index (guides, then elements)
 *   - `<repo>/dist-docs/llms-full.txt` — every doc inlined, `---` separated
 *   - `<repo>/packages/docs-site/dist/llms.txt` (and `llms-full.txt`)
 *     when `dist/` exists, for Cloudflare `/llms.txt`
 *   - `<repo>/packages/docs-site/dist/<element>.md`, `docs/<name>.md` and
 *     `docs/examples/<app>/` when `dist/` exists — the Markdown mirror, so
 *     the relative links inside `llms.txt` and the guides resolve on the
 *     deployed site instead of falling through to the SPA
 *   - `<repo>/packages/docs-site/dist/sitemap.xml` when `dist/` exists —
 *     the site root, the docs home, every guide, package, package doc page
 *     and example route
 *
 * CI (`deploy-docs.yml`) runs this after the site build. Repo-level only —
 * sibling aggregation doesn't fit a per-package Rush phase. Per-package
 * output is source of truth; this mirrors and indexes.
 */
import { readFile, readdir, mkdir, writeFile, copyFile, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

import { SITE_ORIGIN } from "./build-npm-readmes.mjs";
import { SITE_BASE, SITE_HOME_DOC } from "./site-base.mjs";

const SITE_PACKAGE = "packages/docs-site";

export async function buildDocsIndex(repoRoot = findRepoRoot()) {
  const packagesDir = path.resolve(repoRoot, "packages");
  const outDir = path.resolve(repoRoot, "dist-docs");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const entries = [];
  for (const pkg of await readdir(packagesDir)) {
    const supportDir = path.resolve(packagesDir, pkg, "support");
    const mdDir = path.resolve(supportDir, "dist-docs");
    if (!existsSync(mdDir)) continue;

    const cem = await readJson(path.resolve(supportDir, "custom-elements.json"));
    const summaryByName = indexSummaries(cem);

    for (const file of await readdir(mdDir)) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      await copyFile(
        path.resolve(mdDir, file),
        path.resolve(outDir, file),
      );
      entries.push({
        pkg,
        name,
        summary: summaryByName.get(name),
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const examples = await readExampleApps(repoRoot);
  await copyExampleApps(repoRoot, examples, path.resolve(outDir, "docs/examples"));
  const siteSections = await collectSiteDocs(repoRoot, outDir, examples);
  const siteCount = siteSections.reduce((n, s) => n + s.docs.length, 0);

  const llmsTxt = [
    "# @excom",
    "",
    "> Nucleus Stack. Guides first, then each element or mixin reference (API, prose, demo source).",
    "",
    ...renderDocsIndex(siteSections),
    "## Elements",
    "",
    ...entries.map((e) => {
      const tail = e.summary ? ` — ${e.summary}` : "";
      return `- [${e.name}](./${e.name}.md)${tail}`;
    }),
    "",
  ].join("\n");
  await writeFile(path.resolve(outDir, "llms.txt"), llmsTxt, "utf8");

  const fullParts = [];
  for (const section of siteSections) {
    for (const doc of section.docs) {
      fullParts.push(
        await readFile(path.resolve(outDir, "docs", `${doc.name}.md`), "utf8"),
      );
      fullParts.push("\n---\n");
    }
  }
  for (const { name } of entries) {
    fullParts.push(await readFile(path.resolve(outDir, `${name}.md`), "utf8"));
    fullParts.push("\n---\n");
  }
  await writeFile(
    path.resolve(outDir, "llms-full.txt"),
    fullParts.join("\n"),
    "utf8",
  );

  console.log(
    `Indexed ${entries.length} element docs + ${siteCount} site docs into ${path.relative(repoRoot, outDir)}\n` +
      `  llms.txt\n` +
      `  llms-full.txt`,
  );

  await copyLlmsToSiteDist(repoRoot, outDir);
  await writeSitemap(repoRoot, { siteSections, examples });
}

/**
 * Copy `llms.txt` / `llms-full.txt` plus the Markdown mirror into the
 * docs-site static build when that `dist/` already exists (deploy builds
 * the site first). No-op otherwise.
 *
 * The index links are relative — `./<element>.md` and `./docs/<name>.md` —
 * so the `.md` files have to sit beside `llms.txt` in `dist/`, otherwise
 * every link is served the SPA fallback. The guides link the example apps
 * as `./examples/<app>/<app>.html`, so `docs/examples/` is mirrored too.
 *
 * @param {string} repoRoot
 * @param {string} [srcDir]
 */
export async function copyLlmsToSiteDist(
  repoRoot,
  srcDir = path.resolve(repoRoot, "dist-docs"),
) {
  const destDir = path.resolve(repoRoot, SITE_PACKAGE, "dist");
  if (!existsSync(destDir)) return;
  let copied = 0;
  for (const name of ["llms.txt", "llms-full.txt"]) {
    const src = path.join(srcDir, name);
    if (!existsSync(src)) continue;
    await copyFile(src, path.join(destDir, name));
    copied += 1;
  }
  let mirrored = 0;
  for (const rel of ["", "docs"]) {
    const from = path.join(srcDir, rel);
    if (!existsSync(from)) continue;
    const to = path.join(destDir, rel);
    let made = false;
    for (const file of await readdir(from)) {
      if (!file.endsWith(".md")) continue;
      if (!made) {
        await mkdir(to, { recursive: true });
        made = true;
      }
      await copyFile(path.join(from, file), path.join(to, file));
      mirrored += 1;
    }
  }
  let apps = 0;
  const examplesFrom = path.join(srcDir, "docs/examples");
  if (existsSync(examplesFrom)) {
    const examplesTo = path.join(destDir, "docs/examples");
    await rm(examplesTo, { recursive: true, force: true });
    await cp(examplesFrom, examplesTo, { recursive: true });
    apps = (await readdir(examplesFrom)).length;
  }
  if (copied || mirrored || apps) {
    console.log(
      `Copied ${copied} llms file(s) + ${mirrored} markdown file(s) + ${apps} example app(s) → ${SITE_PACKAGE}/dist`,
    );
  }
}

// --- Example apps ---------------------------------------------------------

/** Source-link labels, in link order; other files are copied but not linked. */
const EXAMPLE_SOURCES = [
  ["html", "HTML"],
  ["quark", "Quark"],
  ["css", "CSS"],
  ["js", "JS"],
];

/**
 * The example apps the site routes under `SITE_BASE/examples/`, from the
 * docs-site `index.html`: each `<spa-route>` whose `route-href` is an
 * example route and that names its app in `data-app`. The human name is the
 * text of the sidebar `<spa-a>` linking the same route. Apps without a
 * `public/views/<app>/<app>.html` are dropped, so the playground chrome
 * (`live-app`, `live-demo`) never counts — it is a `template-ref`, not a
 * `data-app`.
 *
 * @param {string} repoRoot
 * @returns {Promise<{ app: string, route: string, name: string, files: string[] }[]>}
 */
export async function readExampleApps(repoRoot) {
  const siteRoot = path.resolve(repoRoot, SITE_PACKAGE);
  const source = await readIfExists(path.join(siteRoot, "index.html"));
  if (!source) return [];
  const html = source.replace(/<!--[\s\S]*?-->/g, "");

  const linkText = new Map();
  for (const [, attrs, text] of html.matchAll(/<spa-a\b([^>]*)>([^<]*)<\/spa-a>/gi)) {
    const href = getAttr(attrs, "route-href");
    if (href && text.trim() && !linkText.has(href)) linkText.set(href, text.trim());
  }

  const prefix = `${SITE_BASE}/examples/`;
  const apps = [];
  for (const [, attrs] of html.matchAll(/<spa-route\b([^>]*)>/gi)) {
    const route = getAttr(attrs, "route-href");
    const app = getAttr(attrs, "data-app");
    if (!route?.startsWith(prefix) || !app) continue;
    const dir = path.join(siteRoot, "public/views", app);
    if (!existsSync(path.join(dir, `${app}.html`))) continue;
    apps.push({
      app,
      route,
      name: linkText.get(route) ?? titleFromApp(app),
      files: (await readdir(dir)).sort(),
    });
  }
  return apps;
}

/** `flight-booker-app` → `Flight Booker`, when the sidebar has no link. */
function titleFromApp(app) {
  return app
    .replace(/-app$/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Each app's whole view folder → `<destDir>/<app>/`. */
async function copyExampleApps(repoRoot, examples, destDir) {
  for (const { app } of examples) {
    await cp(
      path.resolve(repoRoot, SITE_PACKAGE, "public/views", app),
      path.join(destDir, app),
      { recursive: true },
    );
  }
}

/**
 * The Markdown line standing in for an example app's playground, linking the
 * copies beside the guide (`./examples/<app>/…`, relative, so it resolves in
 * `dist-docs/docs/` and under `/docs/` on the site alike).
 */
export function exampleAppLine({ app, name, files }) {
  const href = (ext) => `./examples/${app}/${app}.${ext}`;
  const sources = EXAMPLE_SOURCES.filter(([ext]) => files.includes(`${app}.${ext}`))
    .map(([ext, label]) => `[${label}](${href(ext)})`)
    .join(" · ");
  return `[Open the ${name} example app](${href("html")}) — source: ${sources}`;
}

/*
 * A fenced code block, an inline code span, or an empty
 * `<include-content …>` / self-closing element. Code is matched only so it
 * can be passed through untouched — docs that teach the playground markup
 * keep it.
 */
const PLAYGROUND_OR_CODE =
  /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$|`[^`\n]*`|<include-content\b([^>]*?)(?:\/>|>\s*<\/include-content>)/gm;

/**
 * Replace every example-app playground (`<include-content … data-app="<app>">`)
 * with `exampleAppLine`. Unknown apps and other includes stay as written.
 *
 * @param {string} md
 * @param {{ app: string, name: string, files: string[] }[]} examples
 */
export function linkExampleApps(md, examples) {
  if (!examples.length) return md;
  const byApp = new Map(examples.map((e) => [e.app, e]));
  return md.replace(PLAYGROUND_OR_CODE, (full, fence, attrs) => {
    if (fence || attrs === undefined) return full;
    const example = byApp.get(getAttr(attrs, "data-app"));
    return example ? exampleAppLine(example) : full;
  });
}

function getAttr(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i");
  return attrs.match(re)?.[1];
}

// --- Sitemap ------------------------------------------------------------

/**
 * `<site dist>/sitemap.xml` when the site build exists: the site root, the
 * docs home, every guide, every documented package with the doc pages its
 * `docSections` lists (the site's own `package-metas/index.json`, i.e.
 * exactly what the deployed sidebar offers), and every example route.
 */
async function writeSitemap(repoRoot, { siteSections, examples }) {
  const distDir = path.resolve(repoRoot, SITE_PACKAGE, "dist");
  if (!existsSync(distDir)) return;
  const metas = await readJson(path.join(distDir, "package-metas/index.json"));

  const routes = ["/", SITE_BASE];
  for (const section of siteSections) {
    for (const { name } of section.docs) {
      if (name !== SITE_HOME_DOC) routes.push(`${SITE_BASE}/docs/${name}`);
    }
  }
  for (const pkg of metas?.packages ?? []) {
    const base = `${SITE_BASE}/packages/${pkg.shortName}`;
    routes.push(base);
    for (const section of pkg.docSections ?? []) {
      for (const { name } of section.docs ?? []) {
        if (name !== "readme") routes.push(`${base}/${name}`);
      }
    }
  }
  for (const { route } of examples) routes.push(route);

  const urls = [...new Set(routes)].map(
    (route) => `  <url><loc>${escapeXml(SITE_ORIGIN + route)}</loc></url>`,
  );
  await writeFile(
    path.join(distDir, "sitemap.xml"),
    [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      ...urls,
      `</urlset>`,
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`Wrote ${urls.length} URL(s) → ${SITE_PACKAGE}/dist/sitemap.xml`);
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// name→summary by tag and kebab declaration name, so either matches the
// Markdown filename from `build-docs.mjs`.
function indexSummaries(cem) {
  const out = new Map();
  for (const mod of cem?.modules ?? []) {
    for (const decl of mod.declarations ?? []) {
      const summary = decl.summary;
      if (!summary) continue;
      if (decl.tagName) out.set(decl.tagName, summary);
      if (decl.name) out.set(camelToKebab(decl.name), summary);
    }
  }
  return out;
}

function camelToKebab(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

async function collectSiteDocs(repoRoot, outDir, examples) {
  const sectionsJson = await readJson(
    path.resolve(repoRoot, SITE_PACKAGE, "support/docs-sections.json"),
  );
  const sections = sectionsJson?.sections ?? [];
  const srcDir = path.resolve(repoRoot, SITE_PACKAGE, "support/dist-docs/docs");
  const destDir = path.resolve(outDir, "docs");
  const byName = new Map();

  if (existsSync(srcDir)) {
    await mkdir(destDir, { recursive: true });
    for (const file of await readdir(srcDir)) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      const rewritten = rewriteOfflineLinks(
        linkExampleApps(await readFile(path.resolve(srcDir, file), "utf8"), examples),
        examples,
      );
      await writeFile(path.resolve(destDir, file), rewritten, "utf8");
      byName.set(name, {
        name,
        title: headingTitle(rewritten) || name,
        summary: firstProseSentence(rewritten),
      });
    }
  }

  const listed = [];
  for (const section of sections) {
    const docs = section.docs.flatMap((name) => {
      const entry = byName.get(name);
      return entry ? [entry] : [];
    });
    if (docs.length) listed.push({ id: section.id, title: section.title, docs });
  }
  const seen = new Set(sections.flatMap((s) => s.docs));
  const more = [...byName.values()].filter((d) => !seen.has(d.name));
  if (more.length) listed.push({ id: "more", title: "More", docs: more });
  return listed;
}

function renderDocsIndex(sections) {
  if (!sections.length) return [];
  const lines = ["## Docs", ""];
  for (const section of sections) {
    lines.push(`### ${section.title}`, "");
    for (const doc of section.docs) {
      const tail = doc.summary ? ` — ${doc.summary}` : "";
      lines.push(`- [${doc.title}](./docs/${doc.name}.md)${tail}`);
    }
    lines.push("");
  }
  return lines;
}

/**
 * Site routes in a guide → the mirrored files beside it in `dist-docs/docs/`.
 * The docs home (`SITE_BASE`) is the Introduction guide; an example route
 * (`/nucleus/examples/<slug>`) is its app's copied HTML when `examples`
 * names it. Package sub-pages (`/nucleus/packages/<pkg>/<page>`) have no
 * offline file and stay as written.
 */
const OFFLINE_LINKS = [
  [new RegExp(`\\]\\(${SITE_BASE}/docs/([a-z0-9_]+)\\)`, "g"), "](./$1.md)"],
  [new RegExp(`\\]\\(${SITE_BASE}/packages/([a-z0-9-]+)\\)`, "g"), "](../$1.md)"],
  [new RegExp(`\\]\\(${SITE_BASE}\\)`, "g"), `](./${SITE_HOME_DOC}.md)`],
];

export function rewriteOfflineLinks(md, examples = []) {
  let out = md;
  for (const [pattern, replacement] of OFFLINE_LINKS) {
    out = out.replace(pattern, replacement);
  }
  for (const { app, route } of examples) {
    out = out.replaceAll(`](${route})`, `](./examples/${app}/${app}.html)`);
  }
  return out;
}

function headingTitle(md) {
  return md.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function firstProseSentence(md) {
  const body = md.replace(/^#\s+.+\n+/, "").replace(/^>\s*/gm, "");
  const para = body.split(/\n\n/)[0]?.replace(/\n/g, " ").replace(/[*_`]/g, "") ?? "";
  return (para.match(/^[^.!?]+[.!?]/)?.[0] ?? para).trim();
}

function findRepoRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.resolve(dir, "rush.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not find rush.json from cwd: " + process.cwd());
}

async function readJson(p) {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return undefined;
  }
}

async function readIfExists(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return undefined;
  }
}

async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const resolvedArg = path.resolve(process.cwd(), process.argv[1]);
    const thisFile = fileURLToPath(import.meta.url);
    const [argReal, fileReal] = await Promise.all([
      realpath(resolvedArg),
      realpath(thisFile),
    ]);
    return argReal === fileReal;
  } catch {
    return false;
  }
}

if (await isMain()) {
  await buildDocsIndex();
}
