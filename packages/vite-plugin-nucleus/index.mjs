/**
 * The build of a static site (pages, Quark modules, a service worker, the
 * Nucleus Kit) for `vite build`, `vite` (dev) and `vite preview`: `nucleus()`
 * in a `vite.config.js`, or `siteConfig()` as one config object. What a site
 * holds decides what is built (`public/` is Vite's `publicDir`):
 *
 * - every `*.html` at the root is a page;
 * - every `*.ts` at the root and under `public/` is a Quark `@use` module
 *   (declarations, `*.config.ts`, `*.test.ts` and `*.spec.ts` are not), built
 *   unhashed to its URL as `.js` (`shell.ts` → `/shell.js`,
 *   `public/utils.ts` → `/utils.js`) and transformed on request there in dev.
 *   An extensionless URL (`@use "/shell"`) needs its `200` line in
 *   `public/_redirects`, in dev as on the host;
 * - `public/service-worker/service-worker.js` is bundled into one classic
 *   script at its own URL, and the files it consumed are not shipped unless a
 *   page or sheet names them;
 * - `public/` is served as it is, `_redirects` and `_headers` included: the
 *   host reads them. Dev applies their `200` rewrites, preview serves the build
 *   as the host does (`host.mjs`, with the site's `wrangler.jsonc`);
 * - `@excom/nucleus-kit/<path>` is bundled from the installed Nucleus Kit, or
 *   with `kit: "unpkg"` loaded from unpkg at that version: a deploy build.
 */
import { cssConfig } from "./css.mjs";
import { hostHandler, rulesOf } from "./host.mjs";
import { kitPlugin, unpkgKitOf } from "./src/kit.mjs";
import compression from "compression";
import { build as esbuild } from "esbuild";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { constants as zlibConstants } from "node:zlib";

const KITS = ["bundled", "unpkg"];
const SERVICE_WORKER = "service-worker/service-worker.js";
const JS_TYPE = "application/javascript; charset=utf-8";
const NOT_MODULE = /\.(d|config|test|spec)\.ts$/;
/** Files a page or sheet names others in. */
const REFERRING = /\.(html|quark|css|js|json|webmanifest)$/;

const posixPath = (path) => path.split(sep).join("/");
const inside = (dir, file) => {
  const from = relative(dir, file);
  return from !== "" && from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from);
};
const withSearch = (pathname, search) => `${pathname}${search ? `?${search}` : ""}`;
/** Vite's own URLs (`/@vite/client`, `/@fs/…`) and prebundled dependencies. */
const isViteUrl = (pathname) => pathname.startsWith("/@") || pathname.startsWith("/node_modules/");
/** Vite's `apply` for the commands named: `build`, `serve` (dev), `preview`. */
const on =
  (...commands) =>
  (_, { command, isPreview }) =>
    commands.includes(isPreview ? "preview" : command);

/**
 * What the site at `root` holds: `pages` and `modules` (`{ name: file }`, a
 * module named by its URL), and the `serviceWorker` entry when there is one.
 * `publicDir`: the files served as they are (`false`: none). Throws when two of
 * them would answer at one URL.
 * @param {string} root
 * @param {string | false} [publicDir]
 */
export async function layoutOf(root, publicDir = join(root, "public")) {
  const [rootFiles, publicFiles] = await Promise.all([
    readdir(root, { withFileTypes: true }),
    publicDir ? readdir(publicDir, { recursive: true, withFileTypes: true }).catch(() => []) : [],
  ]);
  const shown = publicDir && posixPath(relative(root, publicDir));
  const paths = (dir, entries) =>
    entries.filter((entry) => entry.isFile()).map((entry) => posixPath(relative(dir, join(entry.parentPath, entry.name))));
  const named = (dir, list, ext) =>
    list.filter((path) => path.endsWith(ext)).map((path) => [path.slice(0, -ext.length), join(dir, path)]);
  const served = new Set(paths(publicDir, publicFiles));
  const [pages, rootModules, publicModules] = [
    named(root, paths(root, rootFiles), ".html"),
    named(root, paths(root, rootFiles).filter((path) => !NOT_MODULE.test(path)), ".ts"),
    named(publicDir, [...served].filter((path) => !NOT_MODULE.test(path)), ".ts"),
  ];
  const clashes = [
    ...rootModules.filter(([name]) => publicModules.some(([other]) => other === name)).map(([name]) => `${name}.ts and ${shown}/${name}.ts`),
    ...[...rootModules, ...publicModules].filter(([name]) => served.has(`${name}.js`)).map(([name]) => `a module and ${shown}/${name}.js`),
    ...pages.filter(([name]) => [...rootModules, ...publicModules].some(([other]) => other === name)).map(([name]) => `${name}.html and module ${name}`),
  ];
  if (clashes.length) throw new Error(`Two files answer at one URL: ${clashes.join("; ")}`);
  return {
    pages: Object.fromEntries(pages),
    modules: Object.fromEntries([...rootModules, ...publicModules]),
    serviceWorker: served.has(SERVICE_WORKER) ? join(publicDir, SERVICE_WORKER) : undefined,
  };
}

function compressible(req, res) {
  const type = res.getHeader?.("Content-Type") || res.getHeader?.("content-type");
  if (!type) {
    const url = req.url?.split("?")[0] ?? "";
    return /\.(json|js|mjs|css|html|quark|svg|txt|md|xml|map)$/i.test(url) || url.endsWith("/");
  }
  return compression.filter(req, res);
}

/** Brotli on dev and preview responses, as the host compresses them. */
function compressPlugin() {
  const apply = (server) => {
    server.middlewares.use(
      compression({
        threshold: 0,
        filter: compressible,
        brotli: { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } },
      })
    );
  };
  return { name: "nucleus-compress", apply: on("serve", "preview"), configureServer: apply, configurePreviewServer: apply };
}

/** Dev applies the `200` rewrites of `public/_redirects` (`/app/* /app.html 200`), as the host does. */
function rewritesPlugin(site) {
  const rewrite = async (req) => {
    const [pathname, search] = (req.url ?? "").split("?");
    const { publicDir } = site();
    if (isViteUrl(pathname) || !publicDir) return;
    const rule = (await rulesOf(publicDir)).redirect(pathname);
    if (rule?.status === 200) req.url = withSearch(rule.to, search);
  };
  return {
    name: "nucleus-rewrites",
    apply: on("serve"),
    configureServer(server) {
      server.middlewares.use((req, _res, next) => rewrite(req).then(() => next(), next));
    },
  };
}

/** `/views/app/app` yes; `/`, `/a/`, `/x.js` no. */
const isExtensionless = (pathname) =>
  pathname.length > 1 && !pathname.endsWith("/") && !pathname.slice(pathname.lastIndexOf("/") + 1).includes(".");

function fail(res, status, message) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(message);
}

/**
 * Quark `@use "/shell"` is a native `import()` (`@excom/kit-utils`
 * `resolveModuleReference`): a module answers at `/<name>.js`, transformed on
 * request in dev. An extensionless script request nothing rewrote is a 404, as
 * on the host, not the SPA `index.html` a browser rejects as a module. The build
 * drops the TypeScript sources `public/` copied.
 */
function modulesPlugin(site) {
  const transform = (server) => async (req, res, next) => {
    const { modules } = site();
    const [pathname] = (req.url ?? "").split("?");
    const name = Object.keys(modules).find((n) => pathname === `/${n}.js`);
    if (!name) return next();
    try {
      const result = await server.transformRequest(`/@fs/${modules[name]}`);
      if (!result) throw new Error("transformRequest returned nothing");
      res.setHeader("content-type", JS_TYPE);
      res.end(result.code);
    } catch (err) {
      server.config.logger.error(`[nucleus-modules] "/${name}.js" failed to transform: ${err?.message ?? err}`);
      fail(res, 500, `Module /${name}.js failed to transform:\n${err?.message ?? err}`);
    }
  };
  const unresolved = (req, res, next) => {
    const [pathname] = (req.url ?? "").split("?");
    if (isViteUrl(pathname) || !isExtensionless(pathname) || req.headers["sec-fetch-dest"] !== "script") return next();
    const { root, publicDir } = site();
    const redirects = posixPath(relative(root, join(publicDir || root, "_redirects")));
    fail(res, 404, `No module at ${pathname}: import ${pathname}.js, or add a 200 line to ${redirects}`);
  };
  return {
    name: "nucleus-modules",
    apply: on("serve", "build"),
    configureServer(server) {
      server.middlewares.use(transform(server));
      server.middlewares.use(unresolved);
    },
    async writeBundle({ dir }) {
      const { modules, publicDir } = site();
      const copied = publicDir ? Object.values(modules).filter((file) => inside(publicDir, file)) : [];
      await Promise.all(copied.map((file) => rm(join(dir, relative(publicDir, file)), { force: true })));
    },
  };
}

/** The text of every file in `dir` a page or sheet could name others in, but `skipped`. */
async function referringTexts(dir, skipped) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && REFERRING.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !skipped.includes(file));
  return Promise.all(files.map((file) => readFile(file, "utf8")));
}

/**
 * The service worker as one classic script: on request in dev, into the build in
 * place of its sources. A source a page or sheet names by URL stays. Without a
 * worker it does nothing.
 */
function serviceWorkerPlugin(site) {
  const bundle = ({ root, serviceWorker }) =>
    esbuild({
      absWorkingDir: root,
      entryPoints: [serviceWorker],
      bundle: true,
      format: "iife",
      write: false,
      platform: "browser",
      metafile: true,
    });
  return {
    name: "nucleus-service-worker",
    apply: on("serve", "build"),
    configureServer(server) {
      const current = site();
      if (!current.serviceWorker) return;
      const url = `/${posixPath(relative(current.publicDir, current.serviceWorker))}`;
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== url) return next();
        res.setHeader("content-type", "application/javascript");
        res.setHeader("cache-control", "no-store");
        // registered with scope `/` from below the root
        res.setHeader("service-worker-allowed", "/");
        res.end((await bundle(current)).outputFiles[0].text);
      });
    },
    async writeBundle({ dir }) {
      const current = site();
      const { root, publicDir, serviceWorker } = current;
      if (!serviceWorker) return;
      const { outputFiles, metafile } = await bundle(current);
      const copies = Object.keys(metafile.inputs)
        .map((input) => resolve(root, input))
        .filter((file) => inside(publicDir, file))
        .map((file) => join(dir, relative(publicDir, file)));
      const texts = await referringTexts(dir, copies);
      const named = (copy) => texts.some((text) => text.includes(`/${posixPath(relative(dir, copy))}`));
      await Promise.all(copies.filter((copy) => !named(copy)).map((copy) => rm(copy, { force: true })));
      const target = join(dir, relative(publicDir, serviceWorker));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, outputFiles[0].text);
    },
  };
}

/** Preview answers as the host would serve the build. */
function hostPlugin() {
  return {
    name: "nucleus-host",
    apply: on("preview"),
    configurePreviewServer(server) {
      server.middlewares.use(hostHandler(resolve(server.config.root, server.config.build.outDir)));
    },
  };
}

/**
 * The `build` options of `site`: every page and module an input, modules
 * unhashed at their URL, the rest hashed under `assetsDir`.
 */
const buildOf = ({ pages, modules }, { outDir, emptyOutDir, assetsDir }) => {
  const hashed = posix.join(assetsDir, "[name]-[hash]");
  return {
    outDir,
    emptyOutDir,
    rolldownOptions: {
      // modules load through `import()` alone: keep the exports nothing imports
      preserveEntrySignatures: "exports-only",
      input: { ...pages, ...modules },
      output: {
        entryFileNames: (chunk) => (Object.hasOwn(modules, chunk.name) ? "[name].js" : `${hashed}.js`),
        chunkFileNames: `${hashed}.js`,
        assetFileNames: `${hashed}[extname]`,
      },
    },
  };
};

/**
 * The Vite plugin of a Nucleus Stack site: `plugins: [nucleus()]` in
 * `vite.config.js`. Builds every page at the root with its Quark modules and
 * service worker, serves them in dev, and previews the build as Cloudflare
 * Workers static assets serve it (`_redirects`, `_headers`, `wrangler.jsonc`).
 * `kit: "unpkg"` loads the Nucleus Kit from unpkg at the installed version
 * instead of bundling it (deploy builds).
 *
 * It sets the build's inputs and file names (modules unhashed at their URL) and
 * the PostCSS chain: a PostCSS config file is not read, more PostCSS plugins go
 * in `css.postcss.plugins`. `publicDir`, `build.outDir`, `build.emptyOutDir` and
 * `build.assetsDir` stay the app's. The site is read once per config
 * resolution: a page or module added while dev runs needs a restart.
 * @param {{ kit?: "bundled" | "unpkg" }} [options]
 * @returns {import("vite").Plugin[]}
 */
export function nucleus({ kit = "bundled" } = {}) {
  if (!KITS.includes(kit)) throw new Error(`kit "${kit}" is not one of ${KITS.join(", ")}`);
  // read once per config resolution, by the `nucleus` plugin; the others read it
  let site;
  const current = () => site;
  return [
    {
      name: "nucleus",
      async config(config, { command, isPreview }) {
        const root = resolve(config.root ?? process.cwd());
        const { outDir = "dist", emptyOutDir = true, assetsDir = "assets" } = config.build ?? {};
        const build = { outDir: resolve(root, outDir), emptyOutDir, assetsDir };
        if (isPreview) return { build: { outDir: build.outDir } };
        const publicDir = config.publicDir !== false && resolve(root, config.publicDir ?? "public");
        site = {
          root,
          publicDir,
          ...(await layoutOf(root, publicDir)),
          kit: command === "build" && kit === "unpkg" ? await unpkgKitOf(root) : undefined,
        };
        const own = { publicDir, css: cssConfig };
        return command === "build" ? { ...own, build: buildOf(site, build) } : own;
      },
    },
    ...(kit === "unpkg" ? [{ ...kitPlugin(() => site.kit), apply: on("build") }] : []),
    compressPlugin(),
    rewritesPlugin(current),
    modulesPlugin(current),
    serviceWorkerPlugin(current),
    hostPlugin(),
  ];
}

/**
 * The Vite config of the site at `root` for `command` (`build`, `serve` for dev,
 * `preview`): what `nucleus({ kit })` contributes, with its plugins for that
 * command. For a tool that composes its own config object.
 * @param {{ command: "build" | "serve" | "preview", root: string, kit?: "bundled" | "unpkg" }} options
 * @returns {Promise<import("vite").UserConfig>}
 */
export async function siteConfig({ command, root, kit }) {
  const env = { command: command === "build" ? "build" : "serve", isPreview: command === "preview" };
  const [own, ...plugins] = nucleus({ kit }).filter((plugin) => !plugin.apply || plugin.apply({ root }, env));
  return { ...(await own.config({ root }, env)), plugins };
}
