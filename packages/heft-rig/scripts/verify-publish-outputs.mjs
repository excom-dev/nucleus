#!/usr/bin/env node
/**
 * Publish-time guard: refuse to ship tarballs that have no build output.
 *
 * The 0.1.0 publish shipped source-only tarballs for every package: the
 * workflow built with `run-rush-for-changes.mjs`, which selects projects from
 * Rush change files and silently skips the build when there are none, so
 * `rush apply-exports` found no `dist/exports.generated.json` to apply and
 * `rush publish --publish --include-all` packed packages with no `dist/` and
 * no `exports`. This runs in `publish.yml` between `apply-exports` and
 * `publish --publish` and fails the job before anything reaches the registry.
 *
 * Checked for every `rush.json` project whose `package.json` is not
 * `"private": true` (`--include-all` publishes all of them):
 *   - `<project>/dist/exports.generated.json` exists — the package was built.
 *     Only for packages the rig builds, i.e. with root-level `.ts` / `.css`
 *     entry files (the rule in `vite-build.mjs`); a package that hand-writes
 *     its `exports` and builds itself (`nucleus-quark-highlighter`) has none.
 *   - `package.json` has a non-empty `exports` map — `apply-exports` ran, or
 *     the package wrote it by hand
 *   - every string target inside that map resolves to an existing file —
 *     `import` / `default` / `types` / plain strings, nested conditions and
 *     fallback arrays alike. This is what catches a `types` condition
 *     pointing at a `.d.ts` the build never emits.
 *   - `files` is present and includes `dist`, so npm packs the build output
 *
 * Wildcard (`*`) subpath targets are reported as-is only when their literal
 * prefix directory is missing — a pattern cannot be resolved to one file.
 * `null` targets (blocked subpaths) are ignored.
 *
 * Every problem prints as `<pkg>: <problem>`; the exit code is 1 when there
 * is at least one, 0 with a one-line summary otherwise. Repo-level script,
 * run from the repo root like `build-docs-index.mjs` / `build-npm-readmes.mjs`
 * — a per-package Rush phase would not see the siblings. Node built-ins only.
 */
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

/**
 * @param {string} [repoRoot]
 * @returns {Promise<string[]>} one `<pkg>: <problem>` line per problem found
 */
export async function verifyPublishOutputs(repoRoot = findRepoRoot()) {
  const rushConfig = JSON.parse(
    await readFile(path.resolve(repoRoot, "rush.json"), "utf8"),
  );

  const problems = [];
  let checked = 0;

  for (const project of rushConfig.projects ?? []) {
    const folder = project?.projectFolder;
    if (typeof folder !== "string") continue;
    const projectRoot = path.resolve(repoRoot, folder);
    const pkg = await readJson(path.resolve(projectRoot, "package.json"));
    if (!pkg) {
      problems.push(
        `${project.packageName ?? folder}: no readable package.json in ${folder}`,
      );
      continue;
    }
    if (pkg.private) continue;
    checked += 1;
    const name = pkg.name ?? project.packageName ?? folder;
    for (const problem of checkProject(projectRoot, pkg)) {
      problems.push(`${name}: ${problem}`);
    }
  }

  if (problems.length) {
    for (const problem of problems) console.error(problem);
    console.error(
      `\n${problems.length} publish output problem(s) in ${checked} publishable package(s). ` +
        `Run a full \`rush build\` and \`rush apply-exports\` before publishing.`,
    );
    return problems;
  }

  console.log(
    `OK: ${checked} publishable package(s) have dist/exports.generated.json, ` +
      `a resolvable exports map and "dist" in files.`,
  );
  return problems;
}

/**
 * Same rule as `vite-build.mjs`: a package is rig-built when its root holds a
 * `.ts` / `.css` entry file (declarations and tests excluded).
 * @param {string} projectRoot
 */
function hasBuildEntries(projectRoot) {
  return readdirSync(projectRoot, { withFileTypes: true }).some(
    (file) =>
      file.isFile() &&
      (file.name.endsWith(".ts") || file.name.endsWith(".css")) &&
      !/\.(d\.ts|test\.ts|spec\.ts|test\.css|spec\.css)$/.test(file.name),
  );
}

/**
 * @param {string} projectRoot
 * @param {Record<string, unknown>} pkg
 * @returns {string[]}
 */
function checkProject(projectRoot, pkg) {
  const problems = [];

  if (
    hasBuildEntries(projectRoot) &&
    !existsSync(path.resolve(projectRoot, "dist/exports.generated.json"))
  ) {
    problems.push("missing dist/exports.generated.json — the package was not built");
  }

  problems.push(...checkExports(projectRoot, pkg.exports));
  problems.push(...checkFiles(pkg.files));

  return problems;
}

/** `exports` present, non-empty, and every target on disk. */
function checkExports(projectRoot, exportsMap) {
  if (exportsMap === undefined || exportsMap === null) {
    return ['package.json has no "exports" map — rush apply-exports did not run'];
  }
  const targets = [];
  collectTargets(exportsMap, "exports", targets);
  if (!targets.length) {
    return ['"exports" map has no targets — rush apply-exports did not run'];
  }

  // One line per missing file, not per subpath: a single dangling `.d.ts` is
  // referenced by every subpath of the package.
  const missing = new Map();
  for (const { trail, target } of targets) {
    if (resolvesToFile(projectRoot, target)) continue;
    const seen = missing.get(target);
    if (seen) seen.count += 1;
    else missing.set(target, { trail, count: 1 });
  }

  return [...missing].map(
    ([target, { trail, count }]) =>
      `missing export target ${target} (${trail}${count > 1 ? `, ${count} subpaths` : ""})`,
  );
}

/**
 * Every string target in an `exports` value, with the path that reached it.
 * Objects are conditions or subpaths, arrays are fallbacks, `null` blocks a
 * subpath and has nothing to resolve.
 */
function collectTargets(node, trail, out) {
  if (typeof node === "string") {
    out.push({ trail, target: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectTargets(value, `${trail}[${index}]`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      collectTargets(value, `${trail}${keyTrail(key)}`, out);
    }
  }
}

/** `["."]` for a subpath, `.types` for a condition. */
function keyTrail(key) {
  return key === "." || key.startsWith("./") || key.startsWith("#")
    ? `[${JSON.stringify(key)}]`
    : `.${key}`;
}

function resolvesToFile(projectRoot, target) {
  if (typeof target !== "string" || !target.length) return false;
  // A pattern stands for many files; the best that can be checked is that the
  // directory it globs inside exists.
  const literal = target.includes("*") ? target.slice(0, target.indexOf("*")) : target;
  const resolved = path.resolve(projectRoot, literal);
  const stat = statSync(resolved, { throwIfNoEntry: false });
  if (!stat) return false;
  return target.includes("*") ? stat.isDirectory() || stat.isFile() : stat.isFile();
}

/** npm packs `dist/` only when `files` says so. */
function checkFiles(files) {
  if (files === undefined) return ['"files" is missing from package.json'];
  if (!Array.isArray(files) || !files.length) return ['"files" is empty'];
  const packsDist = files.some((entry) => {
    if (typeof entry !== "string") return false;
    const normalized = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    return normalized === "dist" || normalized.startsWith("dist/");
  });
  return packsDist ? [] : [`"files" does not include "dist" (has: ${files.join(", ")})`];
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
  const problems = await verifyPublishOutputs();
  if (problems.length) process.exit(1);
}
