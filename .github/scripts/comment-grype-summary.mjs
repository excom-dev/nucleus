import fs from "node:fs";
import process from "node:process";

const sarifPath = process.env.SARIF_PATH;
const prNumber = process.env.PR_NUMBER;
const githubRepository = process.env.GITHUB_REPOSITORY;
const githubToken = process.env.GITHUB_TOKEN;
const githubApiUrl = process.env.GITHUB_API_URL || "https://api.github.com";

if (!sarifPath || !fs.existsSync(sarifPath)) {
  console.warn(`SARIF not found at ${sarifPath}`);
  process.exit(0);
}

if (!prNumber || !githubRepository || !githubToken) {
  console.warn("Missing required GitHub env vars for commenting.");
  process.exit(0);
}

const [owner, repo] = githubRepository.split("/");
const marker = "<!-- grype-sarif-summary -->";

const sarif = JSON.parse(fs.readFileSync(sarifPath, "utf8"));
const results = (sarif.runs || []).flatMap((run) => run.results || []);
const maxPerLevel = 20;
const resultsByLevel = results.reduce(
  (acc, result) => {
    const level = result.level || "unknown";
    acc[level] = acc[level] || [];
    acc[level].push(result);
    return acc;
  },
  { error: [], warning: [], note: [], unknown: [] },
);

const total = results.length;
const formatResult = (result) => {
  const rule = result.ruleId || result.rule?.id || "unknown-rule";
  const message = result.message?.text || result.message?.markdown || "No message";
  const location = result.locations?.[0]?.physicalLocation;
  const file = location?.artifactLocation?.uri;
  const line = location?.region?.startLine;
  const where = file ? `${file}${line ? `:${line}` : ""}` : "";
  return where ? `- \`${rule}\` ${message} (${where})` : `- \`${rule}\` ${message}`;
};
const formatSection = (icon, label, items) => {
  if (!items.length) {
    return [`### ${icon} ${label}`, "_No findings_"].join("\n");
  }
  const limited = items.slice(0, maxPerLevel).map(formatResult);
  const moreCount = items.length - limited.length;
  if (moreCount > 0) {
    limited.push(`- _and ${moreCount} more…_`);
  }
  return [`### ${icon} ${label} (${items.length})`, ...limited].join("\n");
};
const body = [
  marker,
  "## SAST Scan Summary (entire monorepo)",
  "",
  `Total findings: **${total}**`,
  "",
  "",
  formatSection("🔴", "Errors", resultsByLevel.error),
  "",
  formatSection("🟠", "Warnings", resultsByLevel.warning),
  "",
  formatSection("🔵", "Notes", resultsByLevel.note),
  "",
  formatSection("🟣", "Unknown", resultsByLevel.unknown),
].join("\n");

async function githubRequest(path, options) {
  const response = await fetch(`${githubApiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  return response.json();
}

const comments = await githubRequest(
  `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
  { method: "GET" },
);
const existing = comments.find((comment) => comment.body?.includes(marker));

if (existing) {
  await githubRequest(
    `/repos/${owner}/${repo}/issues/comments/${existing.id}`,
    { method: "PATCH", body: JSON.stringify({ body }) },
  );
} else {
  await githubRequest(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
}
