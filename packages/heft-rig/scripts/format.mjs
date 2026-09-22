import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const rigRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const prettierPath = path.resolve(
  rigRoot,
  "node_modules/.bin/prettier" + binSuffix,
);
const eslintPath = path.resolve(
  rigRoot,
  "node_modules/.bin/eslint" + binSuffix,
);
const eslintConfigPath = path.join(
  rigRoot,
  "profiles/default/config/eslint.config.cjs",
);

function lintFix({ extensions }) {
  return execFile(
    eslintPath,
    [
      "--config",
      eslintConfigPath,
      "--fix",
      "--no-error-on-unmatched-pattern",
      `*.{${extensions.join(",")}}`,
      `src/**/*.{${extensions.join(",")}}`,
    ],
    { stdio: "inherit" },
  );
}

function format({ configPath, extensions }) {
  return execFile(
    prettierPath,
    [
      "--config",
      configPath,
      "--write",
      "--no-error-on-unmatched-pattern",
      `*.{${extensions.join(",")}}`,
      `src/**/*.{${extensions.join(",")}}`,
    ],
    { stdio: "inherit" },
  );
}

const QUARK_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  "temp",
  ".git",
]);

async function findQuarkFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!QUARK_SKIP_DIRS.has(entry.name)) {
        found.push(...(await findQuarkFiles(entryPath)));
      }
    } else if (entry.name.endsWith(".quark")) {
      found.push(entryPath);
    }
  }
  return found;
}

/**
 * Prefer the consuming package's own `@excom/quark-formatter`
 * dependency; fall back to the workspace sibling when the rig runs
 * inside the monorepo. Returns `null` when the formatter isn't built
 * or available (packages without Quark sheets never notice).
 */
async function resolveQuarkFormatter() {
  const candidates = [];
  try {
    const requireFromPackage = createRequire(
      path.join(process.cwd(), "package.json"),
    );
    candidates.push(
      requireFromPackage.resolve("@excom/quark-formatter/dist/index.js"),
    );
  } catch {
    // Not a dependency of the current package.
  }
  candidates.push(path.resolve(rigRoot, "../quark-formatter/dist/index.js"));
  for (const candidate of candidates) {
    try {
      const module = await import(pathToFileURL(candidate).href);
      return { module, path: candidate };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function formatQuark() {
  const files = await findQuarkFiles(process.cwd());
  if (!files.length) return;
  const resolved = await resolveQuarkFormatter();
  if (!resolved) {
    console.warn(
      "quark: found .quark files but @excom/quark-formatter is not built/available; skipping",
    );
    return;
  }
  const formatter = resolved.module;
  const failures = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    try {
      const formatted = formatter.format(source);
      if (formatted !== source) {
        await writeFile(file, formatted);
        console.log(`quark: formatted ${path.relative(process.cwd(), file)}`);
      }
    } catch (error) {
      failures.push(`${path.relative(process.cwd(), file)}: ${error.message}`);
    }
  }
  if (failures.length) {
    // Name the build so a stale `dist/` (old grammar, misleading messages)
    // is recognisable: rebuild quark-parser + quark-formatter in that case.
    const built = await stat(resolved.path)
      .then((s) => s.mtime.toISOString())
      .catch(() => "unknown");
    console.error(
      "quark: failed to format:\n  " +
        failures.join("\n  ") +
        `\n  formatter build: ${resolved.path} (built ${built});` +
        " if these errors don't match the current Quark grammar, rebuild" +
        " @excom/quark-parser and @excom/quark-formatter",
    );
    process.exitCode = 1;
  }
}

await lintFix({
  extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
});

await Promise.all([
  format({
    configPath: path.join(rigRoot, "profiles/default/config/.prettierrc"),
    extensions: ["ts", "js", "json", "css", "scss"],
  }),
  format({
    configPath: path.join(rigRoot, "profiles/default/config/.html.prettierrc"),
    extensions: ["html", "md"],
  }),
  formatQuark(),
]);

console.log("Formatting complete");
