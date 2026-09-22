import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [, , command, ...restArgs] = process.argv;

if (!command) {
  console.error("Usage: run-rush-for-changes.mjs <command> [rush-args...]");
  process.exit(1);
}

const changesRoot = path.resolve("common/changes");
const packageNames = new Set();

async function readChangeFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await readChangeFiles(entryPath);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        return;
      }
      const raw = await fs.readFile(entryPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.packageName) {
        packageNames.add(parsed.packageName);
      }
      if (Array.isArray(parsed.changes)) {
        for (const change of parsed.changes) {
          if (change.packageName) {
            packageNames.add(change.packageName);
          }
        }
      }
    }),
  );
}

try {
  await readChangeFiles(changesRoot);
} catch (error) {
  if (!error || error.code !== "ENOENT") {
    throw error;
  }
}

if (packageNames.size === 0) {
  console.log("No change files found; skipping Rush command.");
  process.exit(0);
}

const selectors = [];
for (const name of packageNames) {
  selectors.push("--impacted-by", name);
}

const result = spawnSync(
  "node",
  ["common/scripts/install-run-rush.js", command, ...restArgs, ...selectors],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
