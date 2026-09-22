#!/usr/bin/env node
/**
 * Aggregates each workspace package's `support/package-meta.json` into the
 * docs-site static tree for on-demand runtime fetch:
 *
 *   public/package-metas/index.json         ({ packages, docs }; a package
 *                                            entry carries `docSections` when
 *                                            its docs span several pages)
 *   public/package-metas/<shortName>.json
 *   public/package-metas/search-docs.json   (minified slim corpus, see build-search-docs.mjs)
 *
 * Run from the docs-site package root (or pass that root as cwd). Site
 * `dev` / `build` call `prepareSiteDocs` (generate metas, then this).
 */
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

import {
  buildSearchDocs,
  titleCaseKey,
  titleFromDocHtml,
} from "./build-search-docs.mjs";
import { buildPackageMetas } from "./build-package-metas.mjs";

const OUT_DIR_NAME = "package-metas";

/**
 * Site `dev` / `build` entry: emit every workspace package's CEM +
 * package-meta (dependency order), then collect them into
 * `public/package-metas/`. Fresh clones need this — the JSON is not in git.
 *
 * @param {string} [packageRoot=process.cwd()]
 */
export async function prepareSiteDocs(packageRoot = process.cwd()) {
  await buildWorkspacePackageMetas(packageRoot);
  return collectDocsMetas(packageRoot);
}

/**
 * Run `buildPackageMetas` for the site package and every `@excom/*`
 * workspace link under its `node_modules`, bases before dependents.
 *
 * @param {string} siteRoot
 */
export async function buildWorkspacePackageMetas(siteRoot) {
  const nodeModules = path.resolve(siteRoot, "node_modules/@excom");
  /** @type {{ root: string, name: string, deps: string[] }[]} */
  const items = [];
  const seen = new Set();

  const add = async (pkgRoot) => {
    let real;
    try {
      real = await realpath(pkgRoot);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    const pkgPath = path.join(real, "package.json");
    if (!(await exists(pkgPath))) return;
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    items.push({
      root: real,
      name: pkg.name,
      deps: [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ].filter((n) => n.startsWith("@excom/")),
    });
  };

  if (await exists(nodeModules)) {
    const entries = (await readdir(nodeModules, { withFileTypes: true })).filter(
      (d) => d.isDirectory() || d.isSymbolicLink(),
    );
    for (const entry of entries) {
      await add(path.join(nodeModules, entry.name));
    }
  }
  await add(siteRoot);

  for (const root of topoPackageRoots(items)) {
    await buildPackageMetas(root);
  }
}

/**
 * @param {{ root: string, name: string, deps: string[] }[]} items
 * @returns {string[]}
 */
export function topoPackageRoots(items) {
  const byName = new Map(items.map((i) => [i.name, i]));
  const visited = new Set();
  const stacked = new Set();
  const out = [];
  const visit = (item) => {
    if (visited.has(item.root) || stacked.has(item.root)) return;
    stacked.add(item.root);
    for (const dep of item.deps) {
      const next = byName.get(dep);
      if (next) visit(next);
    }
    stacked.delete(item.root);
    visited.add(item.root);
    out.push(item.root);
  };
  for (const item of items) visit(item);
  return out;
}

/**
 * @param {string} [packageRoot=process.cwd()]
 */
export async function collectDocsMetas(packageRoot = process.cwd()) {
  const nodeModules = path.resolve(packageRoot, "node_modules/@excom");
  const outDir = path.resolve(packageRoot, "public", OUT_DIR_NAME);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  if (!(await exists(nodeModules))) {
    await writeFile(
      path.join(outDir, "index.json"),
      JSON.stringify({ packages: [], docs: [] }, null, 2) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(outDir, "search-docs.json"),
      JSON.stringify(buildSearchDocs([])),
      "utf8",
    );
    console.log(`[collect-docs-metas] No @excom packages; wrote empty index.`);
    return outDir;
  }

  const entries = (await readdir(nodeModules, { withFileTypes: true })).filter(
    (d) => d.isDirectory() || d.isSymbolicLink(),
  );

  const catalog = [];
  const metas = [];
  const seen = new Set();

  const ingest = async (metaPath, fallbackName) => {
    if (!(await exists(metaPath))) return;
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    const shortName = meta.shortName || fallbackName;
    if (seen.has(shortName)) return;
    seen.add(shortName);
    metas.push(meta);
    await cp(metaPath, path.join(outDir, `${shortName}.json`));
    catalog.push({
      shortName,
      packageType: meta.package?.excom?.packageType,
      version: meta.package?.version,
      // Sidebar groups for packages whose docs span several pages.
      ...(meta.docSections?.length ? { docSections: meta.docSections } : {}),
    });
  };

  for (const entry of entries) {
    await ingest(
      path.resolve(nodeModules, entry.name, "support/package-meta.json"),
      entry.name,
    );
  }
  // Site packages are not a dependency of themselves, pick up the
  // local `support/package-meta.json` (repo architecture markdown).
  await ingest(
    path.resolve(packageRoot, "support/package-meta.json"),
    path.basename(packageRoot),
  );

  catalog.sort((a, b) => a.shortName.localeCompare(b.shortName));
  const packages = catalog.filter((c) => c.packageType !== "site");
  const docs = siteDocsFromMetas(metas);
  await writeFile(
    path.join(outDir, "index.json"),
    JSON.stringify({ packages, docs }, null, 2) + "\n",
    "utf8",
  );

  metas.sort((a, b) => (a.shortName ?? "").localeCompare(b.shortName ?? ""));
  const searchJson = JSON.stringify(buildSearchDocs(metas));
  await writeFile(path.join(outDir, "search-docs.json"), searchJson, "utf8");

  console.log(
    `[collect-docs-metas] Wrote ${packages.length} package metas + ${docs.length} site docs → ${path.relative(packageRoot, outDir)}`,
  );
  console.log(
    `[collect-docs-metas] Wrote search-docs.json (${(searchJson.length / 1024).toFixed(1)} kB)`,
  );
  return outDir;
}

function siteDocsFromMetas(metas) {
  const docs = [];
  for (const meta of metas) {
    if (meta.package?.excom?.packageType !== "site") continue;
    for (const [name, html] of Object.entries(meta.docs ?? {})) {
      docs.push({
        name,
        title: titleFromDocHtml(html) || titleCaseKey(name),
      });
    }
  }
  docs.sort((a, b) => a.name.localeCompare(b.name));
  return docs;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const resolvedArg = path.resolve(process.cwd(), process.argv[1]);
    const thisFile = fileURLToPath(import.meta.url);
    const [argRealPath, fileRealPath] = await Promise.all([
      realpath(resolvedArg),
      realpath(thisFile),
    ]);
    return argRealPath === fileRealPath;
  } catch {
    return false;
  }
}

if (await isMain()) {
  await collectDocsMetas();
}
