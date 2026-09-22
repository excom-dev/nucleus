#!/usr/bin/env node
/**
 * Writes `support/custom-elements.json` (CEM v1.0.0). Called by
 * `build-package-metas.mjs`; also standalone. One module per Neutron source
 * at the package root. Generated (gitignored); site `dev`/`build` and CI
 * (`build:package-metas`) recreate it. Consumed by `build-docs.mjs` and
 * `build-package-metas.mjs` (plus upstream CEMs).
 *
 * Sources:
 *   - Top-level `.ts` (non-recursive); skip `.d.ts`, `index.ts`,
 *     `vite.config.ts`. Non-Neutron files skipped by the analyzer.
 *   - `index.ts` fallback only when no sibling defines an element.
 *   - `src/` styles (`src/<shortName>.css`, `src/index.css`, then other
 *     `src/*.css`) — `@cssproperty` / `@cssclass` merged onto matching decls.
 *
 * No Neutron element → no CEM.
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

import { analyzeSource, makeImportResolver } from "./cem-analyze.mjs";
import {
  analyzeCss,
  mergeCssDocsIntoDeclaration,
} from "./cem-analyze-css.mjs";

const EXCLUDED_ROOT_FILES = new Set(["index.ts", "vite.config.ts"]);

export async function buildCem(packageRoot = process.cwd()) {
  const pkgJsonPath = path.resolve(packageRoot, "package.json");
  const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
  const shortName = pkg.name.replace(/^@[^/]+\//, "");

  const sources = await discoverSources(packageRoot);
  const modules = [];
  for (const { modulePath, src } of sources) {
    const cem = analyzeSource(src, {
      modulePath,
      packageRoot,
      resolveImport: makeImportResolver(src),
    });
    if (!cem) continue;
    for (const mod of cem.modules ?? []) modules.push(mod);
  }

  if (!modules.length) {
    const indexPath = path.resolve(packageRoot, "index.ts");
    if (existsSync(indexPath)) {
      const src = await readFile(indexPath, "utf8");
      const cem = analyzeSource(src, {
        modulePath: "index.ts",
        packageRoot,
        resolveImport: makeImportResolver(src),
      });
      if (cem) modules.push(...(cem.modules ?? []));
    }
  }

  if (!modules.length) return;

  for (const cssPath of await discoverCss(packageRoot, shortName)) {
    const cssSrc = await readFile(cssPath, "utf8");
    const cssApi = analyzeCss(cssSrc);
    if (
      !cssApi.cssProperties.length &&
      !cssApi.cssClasses.length &&
      !cssApi.cssAliases.length
    ) {
      continue;
    }

    // Properties / classes: bind to `@element` (or package shortname).
    if (cssApi.cssProperties.length || cssApi.cssClasses.length) {
      const targets = findTargetDeclarations(modules, cssApi, shortName);
      for (const decl of targets) {
        mergeCssDocsIntoDeclaration(decl, {
          cssProperties: cssApi.cssProperties,
          cssClasses: cssApi.cssClasses,
        });
      }
    }

    // Aliases: tag matching the alias name / selectors, else `@element` / shortname.
    for (const alias of cssApi.cssAliases) {
      const targets = findAliasTargetDeclarations(
        modules,
        alias,
        cssApi.element ?? shortName,
      );
      for (const decl of targets) {
        mergeCssDocsIntoDeclaration(decl, { cssAliases: [alias] });
      }
    }
  }

  modules.sort(compareModulesForPackage(shortName));

  const outDir = path.resolve(packageRoot, "support");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.resolve(outDir, "custom-elements.json"),
    JSON.stringify({ schemaVersion: "1.0.0", modules }, null, 2) + "\n",
    "utf8",
  );
}

async function discoverSources(packageRoot) {
  const entries = await readdir(packageRoot, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter(
      (name) =>
        name.endsWith(".ts") &&
        !name.endsWith(".d.ts") &&
        !EXCLUDED_ROOT_FILES.has(name),
    )
    .sort();
  const out = [];
  for (const name of files) {
    const src = await readFile(path.resolve(packageRoot, name), "utf8");
    out.push({ modulePath: name, src });
  }
  return out;
}

async function discoverCss(packageRoot, shortName) {
  const srcDir = path.resolve(packageRoot, "src");
  if (!existsSync(srcDir)) return [];

  const preferred = [`${shortName}.css`, "index.css"];
  const entries = await readdir(srcDir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith(".css"))
    .map((e) => e.name);

  const ordered = [];
  for (const name of preferred) {
    if (names.includes(name)) ordered.push(name);
  }
  for (const name of names.sort()) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered.map((name) => path.resolve(srcDir, name));
}

function findTargetDeclarations(modules, cssApi, shortName) {
  const tag = cssApi.element ?? shortName;
  const matched = [];
  const fallback = [];
  for (const mod of modules) {
    for (const decl of mod.declarations ?? []) {
      if (decl.customElement || decl.kind === "mixin") {
        fallback.push(decl);
      }
      if (decl.tagName === tag) matched.push(decl);
    }
  }
  return matched.length ? matched : fallback;
}

/**
 * `@custom-selector` alias → declaration:
 *   1. Simple tag selector matching `tagName`
 *   2. Longest `tagName` prefix of the bare name (`:--tag` / `:--tag--state`)
 *   3. `@element` / package shortname (same as properties/classes)
 */
function findAliasTargetDeclarations(modules, alias, fallbackTag) {
  const decls = [];
  for (const mod of modules) {
    for (const decl of mod.declarations ?? []) {
      if (decl.customElement || decl.kind === "mixin") decls.push(decl);
    }
  }
  if (!decls.length) return [];

  for (const sel of alias.selectors ?? []) {
    if (!/^[\w-]+$/.test(sel)) continue;
    const hit = decls.filter((d) => d.tagName === sel);
    if (hit.length) return hit;
  }

  const bare = alias.name.startsWith(":--") ? alias.name.slice(3) : alias.name;
  const tags = [
    ...new Set(decls.map((d) => d.tagName).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  for (const tag of tags) {
    if (bare === tag || bare.startsWith(`${tag}--`)) {
      return decls.filter((d) => d.tagName === tag);
    }
  }

  return findTargetDeclarations(
    modules,
    { element: fallbackTag },
    fallbackTag,
  );
}

// Package-shortname module first in the CEM / Markdown so the primary
// element stays on top.
function compareModulesForPackage(shortName) {
  const primary = `${shortName}.ts`;
  return (a, b) => {
    if (a.path === primary) return -1;
    if (b.path === primary) return 1;
    return a.path.localeCompare(b.path);
  };
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
  await buildCem();
}
