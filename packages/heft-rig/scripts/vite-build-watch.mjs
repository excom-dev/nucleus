import { watch } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { runFullBuild } from "./vite-build.mjs";

const packageRoot = process.cwd();

function isRelevantFile(name) {
  if (!name) return false;
  if (name.includes("node_modules")) return false;
  if (name.endsWith(".d.ts")) return false;
  if (name.endsWith(".test.ts") || name.endsWith(".spec.ts")) return false;
  if (name.endsWith(".test.css") || name.endsWith(".spec.css")) return false;
  return name.endsWith(".ts") || name.endsWith(".css");
}

let debounceTimer;
function scheduleBuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    console.log("[vite-build-watch] Change detected, running full build...");
    try {
      await runFullBuild(packageRoot);
      console.log("[vite-build-watch] Build complete.");
    } catch (err) {
      console.error("[vite-build-watch] Build failed:", err);
    }
  }, 300);
}

function watchDir(dir, recursive = false) {
  const w = watch(dir, { recursive }, (eventType, filename) => {
    if (isRelevantFile(filename)) {
      scheduleBuild();
    }
  });
  w.on("error", (err) => {
    console.error("[vite-build-watch] Watcher error:", err.message);
    if (err.code === "EMFILE") {
      console.error(
        "[vite-build-watch] Try: ulimit -n 10240 (or run without recursive watch)",
      );
    }
  });
}

console.log("[vite-build-watch] Watching for changes (run initial build once)...");
await runFullBuild(packageRoot);
console.log("[vite-build-watch] Initial build complete. Watching...");

// Watch root dir (non-recursive) for index.ts, index.css, etc.
watchDir(packageRoot, false);
// Watch src/ (non-recursive to avoid EMFILE in large trees; direct children only)
const srcDir = path.join(packageRoot, "src");
if (await fileExists(srcDir)) {
  watchDir(srcDir, false);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
