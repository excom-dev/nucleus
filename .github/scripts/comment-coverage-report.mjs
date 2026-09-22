/**
 * Coverage PR comment.
 *
 *   node .github/scripts/comment-coverage-report.mjs   # PR: post / update the sticky comment
 *
 * Reads every `packages/<pkg>/coverage/coverage-summary.json` written by
 * `rush coverage` (Vitest `json-summary` reporter) and folds them into one
 * sticky comment: a package table (statements / branches / functions / lines)
 * plus, per package, a collapsible list of files under the 90 % threshold.
 * Packages not tested in this run have no summary and are not listed.
 * A package with `excom.coverageThreshold: false` is outside the quality bar:
 * its numbers are reported as exempt and its weak files are not listed.
 *
 * Replaces the coverage-matrix / per-package `vitest-coverage-report-action`
 * jobs: one comment, no artifact round-trip, no extra runners.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MARKER = "<!-- coverage-report -->";
const packagesDir = "packages";
/** Mirrors `COVERAGE_THRESHOLD` in heft-rig's `vite-config.mjs`. */
const THRESHOLD = 90;
const WARN = 80;
const METRICS = ["statements", "branches", "functions", "lines"];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** `{ [packageDir]: summary }` from every package's `coverage-summary.json`. */
export function collectSummaries(dir = packagesDir) {
  const summaries = {};
  if (!fs.existsSync(dir)) return summaries;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "coverage", "coverage-summary.json");
    if (!fs.existsSync(file)) continue;
    try {
      const summary = readJson(file);
      if (summary.total) summaries[entry.name] = summary;
    } catch (error) {
      console.warn(`Skipping unreadable ${file}: ${error.message}`);
    }
  }
  return summaries;
}

/** Packages whose `package.json` lifts the gate with `excom.coverageThreshold: false`. */
export function collectExempt(dir = packagesDir) {
  const exempt = new Set();
  if (!fs.existsSync(dir)) return exempt;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "package.json");
    if (!fs.existsSync(file)) continue;
    try {
      if (readJson(file).excom?.coverageThreshold === false) exempt.add(entry.name);
    } catch (error) {
      console.warn(`Skipping unreadable ${file}: ${error.message}`);
    }
  }
  return exempt;
}

export const icon = (pct) => (pct >= THRESHOLD ? "🟢" : pct >= WARN ? "🟠" : "🔴");
/** Istanbul writes `pct: "Unknown"` when there is nothing to measure (CSS-only `valence`). */
const hasPct = (metric) => typeof metric?.pct === "number";
const cell = (metric, isExempt) =>
  hasPct(metric) ? `${isExempt ? "⚪" : icon(metric.pct)} ${metric.pct.toFixed(1)}%` : "—";

/** Everything up to and including `packages/<pkg>/` stripped off an absolute file key. */
export function relativeFile(file, pkg) {
  const normalized = file.replace(/\\/g, "/");
  const marker = `/${pkg}/`;
  const at = normalized.indexOf(marker);
  return at === -1 ? normalized : normalized.slice(at + marker.length);
}

/** `Infinity` (never weak) when no metric is measurable. */
const lowest = (entry) =>
  Math.min(
    ...METRICS.map((m) => entry[m])
      .filter(hasPct)
      .map((metric) => metric.pct),
  );

/** Markdown body for the comment. */
export function renderComment(summaries, exempt = new Set()) {
  const names = Object.keys(summaries).sort();
  const lines = [MARKER, "## Coverage", ""];
  if (!names.length) {
    lines.push("_No packages were tested in this run._");
    return lines.join("\n");
  }
  const anyExempt = names.some((name) => exempt.has(name));
  lines.push(
    `Thresholds: 🟢 ≥ ${THRESHOLD}% · 🟠 ≥ ${WARN}% · 🔴 below. Every metric must reach ${THRESHOLD}% (\`rush coverage\`).` +
      (anyExempt ? ` ⚪ exempt (\`excom.coverageThreshold: false\`) — reported, never gated.` : ""),
    "",
    "| package | statements | branches | functions | lines |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const name of names) {
    const { total } = summaries[name];
    const isExempt = exempt.has(name);
    lines.push(
      `| \`${name}\`${isExempt ? " _(exempt)_" : ""} | ${METRICS.map((m) => cell(total[m], isExempt)).join(" | ")} |`,
    );
  }
  lines.push("");
  for (const name of names) {
    if (exempt.has(name)) continue;
    const summary = summaries[name];
    const weak = Object.entries(summary)
      .filter(([file, entry]) => file !== "total" && lowest(entry) < THRESHOLD)
      .sort(([, a], [, b]) => lowest(a) - lowest(b));
    if (!weak.length) continue;
    lines.push(
      `<details><summary><b>${name}</b> — ${weak.length} file(s) under ${THRESHOLD}%</summary>`,
      "",
      "| file | statements | branches | functions | lines |",
      "| --- | ---: | ---: | ---: | ---: |",
    );
    for (const [file, entry] of weak) {
      lines.push(`| \`${relativeFile(file, name)}\` | ${METRICS.map((m) => cell(entry[m])).join(" | ")} |`);
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
    console.log(`Updated coverage comment ${existing.id}`);
  } else {
    await githubRequest(base, token, { method: "POST", body: JSON.stringify({ body }) });
    console.log("Posted coverage comment");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  await upsertComment(renderComment(collectSummaries(), collectExempt()));
}
