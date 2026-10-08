import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { duplexPair } from "node:stream";
import { brotliDecompressSync } from "node:zlib";
import { build, createServer, resolveConfig, type ResolvedConfig, type UserConfig } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { layoutOf, nucleus, siteConfig } from "../../index.mjs";
import { makeTempDir, removeDir, writeFiles } from "../../../heft-rig/support/tests/docs-pipeline-fixtures";
import {
  makeReq,
  makeRes,
  makeServer,
  pluginByName,
  runMiddlewares,
  type FakeServer,
} from "../../../heft-rig/support/tests/helpers/vite-fixture";

// Capture the options handed to `compression()` so its `filter` can be exercised directly.
const compressionMock = vi.hoisted(() => ({ lastOptions: undefined as undefined | { filter: Function } }));
vi.mock("compression", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Function & { filter: Function } };
  const wrapped = (options: { filter: Function }) => {
    compressionMock.lastOptions = options;
    return actual.default(options);
  };
  wrapped.filter = actual.default.filter;
  return { default: wrapped };
});

/**
 * A site: two pages, a TypeScript module at the root and one under `public/` (plus a
 * declaration file that is neither), a service worker importing a sibling and a library,
 * a plain public module, the host's rules, and an installed Nucleus Kit whose code and
 * stylesheet carry a marker.
 */
const SITE = {
  "package.json": JSON.stringify({ name: "site", type: "module" }),
  "index.html":
    '<!doctype html><html><head><link rel="stylesheet" href="./shell.css"><script type="module">import "@excom/nucleus-kit/nucleus-kit.progressive";</script></head><body><p>site</p></body></html>\n',
  "sandbox.html": '<!doctype html><html><head><link rel="stylesheet" href="/shell.css"></head><body></body></html>\n',
  "shell.css": '@import "@excom/nucleus-kit/basic.css";\np { color: red; }\n',
  "shell.ts": "export const shell = (n: number): number => n + 1;\n",
  "globals.d.ts": "declare const x: number;\n",
  "vite.config.ts": "export default {};\n",
  "shell.test.ts": "export {};\n",
  "public/demo-utils.ts": "export const demo = (): string => 'demo';\n",
  "public/views/app/app.js": "export default 'app';\n",
  "public/service-worker/service-worker.js":
    "import { api } from './api.js';\nimport { lib } from 'lib';\nself.addEventListener('fetch', () => api() + lib);\n",
  "public/service-worker/api.js": "export const api = () => 'service-worker-api';\n",
  "public/service-worker/notes.txt": "kept\n",
  "public/_redirects": "/shell /shell.js 200\n/sandbox/* /sandbox 200\n/old /new 301\n",
  "node_modules/lib/package.json": JSON.stringify({ name: "lib", type: "module", main: "index.js" }),
  "node_modules/lib/index.js": "export const lib = 'lib';\n",
  "node_modules/@excom/nucleus-kit/package.json": JSON.stringify({ name: "@excom/nucleus-kit", version: "9.9.9" }),
  "node_modules/@excom/nucleus-kit/nucleus-kit.progressive.js": "document.body.dataset.kit = 'kit-code-marker';\n",
  "node_modules/@excom/nucleus-kit/basic.css": ".kit-marker { color: blue; }\n",
};

let tmp: string;
let site: string;
let empty: string;

beforeAll(() => {
  tmp = makeTempDir("vite-plugin-nucleus-site-");
  site = path.join(tmp, "site");
  empty = path.join(tmp, "empty");
  writeFiles(site, SITE);
  writeFiles(empty, { "index.html": "<p>empty</p>" });
});

afterAll(() => removeDir(tmp));

type ServerPlugin = {
  name: string;
  enforce?: string;
  config?: () => unknown;
  configureServer?: (s: FakeServer) => void;
  configurePreviewServer?: (s: FakeServer) => void;
  writeBundle?: (o: { dir: string }) => Promise<void>;
  resolveId?: (source: string) => unknown;
  transform?: (code: string, id: string) => unknown;
};

const names = (plugins: unknown) => (plugins as { name: string }[]).map(({ name }) => name);
const plugin = async (command: "build" | "serve" | "preview", name: string, root = site, kit?: "unpkg") =>
  pluginByName((await siteConfig({ command, root, kit })).plugins as unknown[], name) as ServerPlugin;
const devServer = async (name: string, root = site) => {
  const server = makeServer(root);
  (await plugin("serve", name, root)).configureServer!(server);
  return server;
};

describe("layoutOf", () => {
  it("finds the pages, the modules named by their URL, and the service worker", async () => {
    expect(await layoutOf(site)).toEqual({
      pages: { index: path.join(site, "index.html"), sandbox: path.join(site, "sandbox.html") },
      modules: { shell: path.join(site, "shell.ts"), "demo-utils": path.join(site, "public/demo-utils.ts") },
      serviceWorker: path.join(site, "public/service-worker/service-worker.js"),
    });
  });

  it("names a module below public/ by its path", async () => {
    const nested = path.join(tmp, "nested");
    writeFiles(nested, { "index.html": "", "public/views/app/app.ts": "export {};" });
    expect((await layoutOf(nested)).modules).toEqual({ "views/app/app": path.join(nested, "public/views/app/app.ts") });
  });

  it("refuses two files that would answer at one URL", async () => {
    const clashes = {
      "index.html and module index": { "index.html": "", "index.ts": "" },
      "x.ts and public/x.ts": { "x.ts": "", "public/x.ts": "" },
      "a module and public/a.js": { "public/a.ts": "", "public/a.js": "" },
    };
    for (const [message, files] of Object.entries(clashes)) {
      const dir = path.join(tmp, `clash-${Object.keys(files).join("-").replace(/\//g, "_")}`);
      writeFiles(dir, files);
      await expect(layoutOf(dir)).rejects.toThrow(`Two files answer at one URL: ${message}`);
      await expect(siteConfig({ command: "serve", root: dir })).rejects.toThrow(message);
    }
  });

  it("finds nothing more in a site that holds only a page", async () => {
    expect(await layoutOf(empty)).toEqual({ pages: { index: path.join(empty, "index.html") }, modules: {}, serviceWorker: undefined });
  });
});

describe("siteConfig", () => {
  it("refuses an unknown kit", async () => {
    await expect(siteConfig({ command: "build", root: site, kit: "cdn" as never })).rejects.toThrow(
      'kit "cdn" is not one of bundled, unpkg'
    );
  });

  it("builds every page and module: modules unhashed at their URL, the rest under assets/", async () => {
    const config = await siteConfig({ command: "build", root: site });
    expect(config.publicDir).toBe(path.join(site, "public"));
    expect(config.css).toBeDefined();
    expect(names(config.plugins)).toEqual(["nucleus-modules", "nucleus-service-worker"]);
    const build = config.build!;
    expect([build.outDir, build.emptyOutDir]).toEqual([path.join(site, "dist"), true]);
    const rolldown = build.rolldownOptions!;
    expect(rolldown.preserveEntrySignatures).toBe("exports-only");
    expect(rolldown.input).toEqual({
      index: path.join(site, "index.html"),
      sandbox: path.join(site, "sandbox.html"),
      shell: path.join(site, "shell.ts"),
      "demo-utils": path.join(site, "public/demo-utils.ts"),
    });
    const output = rolldown.output as { entryFileNames: (c: { name: string }) => string; chunkFileNames: string; assetFileNames: string };
    expect(["shell", "demo-utils", "index", "constructor"].map((name) => output.entryFileNames({ name }))).toEqual([
      "[name].js",
      "[name].js",
      "assets/[name]-[hash].js",
      "assets/[name]-[hash].js",
    ]);
    expect([output.chunkFileNames, output.assetFileNames]).toEqual(["assets/[name]-[hash].js", "assets/[name]-[hash][extname]"]);
    // without a worker the worker plugin does nothing (nucleus-service-worker)
    expect(names((await siteConfig({ command: "build", root: empty })).plugins)).toEqual(["nucleus-modules", "nucleus-service-worker"]);
  });

  it("serves public/, the rewrites, the modules and the worker in dev", async () => {
    const config = await siteConfig({ command: "serve", root: site });
    expect(config.publicDir).toBe(path.join(site, "public"));
    expect(names(config.plugins)).toEqual(["nucleus-compress", "nucleus-rewrites", "nucleus-modules", "nucleus-service-worker"]);
    expect(names((await siteConfig({ command: "serve", root: empty })).plugins)).toEqual(names(config.plugins));
  });

  it("previews dist as the host serves it", async () => {
    const config = await siteConfig({ command: "preview", root: site });
    expect(config.build).toEqual({ outDir: path.join(site, "dist") });
    expect(names(config.plugins)).toEqual(["nucleus-compress", "nucleus-host"]);
  });
});

describe("nucleus-modules", () => {
  it("transforms a TypeScript module at its .js URL alone, as the build serves it", async () => {
    const server = await devServer("nucleus-modules");
    expect(server.middlewares.fns).toHaveLength(2);
    server.transformRequest.mockResolvedValue({ code: "export const shell = 1;" });
    for (const url of ["/shell.js?v=1", "/demo-utils.js"]) {
      const res = makeRes();
      expect(await runMiddlewares(server.middlewares.fns, makeReq(url), res)).toBe(false);
      expect([res.headers["content-type"], res.body]).toEqual(["application/javascript; charset=utf-8", "export const shell = 1;"]);
    }
    expect(server.transformRequest.mock.calls).toEqual([
      [`/@fs/${path.join(site, "shell.ts")}`],
      [`/@fs/${path.join(site, "public/demo-utils.ts")}`],
    ]);
    // `/shell` is `/shell.js` once its `_redirects` line rewrote it (nucleus-rewrites)
    for (const url of ["/shell.ts", "/demo-utils.ts"]) expect(await runMiddlewares(server.middlewares.fns, makeReq(url), makeRes())).toBe(true);
    expect(server.transformRequest).toHaveBeenCalledTimes(2);
  });

  it("answers 500 and logs when a module fails to transform", async () => {
    const server = await devServer("nucleus-modules");
    server.transformRequest.mockResolvedValueOnce(null);
    let res = makeRes();
    await runMiddlewares(server.middlewares.fns, makeReq("/shell.js"), res);
    expect([res.statusCode, res.body]).toEqual([500, "Module /shell.js failed to transform:\ntransformRequest returned nothing"]);
    expect(server.config.logger.error).toHaveBeenCalledWith(
      '[nucleus-modules] "/shell.js" failed to transform: transformRequest returned nothing'
    );
    server.transformRequest.mockRejectedValueOnce("plain failure");
    res = makeRes();
    await runMiddlewares(server.middlewares.fns, makeReq("/demo-utils.js"), res);
    expect([res.statusCode, res.body]).toEqual([500, "Module /demo-utils.js failed to transform:\nplain failure"]);
  });

  it("answers an extensionless script request nothing rewrote with a 404, as the host would", async () => {
    const server = await devServer("nucleus-modules");
    for (const url of ["/views/x/x", "/views/app/app", "/demo-utils"]) {
      const res = makeRes();
      expect(await runMiddlewares(server.middlewares.fns, makeReq(url, { "sec-fetch-dest": "script" }), res)).toBe(false);
      expect([res.statusCode, res.body]).toEqual([404, `No module at ${url}: import ${url}.js, or add a 200 line to public/_redirects`]);
    }
    for (const url of ["/", "/views/", "/views/app/app.js", "/index.html", "/nucleus/docs/x", "/@vite/client", "/node_modules/.vite/deps/idb", undefined]) {
      const req = makeReq(url, url?.startsWith("/@") || url?.startsWith("/node") ? { "sec-fetch-dest": "script" } : {});
      const other = makeRes();
      expect(await runMiddlewares(server.middlewares.fns, req, other)).toBe(true);
      expect([req.url, other.statusCode]).toEqual([url, 200]);
    }
  });

  it("drops the TypeScript sources public/ copied into the build", async () => {
    const dir = path.join(tmp, "dist-modules");
    writeFiles(dir, { "demo-utils.ts": "", "demo-utils.js": "", "shell.ts": "" });
    await (await plugin("build", "nucleus-modules")).writeBundle!({ dir });
    expect(readdirSync(dir).sort()).toEqual(["demo-utils.js", "shell.ts"]);
  });
});

describe("nucleus-service-worker", () => {
  it("bundles the worker on request in dev, with root scope headers", async () => {
    const [mw] = (await devServer("nucleus-service-worker")).middlewares.fns;
    const next = vi.fn();
    await mw(makeReq("/service-worker/api.js"), makeRes(), next);
    await mw(makeReq(undefined), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
    const res = makeRes();
    await mw(makeReq("/service-worker/service-worker.js?v=2"), res, next);
    expect(res.headers).toEqual({
      "content-type": "application/javascript",
      "cache-control": "no-store",
      "service-worker-allowed": "/",
    });
    expect(res.body).toMatch(/^\s*\(\(\) => \{/);
    expect(res.body).toContain("service-worker-api");
    expect(res.body).not.toContain("import ");
  });

  it("writes the bundle into the build in place of the sources it consumed", async () => {
    const dir = path.join(tmp, "dist-worker");
    writeFiles(dir, { "service-worker/service-worker.js": "import", "service-worker/api.js": "x", "service-worker/notes.txt": "kept" });
    await (await plugin("build", "nucleus-service-worker")).writeBundle!({ dir });
    expect(readdirSync(path.join(dir, "service-worker")).sort()).toEqual(["notes.txt", "service-worker.js"]);
    const bundled = readFileSync(path.join(dir, "service-worker/service-worker.js"), "utf8");
    expect(bundled).toContain("service-worker-api");
    expect(bundled).toContain('"lib"');
  });

  it("does nothing for a site without a worker", async () => {
    expect((await devServer("nucleus-service-worker", empty)).middlewares.fns).toEqual([]);
    const dir = path.join(tmp, "dist-no-worker");
    writeFiles(dir, { "index.html": "" });
    await (await plugin("build", "nucleus-service-worker", empty)).writeBundle!({ dir });
    expect(readdirSync(dir)).toEqual(["index.html"]);
  });

  it("keeps a source a page or sheet names by its URL", async () => {
    const dir = path.join(tmp, "dist-worker-named");
    writeFiles(dir, {
      "service-worker/service-worker.js": "import",
      "service-worker/api.js": "x",
      "views/app/app.quark": '@use "/service-worker/api.js" as *;',
    });
    await (await plugin("build", "nucleus-service-worker")).writeBundle!({ dir });
    expect(readdirSync(path.join(dir, "service-worker")).sort()).toEqual(["api.js", "service-worker.js"]);
  });
});

describe("nucleus-rewrites", () => {
  it("applies the 200 rewrites of public/_redirects in dev, keeping the query", async () => {
    const [mw] = (await devServer("nucleus-rewrites")).middlewares.fns;
    const cases = [
      ["/sandbox/cells-app?embed=1", "/sandbox?embed=1"],
      ["/shell", "/shell.js"],
      ["/old", "/old"],
      ["/other", "/other"],
      [undefined, "/"],
    ];
    for (const [url, rewritten] of cases) {
      const req = makeReq(url);
      await new Promise((done) => mw(req, makeRes(), done));
      expect(req.url ?? "/").toBe(rewritten);
    }
    const catchAll = path.join(tmp, "catch-all");
    writeFiles(catchAll, { "index.html": "", "public/_redirects": "/* /app.html 200\n" });
    const [all] = (await devServer("nucleus-rewrites", catchAll)).middlewares.fns;
    for (const [url, rewritten] of [["/@vite/client", "/@vite/client"], ["/node_modules/.vite/deps/x.js", "/node_modules/.vite/deps/x.js"], ["/route", "/app.html"]]) {
      const req = makeReq(url);
      await new Promise((done) => all(req, makeRes(), done));
      expect(req.url).toBe(rewritten);
    }
    const [none] = (await devServer("nucleus-rewrites", empty)).middlewares.fns;
    const req = makeReq("/sandbox/x");
    await new Promise((done) => none(req, makeRes(), done));
    expect(req.url).toBe("/sandbox/x");
  });
});

describe("nucleus-compress", () => {
  it("registers brotli compression on dev and preview servers", async () => {
    expect((await devServer("nucleus-compress")).middlewares.fns).toHaveLength(1);
    const preview = makeServer(site);
    (await plugin("preview", "nucleus-compress")).configurePreviewServer!(preview);
    expect(preview.middlewares.fns).toHaveLength(1);
    expect(compressionMock.lastOptions).toMatchObject({ threshold: 0 });
  });

  it("compresses by content-type, else by URL extension", async () => {
    await devServer("nucleus-compress");
    const filter = compressionMock.lastOptions!.filter;
    const withType = (type: string) => ({ getHeader: (k: string) => (k.toLowerCase() === "content-type" ? type : undefined) });
    expect(filter({ url: "/x.bin" }, withType("text/html"))).toBe(true);
    expect(filter({ url: "/x.js" }, withType("image/png"))).toBe(false);
    const noType = { getHeader: () => undefined };
    expect(filter({ url: "/assets/app.js?v=1" }, noType)).toBe(true);
    expect(filter({ url: "/views/demo/demo.quark" }, noType)).toBe(true);
    expect(filter({ url: "/docs/" }, noType)).toBe(true);
    expect(filter({ url: "/image.png" }, noType)).toBe(false);
    expect(filter({}, noType)).toBe(false);
    expect(filter({ url: "/x.js" }, {})).toBe(true);
  });
});

describe("nucleus-host", () => {
  it("answers preview requests from the build output as the host would", async () => {
    const pkg = path.join(tmp, "previewed");
    writeFiles(pkg, {
      "wrangler.jsonc": '{ "assets": { "directory": "./dist", "not_found_handling": "404-page" } }',
      "dist/404.html": "<h1>not found</h1>",
      "dist/a.html": "<h1>a</h1>",
    });
    const server = makeServer(pkg, "dist");
    (await plugin("preview", "nucleus-host", pkg)).configurePreviewServer!(server);
    const page = makeRes();
    await server.middlewares.fns[0]({ url: "/a" }, page);
    expect([page.statusCode, page.body]).toEqual([200, "<h1>a</h1>"]);
    const missing = makeRes();
    await server.middlewares.fns[0]({ url: "/nope" }, missing);
    expect([missing.statusCode, missing.body]).toEqual([404, "<h1>not found</h1>"]);
  });
});

describe("a real build", () => {
  const run = async (kit: "bundled" | "unpkg") => {
    const config = await siteConfig({ command: "build", root: site, kit });
    await build({ ...config, root: site, configFile: false, logLevel: "silent" });
    const dist = path.join(site, "dist");
    const files = readdirSync(dist, { recursive: true }).map(String).sort();
    const read = (file: string) => readFileSync(path.join(dist, file), "utf8");
    const all = files.filter((file) => /\.(js|css|html)$/.test(file)).map(read).join("\n");
    return { files, read, all };
  };

  it("bundles the Nucleus Kit by default, and ships the site's conventions", async () => {
    const { files, read, all } = await run("bundled");
    expect(files.filter((file) => !file.startsWith("assets"))).toEqual([
      "_redirects",
      "demo-utils.js",
      "index.html",
      "sandbox.html",
      "service-worker",
      "service-worker/notes.txt",
      "service-worker/service-worker.js",
      "shell.js",
      "views",
      "views/app",
      "views/app/app.js",
    ]);
    expect(read("shell.js")).toContain("export");
    expect(read("service-worker/service-worker.js")).toContain("service-worker-api");
    expect(read("index.html")).toMatch(/<script type="module" crossorigin src="\/assets\/index-[\w-]+\.js"><\/script>/);
    expect(all).toContain("kit-code-marker");
    expect(all).toContain(".kit-marker");
  });

  it("loads the Nucleus Kit from unpkg with kit: \"unpkg\": none of it in the build", async () => {
    const { files, read, all } = await run("unpkg");
    expect(read("index.html")).toContain(
      '<script type="module" crossorigin src="https://unpkg.com/@excom/nucleus-kit@9.9.9/dist/nucleus-kit.progressive.min.js"></script>'
    );
    const [css] = files.filter((file) => file.endsWith(".css"));
    expect(read(css)).not.toContain("@import");
    // both pages link shell.css: both carry the kit's sheet, before their own
    for (const page of ["index.html", "sandbox.html"])
      expect(read(page)).toMatch(
        /<link rel="preconnect" href="https:\/\/unpkg\.com" crossorigin>\s*<link rel="stylesheet" href="https:\/\/unpkg\.com\/@excom\/nucleus-kit@9\.9\.9\/dist\/basic\.css" crossorigin>[\s\S]*<link rel="stylesheet" crossorigin href="\/assets\//
      );
    expect(all).not.toContain("kit-code-marker");
    expect(all).not.toContain(".kit-marker");
    expect(files.filter((file) => file.startsWith("assets/"))).toEqual([css]);
    expect(existsSync(path.join(site, "dist/shell.js"))).toBe(true);
  });
});

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** One request to `handler` over an in-memory connection: real HTTP, no port bound. */
const request = (handler: Handler, url: string, headers: Record<string, string> = {}) =>
  new Promise<{ status?: number; headers: IncomingHttpHeaders; body: Buffer }>((done, fail) => {
    const server = createHttpServer(handler);
    const connect = () => {
      const [client, socket] = duplexPair();
      server.emit("connection", socket);
      return client;
    };
    httpRequest({ path: url, headers, createConnection: connect }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    })
      .on("error", fail)
      .end();
  });

/** Every file under `dir`: its path, its bytes. */
const filesOf = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
      .map((file) => [path.relative(dir, file), readFileSync(file)])
  );

/** An app's config: `plugins: [nucleus()]` and its own root, beside the working directory. */
const USER = { configFile: false, logLevel: "silent" } as const;
const ours = (config: ResolvedConfig) => names(config.plugins).filter((name) => name.startsWith("nucleus"));

describe("nucleus()", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses an unknown kit", () => {
    expect(() => nucleus({ kit: "cdn" as never })).toThrow('kit "cdn" is not one of bundled, unpkg');
  });

  it("applies each plugin for its commands, and contributes the site's config, as Vite resolves it", async () => {
    const resolved = (command: "build" | "serve", isPreview = false, kit?: "unpkg") =>
      resolveConfig({ ...USER, root: site, plugins: [nucleus({ kit })] }, command, "production", "production", isPreview);
    const unpkg = await resolved("build", false, "unpkg");
    expect(ours(unpkg)).toEqual(["nucleus-kit", "nucleus", "nucleus-modules", "nucleus-service-worker"]);
    expect(unpkg.build.modulePreload).toMatchObject({ polyfill: false });
    const bundled = await resolved("build");
    const expected = (await siteConfig({ command: "build", root: site })).build!;
    expect(ours(bundled)).toEqual(["nucleus", "nucleus-modules", "nucleus-service-worker"]);
    expect([bundled.publicDir, bundled.build.outDir, bundled.build.emptyOutDir]).toEqual([path.join(site, "public"), expected.outDir, true]);
    expect(bundled.build.rolldownOptions.input).toEqual(expected.rolldownOptions!.input);
    // the kit switch is for builds alone
    const dev = await resolved("serve", false, "unpkg");
    expect(ours(dev)).toEqual(["nucleus", "nucleus-compress", "nucleus-rewrites", "nucleus-modules", "nucleus-service-worker"]);
    expect(dev.publicDir).toBe(path.join(site, "public"));
    const previewed = await resolved("serve", true, "unpkg");
    expect(ours(previewed)).toEqual(["nucleus", "nucleus-compress", "nucleus-host"]);
    expect(previewed.build.outDir).toBe(path.join(site, "dist"));
  });

  it("builds what siteConfig() builds, file for file, from a user config with its own root", async () => {
    expect(process.cwd()).not.toBe(site);
    const dist = path.join(site, "dist");
    for (const kit of ["bundled", "unpkg"] as const) {
      await build({ ...USER, root: site, plugins: [nucleus({ kit })] });
      const built = filesOf(dist);
      await build({ ...(await siteConfig({ command: "build", root: site, kit })), ...USER, root: site });
      expect(Object.keys(built)).toEqual(expect.arrayContaining(["index.html", "shell.js", "service-worker/service-worker.js"]));
      expect(filesOf(dist), kit).toEqual(built);
    }
  });

  it("reads a relative root from the working directory, and takes the working directory without one", async () => {
    const [own] = nucleus() as unknown as [{ config: (config: UserConfig, env: object) => Promise<UserConfig> }];
    const env = { command: "build", isPreview: false, mode: "production" };
    const input = (await own.config({ root: path.relative(process.cwd(), empty) }, env)).build!.rolldownOptions!.input;
    expect(input).toEqual({ index: path.join(empty, "index.html") });
    vi.spyOn(process, "cwd").mockReturnValue(empty);
    expect(await own.config({}, { ...env, command: "serve" })).toEqual({ publicDir: path.join(empty, "public"), css: expect.anything() });
    expect(await own.config({}, { ...env, command: "serve", isPreview: true })).toEqual({ build: { outDir: path.join(empty, "dist") } });
  });

  it("reads each config resolution's own site, one nucleus() resolved twice", async () => {
    const plugins = nucleus();
    await resolveConfig({ ...USER, root: site, plugins }, "build");
    const second = await resolveConfig({ ...USER, root: empty, plugins }, "build");
    expect(second.build.rolldownOptions.input).toEqual({ index: path.join(empty, "index.html") });
    // the empty site has no worker: nothing to write in its place
    const dir = path.join(tmp, "dist-second");
    writeFiles(dir, { "index.html": "" });
    await (pluginByName(plugins, "nucleus-service-worker") as ServerPlugin).writeBundle!({ dir });
    expect(readdirSync(dir)).toEqual(["index.html"]);
  });

  it("serves the site in dev: the rewrites, the modules at their URL, the worker, compressed", async () => {
    const server = await createServer({
      ...USER,
      root: site,
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
      plugins: [nucleus()],
    });
    try {
      // `/shell /shell.js 200` in public/_redirects
      const shell = await request(server.middlewares, "/shell");
      expect([shell.status, shell.headers["content-type"]]).toEqual([200, "application/javascript; charset=utf-8"]);
      expect(shell.body.toString()).toContain("export const shell = (n) => n + 1");
      const worker = await request(server.middlewares, "/service-worker/service-worker.js", { "accept-encoding": "br" });
      expect([worker.headers["content-encoding"], worker.headers["service-worker-allowed"]]).toEqual(["br", "/"]);
      expect(brotliDecompressSync(worker.body).toString()).toContain("service-worker-api");
      const missing = await request(server.middlewares, "/views/x/x", { "sec-fetch-dest": "script" });
      expect([missing.status, missing.body.toString()]).toEqual([
        404,
        "No module at /views/x/x: import /views/x/x.js, or add a 200 line to public/_redirects",
      ]);
    } finally {
      await server.close();
    }
  });

  it("previews the build as the host serves it, compressed", async () => {
    const root = path.join(tmp, "previewed-site");
    writeFiles(root, {
      "wrangler.jsonc": '{ "assets": { "directory": "./dist", "not_found_handling": "404-page" } }',
      "dist/404.html": "<h1>not found</h1>",
      "dist/a.html": "<h1>a</h1>",
    });
    // the preview server's middlewares, as Vite resolves the config for `vite preview`; no port bound
    const config = await resolveConfig({ ...USER, root, plugins: [nucleus()] }, "serve", "production", "production", true);
    const stack: Function[] = [];
    for (const plugin of config.plugins.filter(({ name }) => name.startsWith("nucleus")))
      (plugin.configurePreviewServer as Function | undefined)?.({ config, middlewares: { use: (fn: Function) => stack.push(fn) } });
    const handler: Handler = (req, res) => {
      const run = (index: number): void => stack[index]?.(req, res, () => run(index + 1));
      run(0);
    };
    const page = await request(handler, "/a", { "accept-encoding": "br" });
    expect([page.status, page.headers["content-encoding"], brotliDecompressSync(page.body).toString()]).toEqual([200, "br", "<h1>a</h1>"]);
    expect([(await request(handler, "/a.html")).headers.location]).toEqual(["/a"]);
    const missing = await request(handler, "/nope");
    expect([missing.status, missing.body.toString()]).toEqual([404, "<h1>not found</h1>"]);
  });
});

describe("nucleus() and the app's own directories", () => {
  /** A site whose public files are in `static/`, built into `out/` beside a file kept from an earlier build. */
  const CUSTOM = {
    "index.html": '<!doctype html><html><head><link rel="stylesheet" href="./style.css"><script type="module">console.log("page");</script></head><body></body></html>\n',
    "style.css": "p { color: red; }\n",
    "static/_redirects": "/utils /utils.js 200\n",
    "static/utils.ts": "export const utils = (n: number): number => n * 2;\n",
    "static/robots.txt": "robots\n",
    "static/service-worker/service-worker.js": "import { api } from './api.js';\nself.api = api;\n",
    "static/service-worker/api.js": "export const api = 'custom-worker-api';\n",
    "public/ignored.ts": "export const ignored = 1;\n",
    "out/stale.txt": "kept\n",
  };
  const OWN = { publicDir: "static", build: { outDir: "out", emptyOutDir: false, assetsDir: "static-assets" } };
  let custom: string;

  beforeAll(() => {
    custom = path.join(tmp, "custom");
    writeFiles(custom, CUSTOM);
  });

  it("builds into the app's outDir and assetsDir, from its publicDir, keeping what emptyOutDir: false keeps", async () => {
    await build({ ...USER, ...OWN, root: custom, plugins: [nucleus()] });
    const out = filesOf(path.join(custom, "out"));
    expect(Object.keys(out).filter((file) => !file.startsWith("static-assets/")).sort()).toEqual([
      "_redirects",
      "index.html",
      "robots.txt",
      "service-worker/service-worker.js",
      "stale.txt",
      "utils.js",
    ]);
    expect(Object.keys(out).filter((file) => file.startsWith("static-assets/")).map((file) => path.extname(file)).sort()).toEqual([".css", ".js"]);
    expect(out["utils.js"].toString()).toContain("export");
    expect(out["service-worker/service-worker.js"].toString()).toContain("custom-worker-api");
    expect(out["index.html"].toString()).toMatch(/href="\/static-assets\/index-[\w-]+\.css"/);
    expect(existsSync(path.join(custom, "dist"))).toBe(false);
  });

  it("serves the app's publicDir in dev, its rewrites and modules", async () => {
    const server = await createServer({
      ...USER,
      ...OWN,
      root: custom,
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true },
      plugins: [nucleus()],
    });
    try {
      const utils = await request(server.middlewares, "/utils");
      expect([utils.status, utils.body.toString()]).toEqual([200, expect.stringContaining("export const utils = (n) => n * 2")]);
      const worker = await request(server.middlewares, "/service-worker/service-worker.js");
      expect(worker.body.toString()).toContain("custom-worker-api");
      const missing = await request(server.middlewares, "/ignored", { "sec-fetch-dest": "script" });
      expect([missing.status, missing.body.toString()]).toEqual([
        404,
        "No module at /ignored: import /ignored.js, or add a 200 line to static/_redirects",
      ]);
    } finally {
      await server.close();
    }
  });

  it("previews the app's outDir", async () => {
    const config = await resolveConfig({ ...USER, ...OWN, root: custom, plugins: [nucleus()] }, "serve", "production", "production", true);
    expect(config.build.outDir).toBe(path.join(custom, "out"));
    const stack: Function[] = [];
    for (const plugin of config.plugins.filter(({ name }) => name === "nucleus-host"))
      (plugin.configurePreviewServer as Function)({ config, middlewares: { use: (fn: Function) => stack.push(fn) } });
    const stale = await request((req, res) => stack[0](req, res), "/stale.txt");
    expect([stale.status, stale.body.toString()]).toEqual([200, "kept\n"]);
  });

  it("builds a site with no publicDir: nothing served as it is, no module or worker there", async () => {
    const bare = path.join(tmp, "no-public");
    writeFiles(bare, { "index.html": "<!doctype html><p>bare</p>\n", "public/x.ts": "export const x = 1;\n", "public/_redirects": "/x /x.js 200\n" });
    expect(await layoutOf(bare, false)).toEqual({ pages: { index: path.join(bare, "index.html") }, modules: {}, serviceWorker: undefined });
    await build({ ...USER, root: bare, publicDir: false, plugins: [nucleus()] });
    expect(Object.keys(filesOf(path.join(bare, "dist")))).toEqual(["index.html"]);
    const plugins = nucleus();
    await resolveConfig({ ...USER, root: bare, publicDir: false, plugins }, "serve");
    const server = makeServer(bare);
    (pluginByName(plugins, "nucleus-rewrites") as ServerPlugin).configureServer!(server);
    const req = makeReq("/x");
    await new Promise((done) => server.middlewares.fns[0](req, makeRes(), done));
    expect(req.url).toBe("/x");
  });
});
