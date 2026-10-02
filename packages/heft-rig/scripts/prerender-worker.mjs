#!/usr/bin/env node
/**
 * One worker of `prerender.mjs`'s pool, started by nucleus-ssr's
 * `prerender()`: loads the site's config and `entry` through a module runner
 * of its own (`createWorkspaceRunner`), then serves renders
 * (`serveRenderer`). It finds the site in `WORKER_ENV`.
 */
import { createWorkspaceRunner, isMain, WORKER_ENV } from "./prerender.mjs";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Modules of the built site, which pages import while they render (Quark `@use`). */
const SITE_MODULE = /\.m?js$/;

/** The repository holding `packageRoot` (where `rush.json` is), or `packageRoot`. */
export function repositoryOf(packageRoot) {
  const up = (dir) =>
    existsSync(path.join(dir, "rush.json")) ? dir : path.dirname(dir) === dir ? undefined : up(path.dirname(dir));
  return up(path.resolve(packageRoot)) ?? path.resolve(packageRoot);
}

/**
 * The worker's part of the cache key: Node, nucleus-ssr, nucleus-dom and
 * happy-dom versions, every module the runner evaluated (paths relative to
 * `repository`, so any checkout gives the same key) and every module file
 * under `root`, which pages import while they render.
 * @param {{ import: (id: string) => Promise<any>, modules: () => { id: string, meta?: { code?: string, externalize?: string } }[] }} runner
 * @param {string | URL} root
 * @param {string} repository
 */
export async function workerKey(runner, root, repository) {
  const [ssr, dom] = await Promise.all(
    ["@excom/nucleus-ssr", "@excom/nucleus-dom"].map(async (name) => (await runner.import(`${name}/package.json`)).default),
  );
  const hash = createHash("sha256").update(
    JSON.stringify([process.version, ssr.version, dom.version, dom.dependencies["happy-dom"]]),
  );
  const relative = (text) => text.replaceAll(`${repository}/`, "/");
  const modules = runner.modules().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const { id, meta } of modules) hash.update(relative(`\0${id}\0${meta?.code ?? meta?.externalize ?? ""}`));
  const rootPath = String(root).startsWith("file:") ? fileURLToPath(root) : path.resolve(String(root));
  const files = readdirSync(rootPath, { recursive: true })
    .map((file) => String(file).replaceAll("\\", "/"))
    .filter((file) => SITE_MODULE.test(file))
    .sort();
  for (const file of files) hash.update(`\0${file}\0`).update(readFileSync(path.join(rootPath, file)));
  return hash.digest("hex");
}

/**
 * Loads the config through a runner and serves its options to the pool: the
 * renderer takes its own, the parent the rest (`routes`, `out`, `notFound`,
 * `servedElsewhere`). The runner stays open: pages import while they render.
 * @param {{ packageRoot: string, configFile: string }} site
 */
export async function serveWorker({ packageRoot, configFile }) {
  const runner = await createWorkspaceRunner(packageRoot);
  try {
    // nucleus-ssr's own module, not its public API: the workspace source has it
    const { loadPrerenderConfig } = await runner.import("@excom/nucleus-ssr/src/run");
    const options = await loadPrerenderConfig(configFile, runner.import);
    const { serveRenderer } = await runner.import("@excom/nucleus-ssr");
    await serveRenderer({
      ...options,
      cacheKey: () => workerKey(runner, options.root, repositoryOf(packageRoot)),
    });
  } catch (error) {
    await runner.close();
    throw error;
  }
}

if (isMain(import.meta.url)) await serveWorker(JSON.parse(process.env[WORKER_ENV]));
