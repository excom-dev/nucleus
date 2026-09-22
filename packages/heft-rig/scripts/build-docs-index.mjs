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
 *
 * Outputs (generated, not committed):
 *   - `<repo>/dist-docs/<element>.md` — flat mirror by element/mixin name
 *   - `<repo>/dist-docs/docs/<name>.md` — guides, `SITE_BASE` links
 *     rewritten to sibling files for offline reading
 *   - `<repo>/dist-docs/llms.txt` — index (guides, then elements)
 *   - `<repo>/dist-docs/llms-full.txt` — every doc inlined, `---` separated
 *   - `<repo>/packages/docs-site/dist/llms.txt` (and `llms-full.txt`)
 *     when `dist/` exists, for Cloudflare `/llms.txt`
 *
 * CI (`deploy-docs.yml`) runs this after the site build. Repo-level only —
 * sibling aggregation doesn't fit a per-package Rush phase. Per-package
 * output is source of truth; this mirrors and indexes.
 */
import { readFile, readdir, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

import { SITE_BASE, SITE_HOME_DOC } from "./site-base.mjs";

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

  const siteSections = await collectSiteDocs(repoRoot, outDir);
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
}

/**
 * Copy `llms.txt` / `llms-full.txt` into the docs-site static build when
 * that `dist/` already exists (deploy builds the site first). No-op otherwise.
 *
 * @param {string} repoRoot
 * @param {string} [srcDir]
 */
export async function copyLlmsToSiteDist(
  repoRoot,
  srcDir = path.resolve(repoRoot, "dist-docs"),
) {
  const destDir = path.resolve(repoRoot, "packages/docs-site/dist");
  if (!existsSync(destDir)) return;
  let copied = 0;
  for (const name of ["llms.txt", "llms-full.txt"]) {
    const src = path.join(srcDir, name);
    if (!existsSync(src)) continue;
    await copyFile(src, path.join(destDir, name));
    copied += 1;
  }
  if (copied) {
    console.log(`Copied ${copied} llms file(s) → packages/docs-site/dist`);
  }
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

async function collectSiteDocs(repoRoot, outDir) {
  const sectionsJson = await readJson(
    path.resolve(repoRoot, "packages/docs-site/support/docs-sections.json"),
  );
  const sections = sectionsJson?.sections ?? [];
  const srcDir = path.resolve(
    repoRoot,
    "packages/docs-site/support/dist-docs/docs",
  );
  const destDir = path.resolve(outDir, "docs");
  const byName = new Map();

  if (existsSync(srcDir)) {
    await mkdir(destDir, { recursive: true });
    for (const file of await readdir(srcDir)) {
      if (!file.endsWith(".md")) continue;
      const name = file.replace(/\.md$/, "");
      const rewritten = rewriteOfflineLinks(
        await readFile(path.resolve(srcDir, file), "utf8"),
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
 * The docs home (`SITE_BASE`) is the Introduction guide. Package sub-pages
 * (`/nucleus/packages/<pkg>/<page>`) have no offline file and stay as written.
 */
const OFFLINE_LINKS = [
  [new RegExp(`\\]\\(${SITE_BASE}/docs/([a-z0-9_]+)\\)`, "g"), "](./$1.md)"],
  [new RegExp(`\\]\\(${SITE_BASE}/packages/([a-z0-9-]+)\\)`, "g"), "](../$1.md)"],
  [new RegExp(`\\]\\(${SITE_BASE}\\)`, "g"), `](./${SITE_HOME_DOC}.md)`],
];

export function rewriteOfflineLinks(md) {
  let out = md;
  for (const [pattern, replacement] of OFFLINE_LINKS) {
    out = out.replace(pattern, replacement);
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
