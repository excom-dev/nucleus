#!/usr/bin/env node
/**
 * npm-facing `packages/<pkg>/README.md`, generated at publish time.
 *
 * npmjs.com renders only a package-root `README.md`; ours live at
 * `support/docs/README.md`, so every package shows "No README data found".
 * This writes the root file npm wants from the docs the pipeline already
 * produces. Generated, never committed (see the root `.gitignore`) — npm
 * packs `README.md` regardless of `files`, so nothing else has to change.
 *
 * Inputs (first one that exists wins, per package):
 *   - `<repo>/packages/<pkg>/support/dist-docs/<element>.md` — per-element
 *     docs from `build:docs`. Concatenated: the file named after the package
 *     first, then the rest alphabetically, separated by `---`.
 *   - `<repo>/packages/<pkg>/support/docs/README.md` — the hand-written
 *     overview / page index, used verbatim. Library packages (quark,
 *     neutron, quark-parser, valence, …) have no CEM and so no per-element
 *     docs; this is their source.
 *
 * Skipped: `"private": true` packages, directories with no `package.json`,
 * and packages with neither source.
 *
 * Outputs (generated, not committed):
 *   - `<repo>/packages/<pkg>/README.md`
 *
 * Link rewriting — npm renders the README off-site, so every in-repo link
 * is made absolute against `https://excom.dev`:
 *   - `/nucleus/docs/<x>`, `/nucleus/packages/<x>[/<page>]`, any root-relative
 *     path → `https://excom.dev<path>`
 *   - `./PAGE.md[#hash]` (the site maps these to package sub-pages, see
 *     `rewriteDocLinks` in `build-package-metas.mjs`) →
 *     `https://excom.dev/nucleus/packages/<pkg>/<page>[#hash]`;
 *     `./README.md` → `https://excom.dev/nucleus/packages/<pkg>`
 *   - any other relative reference (images, assets) → resolved against
 *     `https://excom.dev/nucleus/packages/<pkg>/`
 *   - `http(s):`, `mailto:`, other schemes, `//host` and `#hash` are left as
 *     written
 * Only Markdown link/image targets (`](…)`) are touched, so HTML `src` /
 * `href` inside fenced demo source is left alone.
 *
 * Runs in `publish.yml` (Release) after `build:docs-index`, once the version bump is applied.
 * Repo-level only, like `build-docs-index.mjs` — a per-package Rush phase
 * would not know the sibling packages. Idempotent.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

import { SITE_BASE } from "./site-base.mjs";

/** Origin the published docs are served from. */
export const SITE_ORIGIN = "https://excom.dev";

/** `scheme:`, `//host` and same-page `#hash` targets are already final. */
const NON_RELATIVE = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** A sibling docs page: `PAGE.md`, `./PAGE.md`, either with a `#hash`. */
const DOC_PAGE = /^(?:\.\/)?([\w-]+)\.md(#.*)?$/i;

/** Markdown inline link / image target, with an optional `"title"`. */
const MD_TARGET = /(!?\]\()([^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?\))/g;

export async function buildNpmReadmes(repoRoot = findRepoRoot()) {
  const packagesDir = path.resolve(repoRoot, "packages");
  let written = 0;
  let skipped = 0;

  for (const dir of (await readdir(packagesDir)).sort()) {
    const packageRoot = path.resolve(packagesDir, dir);
    const pkg = await readJson(path.resolve(packageRoot, "package.json"));
    if (!pkg?.name || pkg.private) {
      skipped += 1;
      continue;
    }
    const shortName = pkg.name.replace(/^@[^/]+\//, "");
    const body = await readReadmeBody(packageRoot, shortName);
    if (!body) {
      skipped += 1;
      continue;
    }
    await writeFile(
      path.resolve(packageRoot, "README.md"),
      `${rewriteNpmLinks(body, shortName)}\n\n---\n\n${footer(shortName)}\n`,
      "utf8",
    );
    written += 1;
  }

  console.log(
    `Generated ${written} npm README(s) in packages/ (${skipped} package(s) skipped)`,
  );
  return written;
}

/** `Full documentation: …` — the one line appended to every generated README. */
export function footer(shortName) {
  return `Full documentation: ${packageUrl(shortName)}`;
}

function packageUrl(shortName) {
  return `${SITE_ORIGIN}${SITE_BASE}/packages/${shortName}`;
}

/**
 * Per-element docs concatenated (package's own element first, the rest
 * alphabetically), else the hand-written overview, else `undefined`.
 */
async function readReadmeBody(packageRoot, shortName) {
  const distDocs = path.resolve(packageRoot, "support/dist-docs");
  if (existsSync(distDocs)) {
    const files = orderDocs(
      (await readdir(distDocs)).filter((f) => f.endsWith(".md")),
      shortName,
    );
    if (files.length) {
      const parts = [];
      for (const file of files) {
        parts.push((await readFile(path.resolve(distDocs, file), "utf8")).trim());
      }
      return parts.filter(Boolean).join("\n\n---\n\n");
    }
  }
  const overview = path.resolve(packageRoot, "support/docs/README.md");
  if (!existsSync(overview)) return undefined;
  const md = (await readFile(overview, "utf8")).trim();
  return md || undefined;
}

/** `<shortName>.md` first (the package's primary element), then A→Z. */
export function orderDocs(files, shortName) {
  const primary = `${shortName}.md`;
  const rest = files.filter((f) => f !== primary).sort((a, b) => a.localeCompare(b));
  return files.includes(primary) ? [primary, ...rest] : rest;
}

/**
 * Make every in-repo Markdown link absolute so it resolves on npmjs.com.
 * See the link-rewriting notes in this file's header.
 *
 * @param {string} md
 * @param {string} shortName package name without the `@excom/` scope
 */
export function rewriteNpmLinks(md, shortName) {
  return md.replace(MD_TARGET, (full, open, target, close) => {
    const next = npmLinkTarget(target, shortName);
    return next === undefined ? full : `${open}${next}${close}`;
  });
}

/** `undefined` when the target is already final and must be left alone. */
function npmLinkTarget(target, shortName) {
  if (NON_RELATIVE.test(target)) return undefined;
  if (target.startsWith("/")) return `${SITE_ORIGIN}${target}`;

  const page = target.match(DOC_PAGE);
  if (page) {
    const key = page[1].toLowerCase();
    const hash = page[2] ?? "";
    return key === "readme"
      ? `${packageUrl(shortName)}${hash}`
      : `${packageUrl(shortName)}/${key}${hash}`;
  }

  // Images and other relative assets: resolve against the package's page.
  try {
    return new URL(target, `${packageUrl(shortName)}/`).href;
  } catch {
    return undefined;
  }
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
  await buildNpmReadmes();
}
