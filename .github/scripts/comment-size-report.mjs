/**
 * Bundle-size PR comment / baseline.
 *
 *   node .github/scripts/comment-size-report.mjs            # PR: post / update the sticky comment
 *   node .github/scripts/comment-size-report.mjs --write-baseline   # main: merge reports into the baseline file
 *
 * Reads every `packages/<pkg>/dist/size-report.json` written by heft-rig's
 * `vite-build.mjs` (raw / gzip / brotli per output). The baseline is
 * `size-baseline/size-report.json` (override with `SIZE_BASELINE`), restored
 * from the Actions cache saved by the main-branch docs deploy; `--write-baseline`
 * merges the current reports over it so packages not rebuilt keep their last
 * numbers. Deltas are shown against that baseline when present.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MARKER = "<!-- bundle-size-report -->";
const packagesDir = "packages";
const baselinePath = process.env.SIZE_BASELINE || "size-baseline/size-report.json";
const writeBaseline = process.argv.includes("--write-baseline");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** `{ [packageName]: { version, files } }` from every package's report. */
export function collectReports(dir = packagesDir) {
  const reports = {};
  if (!fs.existsSync(dir)) return reports;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "dist", "size-report.json");
    if (!fs.existsSync(file)) continue;
    try {
      const report = readJson(file);
      reports[report.name] = { version: report.version, files: report.files ?? {} };
    } catch (error) {
      console.warn(`Skipping unreadable ${file}: ${error.message}`);
    }
  }
  return reports;
}

export function readBaseline(file = baselinePath) {
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const delta = (current, previous) => {
  if (previous === undefined) return "new";
  const diff = current - previous;
  if (diff === 0) return "±0";
  const pct = previous ? ` (${diff > 0 ? "+" : ""}${((diff / previous) * 100).toFixed(1)}%)` : "";
  return `${diff > 0 ? "+" : "−"}${kb(Math.abs(diff))}${pct}`;
};

/** Markdown body for the comment. */
export function renderComment(reports, baseline) {
  const names = Object.keys(reports).sort();
  const lines = [MARKER, "## Bundle sizes", ""];
  if (!names.length) {
    lines.push("_No packages were built in this run._");
    return lines.join("\n");
  }
  lines.push(
    baseline
      ? "gzip deltas are against the last `main` build (docs deploy baseline)."
      : "_No `main` baseline was available; sizes only._",
    "",
  );
  for (const name of names) {
    const { files } = reports[name];
    const previous = baseline?.[name]?.files ?? {};
    const rows = Object.entries(files).filter(([file]) => !file.endsWith(".map"));
    if (!rows.length) continue;
    lines.push(`<details><summary><b>${name}</b> — ${rows.length} file(s)</summary>`, "");
    lines.push("| file | raw | gzip | brotli | Δ gzip |", "| --- | ---: | ---: | ---: | ---: |");
    for (const [file, size] of rows) {
      lines.push(
        `| \`${file}\` | ${kb(size.raw)} | ${kb(size.gzip)} | ${kb(size.brotli)} | ${
          baseline ? delta(size.gzip, previous[file]?.gzip) : ""
        } |`,
      );
    }
    for (const file of Object.keys(previous).filter((f) => !(f in files))) {
      lines.push(`| \`${file}\` | removed | | | −${kb(previous[file].gzip)} |`);
    }
    lines.push("", "</details>", "");
  }
  return lines.join("\n");
}

async function githubRequest(url, token, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      ...(options?.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function upsertComment(body) {
  const prNumber = process.env.PR_NUMBER;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  if (!prNumber || !repository || !token) {
    console.warn("Missing PR_NUMBER / GITHUB_REPOSITORY / GITHUB_TOKEN; printing the comment instead.");
    console.log(body);
    return;
  }
  const base = `${api}/repos/${repository}/issues/${prNumber}/comments`;
  const comments = await githubRequest(`${base}?per_page=100`, token, { method: "GET" });
  const existing = comments.find((c) => typeof c.body === "string" && c.body.includes(MARKER));
  if (existing) {
    await githubRequest(`${api}/repos/${repository}/issues/comments/${existing.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    console.log(`Updated bundle-size comment ${existing.id}`);
  } else {
    await githubRequest(base, token, { method: "POST", body: JSON.stringify({ body }) });
    console.log("Posted bundle-size comment");
  }
}

async function main() {
  const reports = collectReports();
  const baseline = readBaseline();
  if (writeBaseline) {
    const merged = { ...(baseline ?? {}), ...reports };
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(merged, null, 2) + "\n");
    console.log(`Wrote baseline for ${Object.keys(merged).length} package(s) to ${baselinePath}`);
    return;
  }
  await upsertComment(renderComment(reports, baseline));
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  await main();
}
