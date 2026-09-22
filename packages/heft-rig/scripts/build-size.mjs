import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

/**
 * `dist/` size report: raw / gzip / brotli for JS and CSS (skip maps,
 * `.d.ts`, generated JSON). `vite-build.mjs` writes `dist/size-report.json`
 * and prints the table after each library build. CI rolls them into a PR
 * comment (`.github/scripts/comment-size-report.mjs`). Re-print with
 * `node node_modules/@excom/heft-rig/scripts/build-size.mjs`.
 */
export const SIZE_REPORT_FILE = "size-report.json";

const isMeasured = (file) =>
  (file.endsWith(".js") || file.endsWith(".css")) && !file.endsWith(".d.ts");

/**
 * @param {Buffer} bytes
 * @returns {{ raw: number; gzip: number; brotli: number }}
 */
export function measure(bytes) {
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  };
}

/**
 * Measure every dist output of a package.
 * @param {string} [packageRoot=process.cwd()]
 * @returns {Promise<{ name: string; version: string; files: Record<string, { raw: number; gzip: number; brotli: number }> }>}
 */
export async function measureDist(packageRoot = process.cwd()) {
  const pkg = JSON.parse(
    await readFile(path.resolve(packageRoot, "package.json"), "utf8"),
  );
  const dist = path.resolve(packageRoot, "dist");
  const files = {};
  const entries = (await readdir(dist, { withFileTypes: true, recursive: true }))
    .filter((entry) => entry.isFile() && isMeasured(entry.name))
    .map((entry) =>
      path
        .relative(dist, path.join(entry.parentPath ?? entry.path, entry.name))
        .replace(/\\/g, "/"),
    )
    .sort();
  for (const file of entries) {
    files[file] = measure(await readFile(path.join(dist, file)));
  }
  return { name: pkg.name, version: pkg.version, files };
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

/**
 * Plain-text table of one report.
 * @param {{ name: string; files: Record<string, { raw: number; gzip: number; brotli: number }> }} report
 */
export function formatSizeTable(report) {
  const rows = Object.entries(report.files);
  if (!rows.length) return `${report.name}: no dist outputs`;
  const width = Math.max(4, ...rows.map(([file]) => file.length));
  const line = (file, raw, gzip, brotli) =>
    `${file.padEnd(width)}  ${raw.padStart(10)}  ${gzip.padStart(10)}  ${brotli.padStart(10)}`;
  return [
    `${report.name} dist sizes`,
    line("file", "raw", "gzip", "brotli"),
    ...rows.map(([file, s]) => line(file, kb(s.raw), kb(s.gzip), kb(s.brotli))),
  ].join("\n");
}

/**
 * Measure, write `dist/size-report.json` and print the table.
 * @param {string} [packageRoot=process.cwd()]
 * @param {{ log?: (line: string) => void }} [options]
 */
export async function buildSizeReport(packageRoot = process.cwd(), { log = console.log } = {}) {
  const report = await measureDist(packageRoot);
  await writeFile(
    path.resolve(packageRoot, "dist", SIZE_REPORT_FILE),
    JSON.stringify(report, null, 2) + "\n",
  );
  log(formatSizeTable(report));
  return report;
}

async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const [argRealPath, fileRealPath] = await Promise.all([
      realpath(path.resolve(process.cwd(), process.argv[1])),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    return argRealPath === fileRealPath;
  } catch {
    return false;
  }
}

if (await isMain()) {
  await buildSizeReport();
}
