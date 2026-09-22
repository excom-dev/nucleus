import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";

/**
 * The shared Vitest config for the package in `process.cwd()`.
 *
 * Exported as an async function (Vite calls it when it evaluates this file as
 * `--config`) rather than a ready-made object, so merely importing this module
 * stays cheap. The CLI wrapper below, `coverage.mjs` and the rig's own tests
 * all import it, and building the config eagerly pulled Vite, esbuild and the
 * plugin chain into the wrapper process — about a second per package that the
 * spawned `vitest` process then paid again when it loaded the same file.
 *
 * @returns {Promise<import("vitest/config").UserConfig>}
 */
export default async function config() {
  const { createRigViteConfig } = await import("./vite-config.mjs");
  return createRigViteConfig({
    mode: "test",
    root: process.cwd(),
    entry: undefined,
  });
}

const WATCH_FLAGS = ["--watch", "-w"];

export async function runVitest({ extraArgs = [], argv = process.argv.slice(2) } = {}) {
  const watchMode = argv.some((arg) => WATCH_FLAGS.includes(arg));
  const vitestArgs = [
    ...(watchMode ? [] : ["run"]),
    "--config",
    fileURLToPath(import.meta.url),
    ...extraArgs,
    ...argv,
  ];
  const rigRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const binSuffix = process.platform === "win32" ? ".cmd" : "";
  const vitestPath = path.resolve(rigRoot, "node_modules/.bin/vitest" + binSuffix);
  await new Promise((resolve, reject) => {
    const child = spawn(vitestPath, vitestArgs, {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`vitest exited with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`));
    });
  });
}

function shouldRunVitest() {
  const argv1 = process.argv[1];
  if (!argv1) return false;

  const thisFile = fileURLToPath(import.meta.url);
  const resolvedArg = path.resolve(process.cwd(), argv1);
  let shouldRun = false;

  try {
    shouldRun = realpathSync(resolvedArg) === realpathSync(thisFile);
  } catch {
    shouldRun = resolvedArg === thisFile;
  }

  return shouldRun;
}

if (shouldRunVitest()) {
  await runVitest();
}
