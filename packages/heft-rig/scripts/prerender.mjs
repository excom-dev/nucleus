#!/usr/bin/env node
/**
 * `npm run build:prerender`: static HTML for every route of a built site,
 * from `@excom/nucleus-ssr`'s `runPrerender`. Run from the package
 * directory:
 *
 *   node node_modules/@excom/heft-rig/scripts/prerender.mjs <config> [--concurrency <n>] [--no-cache]
 *
 * What the `nucleus-ssr` command does (the report, the link check, exit
 * code 1 for a failed page, a route with no file or a link to no page), from
 * workspace source: `<config>` (relative to the package), its `entry` and
 * nucleus-ssr load through Vite's module runner with the test aliases
 * (`@excom/x` → `packages/x/index.ts`), so no published `exports` map is
 * needed. Each worker of the pool (`prerender-worker.mjs`) loads the config
 * and entry the same way. Pages whose inputs did not change are reused from
 * `temp/prerender-cache` in the package (`--no-cache`: neither read nor
 * written); the shell the pages were rendered from is saved to
 * `temp/prerender-shell.html` in the package.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRunnableDevEnvironment, resolveConfig } from "vite";
import { createRigViteConfig } from "./vite-config.mjs";

/** The cache of rendered pages, in the site package. */
export const CACHE_DIR = "temp/prerender-cache";

/** The untouched shell of the last run, in the site package. */
export const SHELL_FILE = "temp/prerender-shell.html";

/** How a worker finds the site: `{ packageRoot, configFile }` as JSON. */
export const WORKER_ENV = "RIG_PRERENDER_WORKER";

// node:path, not `new URL()`: in the rig's tests `URL` is happy-dom's
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "prerender-worker.mjs");

/**
 * A Vite module runner over workspace source, resolving like the package's
 * tests. Third-party dependencies load natively.
 * @param {string} packageRoot
 * @returns {Promise<{ import: (id: string) => Promise<any>, close: () => Promise<void> }>}
 */
export async function createWorkspaceRunner(packageRoot) {
  const { resolve } = await createRigViteConfig({ mode: "test", root: packageRoot });
  const config = await resolveConfig(
    {
      configFile: false,
      envDir: false,
      root: packageRoot,
      logLevel: "warn",
      resolve,
      environments: {
        prerender: {
          consumer: "server",
          dev: { moduleRunnerTransform: true },
          resolve: { external: true, mainFields: [], conditions: ["node"] },
        },
      },
    },
    "serve",
  );
  const environment = createRunnableDevEnvironment("prerender", config, {
    runnerOptions: { hmr: false },
    hot: false,
  });
  await environment.init();
  return {
    import: (id) => environment.runner.import(id),
    /** Every module evaluated so far: `id`, and `meta` with the `code` it ran, or the URL it loaded natively (`externalize`). */
    modules: () => [...environment.runner.evaluatedModules.idToModuleMap.values()],
    close: () => environment.close(),
  };
}

/**
 * Loads `configFile` and prerenders through nucleus-ssr's `runPrerender`
 * in a pool of `concurrency` workers (`prerender-worker.mjs`), reusing
 * unchanged pages from `cacheDir` unless `cache` is false, and saves the
 * shell to `shellFile`. Resolves to its classified pages, link check and
 * exit code.
 * @param {{ packageRoot?: string, configFile: string, log?: (line: string) => void, concurrency?: number, cache?: boolean, cacheDir?: string, shellFile?: string }} options
 */
export async function runPrerender({
  packageRoot = process.cwd(),
  configFile,
  log,
  concurrency,
  cache = true,
  cacheDir = path.join(packageRoot, CACHE_DIR),
  shellFile = path.join(packageRoot, SHELL_FILE),
}) {
  if (!configFile) throw new Error("prerender: pass the config module, e.g. support/prerender/prerender.config.ts");
  const file = path.resolve(packageRoot, configFile);
  const runner = await createWorkspaceRunner(packageRoot);
  // the workers read it when they start: they inherit the environment
  const previous = process.env[WORKER_ENV];
  process.env[WORKER_ENV] = JSON.stringify({ packageRoot, configFile: file });
  try {
    const { runPrerender: run } = await runner.import("@excom/nucleus-ssr");
    return await run({
      config: file,
      load: runner.import,
      worker: WORKER,
      concurrency,
      // the workers' key covers the code; this one, which config the cache is of
      cache: cache && { dir: cacheDir, key: path.relative(packageRoot, file) },
      shellFile,
      log,
    });
  } finally {
    if (previous === undefined) delete process.env[WORKER_ENV];
    else process.env[WORKER_ENV] = previous;
    await runner.close();
  }
}

/**
 * The command line's config module and options: `--concurrency <n>` (a
 * whole number above 0; without it, nucleus-ssr's default) and
 * `--no-cache`. No `--save-shell`: the rig saves it to `SHELL_FILE`.
 * @param {string[]} args
 */
export function parseArguments(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    allowNegative: true,
    options: { concurrency: { type: "string" }, cache: { type: "boolean", default: true } },
  });
  const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency);
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1))
    throw new Error(`prerender: --concurrency takes a whole number above 0, not ${values.concurrency}`);
  return { configFile: positionals[0], concurrency, cache: values.cache };
}

/** Whether the module at `url` is the script Node was started with. */
export function isMain(url) {
  try {
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  const { exitCode } = await runPrerender(parseArguments(process.argv.slice(2)));
  process.exitCode = exitCode;
}
