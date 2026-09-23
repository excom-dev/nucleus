import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as zlibConstants } from "node:zlib";
import compression from "compression";
import { build as esbuildBuild, transform } from "esbuild";
import dts from "vite-plugin-dts";
import { coverageConfigDefaults } from "vitest/config";
import { cssConfig } from "./css-config.mjs";
import { readPackageJson } from "./package-type.mjs";
// import { analyzer } from 'vite-bundle-analyzer'

/** Minimum % for statements / branches / functions / lines in `pnpm run coverage`. */
const COVERAGE_THRESHOLD = 90;

/**
 * Vitest worker cap for the test config. Rush already runs packages in
 * parallel, so on CI every package's own worker pool (Vitest defaults to one
 * fork per CPU) multiplies into N packages × N forks on a 2–4 vCPU runner.
 * `HEFT_RIG_VITEST_MAX_WORKERS` (a positive integer) always wins; otherwise CI
 * gets 2 and local runs keep Vitest's default (`undefined`).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number | undefined}
 */
export function resolveVitestMaxWorkers(env = process.env) {
  const explicit = Number.parseInt(env.HEFT_RIG_VITEST_MAX_WORKERS ?? "", 10);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  return env.CI ? 2 : undefined;
}

/**
 * Coverage reporters. CI only reads `coverage-summary.json` /
 * `coverage-final.json` (the PR comment matrix) and the text table, so the
 * HTML report — the slowest reporter and most of the uploaded artifact — is
 * written only for local runs.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function resolveCoverageReporters(env = process.env) {
  return env.CI ? ["text", "json", "json-summary"] : ["text", "json", "json-summary", "html"];
}

/**
 * Coverage thresholds for a package, or `undefined` when its `package.json`
 * carries `excom.coverageThreshold: false`. Packages outside the project's
 * quality bar still run coverage and still report their numbers — only the
 * gate is lifted. Only the literal `false` opts out; anything else keeps 90.
 * @param {{ coverageThreshold?: unknown } | null | undefined} excom
 * @returns {Record<"statements" | "branches" | "functions" | "lines", number> | undefined}
 */
export function resolveCoverageThresholds(excom) {
  if (excom?.coverageThreshold === false) return undefined;
  return {
    statements: COVERAGE_THRESHOLD,
    branches: COVERAGE_THRESHOLD,
    functions: COVERAGE_THRESHOLD,
    lines: COVERAGE_THRESHOLD,
  };
}

/** Forward-slash a path for picomatch globs on Windows. */
const slash = (p) => p.replace(/\\/g, "/");

/**
 * Quark `@use` TypeScript modules: transform in dev, emit stable `[name].js`
 * at build. Plain JS under `public/` (`views/<app>/<app>.js`) needs no entry
 * — static files, imported with their `.js` extension. Extensionless Quark
 * URLs resolve to `<path>.js` here (`quarkModuleRewritePlugin`), but
 * production only rewrites the two modules above (`_redirects`): a
 * `/views/<app>/<app>` line would also capture `/views/<app>/<app>.html`,
 * which Cloudflare Pages 308s to that clean URL.
 */
const SITE_QUARK_MODULES = {
  shell: "shell.ts",
  "demo-utils": "public/demo-utils.ts",
};

/**
 * Packages every element UMD leaves external, and the global each is read
 * from. CDN à la carte: load these two UMDs first (`kit-utils`, then
 * `neutron`); each element UMD stays small. `nucleus-kit` is self-contained.
 */
export const UMD_SHARED_GLOBALS = {
  "@excom/neutron": "NucleusStack.neutron",
  "@excom/kit-utils": "NucleusStack.kitUtils",
};

/** Packages whose UMD keeps every dependency inline. */
const UMD_SELF_CONTAINED = new Set(["@excom/nucleus-kit"]);

const camelCase = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * Global written by a package's UMD build: `NucleusStack.<camelCase short
 * name>` (`@excom/content-drawer` → `NucleusStack.contentDrawer`),
 * extended rather than replaced so several UMDs share the namespace. The
 * self-contained Nucleus Kit keeps the entry name (`index`) it always had.
 * @param {string | undefined} packageName
 * @param {string} entryName
 */
export function umdGlobalName(packageName, entryName) {
  if (!packageName || UMD_SELF_CONTAINED.has(packageName)) return entryName;
  return `NucleusStack.${camelCase(packageName.replace(/^@[^/]+\//, ""))}`;
}

/**
 * Module ids a package's UMD build leaves external: the shared globals,
 * minus the package itself. Nucleus Kit inlines everything.
 * @param {string | undefined} packageName
 * @returns {string[]}
 */
export function umdExternals(packageName) {
  if (!packageName || UMD_SELF_CONTAINED.has(packageName)) return [];
  return Object.keys(UMD_SHARED_GLOBALS).filter((id) => id !== packageName);
}

/**
 * Rolldown `codeSplitting` group name for the progressive Nucleus Kit build:
 * one chunk per workspace package (`progressive/quark.min.js`, …) so elements
 * share the engine chunks and every chunk has a stable, cacheable name.
 * A third-party module joins the chunk of the nearest workspace package that
 * imports it (walking `importers` through the module graph), so
 * `node_modules` code never becomes a chunk of its own; anything else (the
 * entry's own modules, the bundler runtime) falls to Rolldown's default.
 * @param {string} ownPackageDir the building package's folder name
 * @returns {(id: string, ctx?: { getModuleInfo(id: string): { importers: string[] } | null }) => string | undefined}
 */
export function progressiveChunks(ownPackageDir) {
  const packageOf = (id) => {
    const match = slash(id).match(/\/packages\/([^/]+)\//);
    return match && match[1] !== ownPackageDir ? match[1] : undefined;
  };
  return (id, ctx) => {
    const own = packageOf(id);
    if (own || !ctx || !slash(id).includes("/node_modules/")) return own;
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const importers = ctx.getModuleInfo(queue.shift())?.importers ?? [];
      for (const importer of importers) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        const pkg = packageOf(importer);
        if (pkg) return pkg;
        if (slash(importer).includes("/node_modules/")) queue.push(importer);
      }
    }
    return undefined;
  };
}

/**
 * @param {{
 *   mode: string;
 *   root: string;
 *   entry?: string | { name: string; type: string; path: string };
 *   packageRoot?: string;
 * }} options
 * @returns {Promise<import("vite").UserConfig>}
 */
export async function createRigViteConfig({ mode, root, entry, packageRoot }) {
  const rigRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkgRoot = packageRoot ?? root;
  const externalDependencies = [];
  let packageName;
  // Site builds bundle dependencies; lib builds keep them external.
  const isLibBuild = mode.startsWith("build-") && mode !== "build-site";
  if (isLibBuild) {
    const pkgPath = resolve(pkgRoot, "package.json");
    if (await fileExists(pkgPath)) {
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      packageName = pkg.name;
      externalDependencies.push(
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
      );
    }
  }
  return {
    root,
    configFile: false,
    ...(await getConfig(mode, entry, externalDependencies, rigRoot, pkgRoot, packageName)),
  };
}

const baseBuildConfig = {
  emptyOutDir: false,
  outDir: "./dist",
};

/**
 * Library builds minify per output (`MIN_OUTPUT`), not per build, so one
 * Rolldown bundle can emit a readable and a minified file. `minify: false`
 * here leaves the plain output alone (dead-code elimination only);
 * `sourcemap` is a build-level option in Vite, so it is on here and switched
 * off on the plain output.
 */
const LIB_BUILD_BASE = { minify: false, sourcemap: true };

/** Rolldown output options for a `.min.js`: full Oxc minify, legal comments only. */
const MIN_OUTPUT = {
  minify: true,
  comments: { annotation: false, jsdoc: false, legal: true },
};

/**
 * Rolldown diagnostics to silence. `pluginTimings` reports slow plugin hooks
 * (PostCSS under a parallel `rush build` easily crosses its bar) as a warning
 * on stderr, which Rush treats as a failed build.
 */
const ROLLDOWN_CHECKS = { pluginTimings: false };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const JS_TYPE = "application/javascript; charset=utf-8";

/** `/views/todo-app/todo-app` yes; `/`, `/a/`, `/x.js` no. */
function isExtensionless(pathname) {
  return (
    pathname.length > 1 &&
    !pathname.endsWith("/") &&
    !pathname.slice(pathname.lastIndexOf("/") + 1).includes(".")
  );
}

/** A request a module loader made (dynamic `import()`, `<script>`). */
function isScriptRequest(req) {
  return req.headers["sec-fetch-dest"] === "script";
}

function fail(res, status, message) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(message);
}

/**
 * Quark `@use "/shell"` uses native `import()` (`@excom/kit-utils`
 * `resolveModuleReference`), so modules must answer at a stable extensionless URL:
 *
 * - `SITE_QUARK_MODULES`: TS — transform on request in dev, `[name].js` at
 *   build, preview rewrites to it.
 * - Other extensionless paths: rewrite to `<path>.js` under `public/` (dev)
 *   or build output (preview). New example-app modules need no config.
 * - Unresolved module → 404 / 500, not Vite's SPA `index.html` (browser
 *   would reject `text/html` as a module).
 */
function quarkModuleRewritePlugin(packageRoot) {
  const names = Object.keys(SITE_QUARK_MODULES);
  const rewriteMiddleware = (jsRoot) => async (req, res, next) => {
    const [pathname, search] = (req.url ?? "").split("?");
    // Vite URLs (`/@vite/client`, `/@fs/…`, `/@id/…`) and prebundled deps — leave them.
    if (pathname.startsWith("/@") || pathname.startsWith("/node_modules/")) return next();
    if (!isExtensionless(pathname)) return next();
    const name = names.find((n) => pathname === `/${n}`);
    if (name || (await fileExists(resolve(jsRoot, `${pathname.slice(1)}.js`)))) {
      req.url = `${pathname}.js${search ? `?${search}` : ""}`;
      return next();
    }
    if (pathname.startsWith("/views/") || isScriptRequest(req)) {
      return fail(res, 404, `No module at ${pathname} (expected ${pathname}.js)`);
    }
    next();
  };
  return {
    name: "quark-module-extensionless",
    configureServer(server) {
      if (!packageRoot) return;
      // TypeScript sources: `/shell`, `/shell.ts`, `/shell.js` → transformed.
      server.middlewares.use(async (req, res, next) => {
        const [pathname] = (req.url ?? "").split("?");
        const name = names.find(
          (n) =>
            pathname === `/${n}` ||
            pathname === `/${n}.ts` ||
            pathname === `/${n}.js`,
        );
        if (!name) return next();
        try {
          const result = await server.transformRequest(
            "/@fs/" + resolve(packageRoot, SITE_QUARK_MODULES[name]),
          );
          if (!result) throw new Error("transformRequest returned nothing");
          res.setHeader("content-type", JS_TYPE);
          res.end(result.code);
        } catch (err) {
          server.config.logger.error(
            `[quark-module] "/${name}" failed to transform: ${err?.message ?? err}`,
          );
          fail(res, 500, `Module /${name} failed to transform:\n${err?.message ?? err}`);
        }
      });
      // Plain-JS modules under public/ (example apps).
      server.middlewares.use(rewriteMiddleware(resolve(packageRoot, "public")));
    },
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use(rewriteMiddleware(outDir));
    },
  };
}

function compressible(req, res) {
  const type = res.getHeader?.("Content-Type") || res.getHeader?.("content-type");
  if (!type) {
    const url = req.url?.split("?")[0] ?? "";
    return (
      /\.(json|js|mjs|css|html|quark|svg|txt|md|xml|map)$/i.test(url) ||
      url.endsWith("/")
    );
  }
  return compression.filter(req, res);
}

function siteCompressPlugin() {
  const apply = (server) => {
    server.middlewares.use(
      compression({
        threshold: 0,
        filter: compressible,
        brotli: {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
          },
        },
      }),
    );
  };
  return {
    name: "dev-server-compress",
    configureServer: apply,
    configurePreviewServer: apply,
  };
}

function siteServiceWorkerPlugin(packageRoot) {
  const swEntry = resolve(packageRoot, "public/service-worker/service-worker.js");
  const bundle = () =>
    esbuildBuild({
      absWorkingDir: packageRoot,
      entryPoints: [swEntry],
      bundle: true,
      format: "iife",
      write: false,
      platform: "browser",
    }).then((r) => r.outputFiles[0].text);

  return {
    name: "site-service-worker",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== "/service-worker/service-worker.js") {
          return next();
        }
        res.setHeader("content-type", "application/javascript");
        res.setHeader("cache-control", "no-store");
        res.setHeader("service-worker-allowed", "/");
        res.end(await bundle());
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] === "/service-worker/service-worker.js") {
          res.setHeader("service-worker-allowed", "/");
          res.setHeader("cache-control", "no-store");
        }
        next();
      });
    },
    async writeBundle(options) {
      const dir = resolve(options.dir, "service-worker");
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, "service-worker.js"), await bundle());
      await Promise.all(
        Object.values(SITE_QUARK_MODULES)
          .filter((rel) => rel.startsWith("public/"))
          .map((rel) =>
            rm(resolve(options.dir, rel.slice("public/".length)), {
              force: true,
            }),
          ),
      );
      await Promise.all(
        ["api.js", "cache.js", "echo.js", "sandbox.js", "todos.js", "webauthn.js"].map((f) =>
          rm(resolve(dir, f), { force: true }),
        ),
      );
    },
  };
}

/**
 * `/sandbox/<app>` → `sandbox.html` (example-app playground). Production
 * uses `public/_redirects`; dev/preview need this before Vite's SPA fallback.
 */
function sandboxHtmlRewritePlugin() {
  const rewrite = (req, _res, next) => {
    const [pathname, search] = (req.url ?? "").split("?");
    if (/^\/sandbox\/[^/]+\/?$/.test(pathname)) {
      req.url = `/sandbox.html${search ? `?${search}` : ""}`;
    }
    next();
  };
  return {
    name: "sandbox-html-rewrite",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

function siteDevPlugins({ rushRoot, packageRoot }) {
  const plugins = [
    siteCompressPlugin(),
    quarkModuleRewritePlugin(packageRoot),
    sandboxHtmlRewritePlugin(),
    ...(packageRoot ? [siteServiceWorkerPlugin(packageRoot)] : []),
  ];
  // Serve `/packages/<pkg>/<...rest>` from the rush root for docs-site local assets.
  if (rushRoot) {
    plugins.push({
      name: "serve-workspace-packages",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = req.url?.split("?")[0];
          if (!url || !url.startsWith("/packages/")) return next();
          const abs = resolve(rushRoot, url.replace(/^\//, ""));
          if (!abs.startsWith(resolve(rushRoot, "packages") + "/")) {
            return next();
          }
          try {
            const s = await stat(abs);
            if (!s.isFile()) return next();
          } catch {
            return next();
          }
          const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
          res.setHeader("content-type", type);
          createReadStream(abs).pipe(res);
        });
      },
    });
  }
  return plugins;
}

async function getConfig(
  mode,
  entry,
  externalDependencies,
  rigRoot,
  packageRoot,
  packageName,
) {
  const configs = {
    // Demo playground rooted at `support/demos` (element packages).
    dev: async () => {
      const viteRoot = resolve(packageRoot, "support/demos");
      const entryPath =
        typeof entry === "string"
          ? entry
          : entry?.path ?? resolve(viteRoot, "index.html");
      const entryUrl = "/" + relative(viteRoot, entryPath);
      const rushRoot = await findRushRoot(packageRoot);
      const plugins = [
        ...siteDevPlugins({ rushRoot, packageRoot }),
        {
          name: "serve-demo-html",
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url === "/" || req.url?.startsWith("/?")) {
                req.url = entryUrl + (req.url?.slice(1) || "");
              }
              next();
            });
          },
        },
        // Strip `<script type="module" src="/@vite/client">` from non-entry
        // HTML. Demo templates under the Vite root would each open an HMR socket.
        {
          name: "strip-vite-client-from-subtemplates",
          transformIndexHtml: {
            order: "post",
            handler(html, ctx) {
              const path = ctx.path?.split("?")[0];
              if (path === entryUrl || path === "/") return html;
              return html.replace(
                /<script\b[^>]*\/@vite\/client[^>]*><\/script>\s*/g,
                "",
              );
            },
          },
        },
      ];
      return {
        css: cssConfig,
        plugins,
        server: {
          port: 3001,
          host: true,
          watch: {
            usePolling: true,
            ignored: ["**/node_modules/**"],
          },
        },
      };
    },
    // Full site (e.g. docs-site) rooted at the package root with `public/`.
    "dev-site": async () => {
      const rushRoot = await findRushRoot(packageRoot);
      return {
        base: process.env.DOCS_SITE_BASE || "/",
        publicDir: resolve(packageRoot, "public"),
        css: cssConfig,
        plugins: siteDevPlugins({ rushRoot, packageRoot }),
        server: {
          port: 3001,
          host: true,
          watch: {
            usePolling: true,
            ignored: ["**/node_modules/**"],
          },
        },
      };
    },
    "build-site": async () => {
      const quarkInputs = Object.fromEntries(
        Object.entries(SITE_QUARK_MODULES).map(([name, rel]) => [
          name,
          resolve(packageRoot, rel),
        ]),
      );
      const quarkNames = Object.keys(SITE_QUARK_MODULES);
      // Optional second page: the example-app playground preview document.
      const sandboxHtml = resolve(packageRoot, "sandbox.html");
      const pageInputs = (await fileExists(sandboxHtml))
        ? { sandbox: sandboxHtml }
        : {};
      return {
        base: process.env.DOCS_SITE_BASE || "/",
        publicDir: resolve(packageRoot, "public"),
        css: cssConfig,
        plugins: [sandboxHtmlRewritePlugin(), siteServiceWorkerPlugin(packageRoot)],
        build: {
          outDir: resolve(packageRoot, "dist"),
          emptyOutDir: true,
          // Docs site graph is large (~500 kB). Vite's chunk warning is a Rush
          // warning and fails CI (`allowWarningsInSuccessfulBuild=false`).
          chunkSizeWarningLimit: 2000,
          rolldownOptions: {
            checks: ROLLDOWN_CHECKS,
            // Quark loads these via `import(origin + "/demo-utils")`. Without
            // preserved entry exports, the bundler tree-shakes them (no static import).
            preserveEntrySignatures: "exports-only",
            input: {
              main: resolve(packageRoot, "index.html"),
              ...pageInputs,
              ...quarkInputs,
            },
            output: {
              entryFileNames: (chunk) =>
                quarkNames.includes(chunk.name)
                  ? "[name].js"
                  : "assets/[name]-[hash].js",
              chunkFileNames: "assets/[name]-[hash].js",
              assetFileNames: "assets/[name]-[hash][extname]",
            },
          },
        },
      };
    },
    test: async () => {
      // Try to find setup.ts in common locations
      const possibleSetupPaths = [
        resolve(packageRoot, "./test/setup.ts"),
      ];
      const setupFile = await findExistingPath(possibleSetupPaths);
      
      // Always include heft-rig's default setup. Vite only serves the package
      // root, so prefer the node_modules link; the rig's own tests use rig root.
      const linkedSetupFile = resolve(packageRoot, "./node_modules/@excom/heft-rig/profiles/default/config/setup.ts");
      const defaultSetupFile = (await fileExists(linkedSetupFile))
        ? linkedSetupFile
        : resolve(rigRoot, "profiles/default/config/setup.ts");
      const setupFiles = [defaultSetupFile];
      if (setupFile && setupFile !== defaultSetupFile) {
        setupFiles.push(setupFile);
      }

      const isIndividualPackage = packageRoot.includes("packages");
      const packagesDir = dirname(packageRoot);
      const siblingPackageGlobs = (await readdir(packagesDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name !== basename(packageRoot))
        .map((d) => `${slash(packagesDir)}/${d.name}/**`);

      const maxWorkers = resolveVitestMaxWorkers();
      const thresholds = resolveCoverageThresholds((await readPackageJson(packageRoot))?.excom);
      const testAliases = await buildWorkspaceAliases(packageRoot);
      testAliases.push({
        find: "@vitest/coverage-v8",
        replacement: resolve(rigRoot, "node_modules/@vitest/coverage-v8"),
      });
      return {
        resolve: {
          preserveSymlinks: true,
          alias: testAliases,
        },
        test: {
          projects: isIndividualPackage ? undefined : ['packages/*'],
          include: ["**/*.test.ts"],
          globals: true,
          passWithNoTests: true,
          environment: "happy-dom",
          setupFiles: setupFiles,
          ...(maxWorkers === undefined ? {} : { maxWorkers }),
          coverage: {
            provider: "v8",
            reporter: resolveCoverageReporters(),
            reportsDirectory: "./coverage",
            /*
             * This package's source only. Siblings load via `buildWorkspaceAliases`
             * and would dilute numbers — drop files outside the root
             * (`allowExternal: false`). Matching unloaded files still count
             * as uncovered.
             */
            allowExternal: false,
            include: ["**/*.{ts,js,mjs}"],
            exclude: [
              // Vitest 4 `coverageConfigDefaults.exclude` is empty — drop dist/deps ourselves.
              ...coverageConfigDefaults.exclude,
              "**/node_modules/**",
              "**/dist/**",
              // `allowExternal` is a string-prefix check, so `packages/quark`
              // still admits `packages/quark-parser`; drop every sibling.
              ...siblingPackageGlobs,
              "**/coverage/**",
              "**/.output/**",
              "**/.wxt/**",
              "**/support/tests/**",
              "**/support/demos/**",
              "**/support/scripts/**",
              "**/public/service-worker/**",
              "**/*.config.*",
              "**/*.d.ts",
            ],
            // Every metric ≥ 90%, unless the package opted out.
            ...(thresholds ? { thresholds } : {}),
          },
        },
      };
    },
    // ESM pair: `<name>.js` (readable, no sourcemap) and `<name>.min.js`
    // (fully minified + sourcemap) from one Rolldown bundle. Minification is a
    // per-output Rolldown option, so the bundle is parsed and tree-shaken once.
    "build-js": async () => ({
      plugins: (await shouldGenerateDeclarations(entry.path, packageRoot))
        ? [
            dts({
              root: packageRoot,
              entryRoot: packageRoot,
              insertTypesEntry: false,
              tsconfigPath: resolve(packageRoot, "./tsconfig.json"),
              beforeWriteFile(filePath, content) {
                if (!filePath.endsWith(".d.ts")) {
                  return null;
                }
                // `./src/` → `../src/` in dist/ `.d.ts` (source imports `./src/`).
                // Matches import/export from `"./src/..."` or `'./src/...'`.
                const adjusted = content.replace(
                  /((?:import|export)(?:\s+.*?)?\s+from\s+['"])(\.\/src\/)/g,
                  "$1../src/",
                );
                return adjusted === content
                  ? null
                  : { filePath, content: adjusted };
              },
            }),
          ]
        : [],
      build: {
        ...baseBuildConfig,
        ...LIB_BUILD_BASE,
        lib: { entry: entry.path },
        rolldownOptions: {
          checks: ROLLDOWN_CHECKS,
          external: externalDependencies,
          preserveEntrySignatures: "exports-only",
          output: [
            {
              format: "es",
              exports: "named",
              entryFileNames: `${entry.name}.js`,
              chunkFileNames: "[name].js",
              sourcemap: false,
            },
            {
              format: "es",
              exports: "named",
              entryFileNames: `${entry.name}.min.js`,
              chunkFileNames: "[name].min.js",
              ...MIN_OUTPUT,
            },
          ],
        },
      },
    }),
    // UMD: elements read `neutron` / `kit-utils` from `NucleusStack` (`UMD_SHARED_GLOBALS`).
    "build-js-bundle": () => ({
      build: {
        ...baseBuildConfig,
        ...LIB_BUILD_BASE,
        lib: { entry: entry.path },
        rolldownOptions: {
          checks: ROLLDOWN_CHECKS,
          external: umdExternals(packageName),
          // An output *array* is required: a single object would be expanded
          // to Vite's default lib formats (`es` + `umd`).
          output: [
            {
              format: "umd",
              name: umdGlobalName(packageName, entry.name),
              entryFileNames: `${entry.name}.umd.min.js`,
              codeSplitting: false,
              extend: true,
              globals: UMD_SHARED_GLOBALS,
              ...MIN_OUTPUT,
            },
          ],
        },
      },
    }),
    // `<name>.progressive.ts` only: minified ESM + one chunk per workspace
    // package under `dist/progressive/`. No externals — lazy-load on demand.
    "build-js-progressive": () => ({
      build: {
        ...baseBuildConfig,
        ...LIB_BUILD_BASE,
        lib: { entry: entry.path },
        rolldownOptions: {
          checks: ROLLDOWN_CHECKS,
          external: [],
          // Rolldown rejects `exports-only` together with
          // `includeDependenciesRecursively: false`; `allow-extension` still
          // keeps every export of the entry.
          preserveEntrySignatures: "allow-extension",
          output: [
            {
              format: "es",
              exports: "named",
              entryFileNames: `${entry.name}.min.js`,
              chunkFileNames: "progressive/[name].min.js",
              codeSplitting: {
                groups: [
                  {
                    name: progressiveChunks(basename(packageRoot)),
                    // Each module picks its own chunk; a captured module must
                    // not drag its imports into the same chunk.
                    includeDependenciesRecursively: false,
                  },
                ],
              },
              ...MIN_OUTPUT,
            },
          ],
        },
      },
    }),
    // One PostCSS pass → `<name>.css`; `vite-build.mjs` derives `.min.css`
    // and `.bundle.min.css` from it (`writeMinifiedCss`).
    "build-css": () => ({
      css: cssConfig,
      build: {
        ...baseBuildConfig,
        minify: false,
        sourcemap: false,
        rolldownOptions: {
          checks: ROLLDOWN_CHECKS,
          input: entry.path,
          output: {
            assetFileNames: `${entry.name}.css`,
          },
        },
      },
    }),
    preview: () => ({
      build: {
        outDir: resolve(packageRoot, "dist"),
      },
      preview: {
        port: 4173,
        host: true,
      },
      plugins: [siteCompressPlugin(), quarkModuleRewritePlugin()],
    }),
  };
  return configs[mode] ? await configs[mode]() : undefined;
}

/**
 * Vite 8's `'baseline-widely-available'` browser set, used as the esbuild
 * target when minifying CSS so syntax lowering (nested `@media`, …) matches
 * what Vite's own `cssTarget` would do.
 */
export const CSS_MINIFY_TARGET = ["chrome111", "edge111", "firefox114", "safari16.4"];

/**
 * Minify `dist/<name>.css` (written by `build-css`) into `<name>.min.css`
 * and its `<name>.bundle.min.css` twin. esbuild's CSS minifier is what Vite 7
 * used, so the bytes match the separate minified builds this replaces.
 * @param {string} distDir
 * @param {string} name entry name (`basic` → `basic.css`)
 */
export async function writeMinifiedCss(distDir, name) {
  const css = await readFile(resolve(distDir, `${name}.css`), "utf-8");
  const { code } = await transform(css, {
    loader: "css",
    minify: true,
    charset: "utf8",
    target: CSS_MINIFY_TARGET,
  });
  await Promise.all([
    writeFile(resolve(distDir, `${name}.min.css`), code, "utf-8"),
    writeFile(resolve(distDir, `${name}.bundle.min.css`), code, "utf-8"),
  ]);
}

/**
 * Whether `tsconfig.json` enables declarations (respects `extends` and local overrides).
 */
async function shouldGenerateDeclarations(entryFile, packageRoot) {
  // Later: more than `index.ts`; orchestrator may run dts separately.
  if (!entryFile.endsWith("index.ts")) return false;
  const tsconfigPath = resolve(packageRoot, "./tsconfig.json");
  if (!(await fileExists(tsconfigPath))) {
    return true; // No tsconfig → generate declarations
  }

  const tsconfigContent = await readFile(tsconfigPath, "utf-8");
  const tsconfig = JSON.parse(tsconfigContent);

  // Local `declaration: false` wins over `extends`.
  if (tsconfig.compilerOptions?.declaration === false) {
    return false;
  }

  // Local `declaration: true`.
  if (tsconfig.compilerOptions?.declaration === true) {
    return true;
  }

  // No local `declaration` — inherit from `extends`.
  if (tsconfig.extends && tsconfig.compilerOptions?.declaration === undefined) {
    const nodeRequire = createRequire(import.meta.url);
    try {
      const extendedPath = nodeRequire.resolve(tsconfig.extends, {
        paths: [packageRoot],
      });
      const extendedContent = await readFile(extendedPath, "utf-8");
      const extendedConfig = JSON.parse(extendedContent);
      // Honor the extended config's `declaration`.
      return extendedConfig.compilerOptions?.declaration !== false;
    } catch (e) {
      // Unresolved `extends` → generate declarations.
      return true;
    }
  }

  return true; // Generate declarations by default
}


function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findRushRoot(startDir) {
  let current = startDir;
  while (true) {
    if (await fileExists(resolve(current, "rush.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function buildWorkspaceAliases(packageRoot) {
  // Alias workspace deps to source (not dist). Test mode only.
  const rushRoot = await findRushRoot(packageRoot);
  if (!rushRoot) {
    return [];
  }
  const rushPath = resolve(rushRoot, "rush.json");
  const rushConfig = JSON.parse(await readFile(rushPath, "utf-8"));
  const aliases = [];
  for (const project of rushConfig.projects || []) {
    const { packageName, projectFolder } = project || {};
    if (typeof packageName !== "string" || typeof projectFolder !== "string") {
      continue;
    }
    const projectRoot = resolve(rushRoot, projectFolder);
    const indexPath = resolve(projectRoot, "index.ts");
    if (await fileExists(indexPath)) {
      aliases.push({
        find: new RegExp(`^${escapeRegExp(packageName)}$`),
        replacement: indexPath,
      });
    }
    aliases.push({
      find: new RegExp(`^${escapeRegExp(packageName)}\\/(.+)$`),
      replacement: `${projectRoot}/$1`,
    });
  }
  return aliases;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findExistingPath(paths) {
  for (const candidate of paths) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}