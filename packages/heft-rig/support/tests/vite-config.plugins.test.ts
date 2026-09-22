import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRigViteConfig } from "../../scripts/vite-config.mjs";
import {
  createWorkspace,
  makeReq,
  makeRes,
  makeServer,
  pluginByName,
  runMiddlewares,
  waitForFinish,
  writeTree,
  type FakeServer,
  type Workspace,
} from "./helpers/vite-fixture";

// Capture the options handed to `compression()` so its `filter` can be
// exercised directly; the real middleware is still returned.
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

let ws: Workspace;
const exists = (p: string) => access(p).then(() => true, () => false);

beforeAll(async () => {
  ws = await createWorkspace();
});

afterAll(async () => {
  await ws.cleanup();
});

type ServerPlugin = {
  configureServer?: (s: FakeServer) => void;
  configurePreviewServer?: (s: FakeServer) => void;
  writeBundle?: (o: { dir: string }) => Promise<void>;
};

const devPlugin = async (name: string, packageRoot = ws.site) =>
  pluginByName(
    (await createRigViteConfig({ mode: "dev-site", root: packageRoot, packageRoot })).plugins as unknown[],
    name,
  ) as ServerPlugin;

const devServer = async (name: string, packageRoot = ws.site) => {
  const server = makeServer(packageRoot);
  (await devPlugin(name, packageRoot)).configureServer!(server);
  return server;
};

const previewServer = async (name: string, packageRoot = ws.site) => {
  const plugin = pluginByName(
    (await createRigViteConfig({ mode: "preview", root: packageRoot })).plugins as unknown[],
    name,
  ) as ServerPlugin;
  const server = makeServer(packageRoot, "dist");
  plugin.configurePreviewServer!(server);
  return server;
};

describe("quark-module-extensionless (dev)", () => {
  it("transforms the TypeScript quark modules at every spelling", async () => {
    const server = await devServer("quark-module-extensionless");
    expect(server.middlewares.fns).toHaveLength(2);
    server.transformRequest.mockResolvedValue({ code: "export const shell = 1;" });

    for (const url of ["/shell", "/shell.ts", "/shell.js?v=1", "/demo-utils"]) {
      const res = makeRes();
      const fell = await runMiddlewares(server.middlewares.fns, makeReq(url), res);
      expect(fell).toBe(false);
      expect(res.headers["content-type"]).toBe("application/javascript; charset=utf-8");
      expect(res.body).toBe("export const shell = 1;");
    }
    expect(server.transformRequest).toHaveBeenNthCalledWith(1, "/@fs/" + path.join(ws.site, "shell.ts"));
    expect(server.transformRequest).toHaveBeenNthCalledWith(4, "/@fs/" + path.join(ws.site, "public/demo-utils.ts"));
  });

  it("answers 500 and logs when a listed module fails to transform", async () => {
    const server = await devServer("quark-module-extensionless");
    server.transformRequest.mockResolvedValueOnce(null);
    let res = makeRes();
    await runMiddlewares(server.middlewares.fns, makeReq("/shell"), res);
    expect(res.statusCode).toBe(500);
    expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.body).toBe("Module /shell failed to transform:\ntransformRequest returned nothing");
    expect(server.config.logger.error).toHaveBeenCalledWith(
      '[quark-module] "/shell" failed to transform: transformRequest returned nothing',
    );

    server.transformRequest.mockRejectedValueOnce(new Error("boom"));
    res = makeRes();
    await runMiddlewares(server.middlewares.fns, makeReq("/shell"), res);
    expect(res.body).toBe("Module /shell failed to transform:\nboom");

    // Non-Error rejections are stringified.
    server.transformRequest.mockRejectedValueOnce("plain failure");
    res = makeRes();
    await runMiddlewares(server.middlewares.fns, makeReq("/demo-utils.ts"), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe("Module /demo-utils failed to transform:\nplain failure");
  });

  it("rewrites extensionless requests to existing public/*.js files", async () => {
    const server = await devServer("quark-module-extensionless");
    const req = makeReq("/views/demo/demo");
    expect(await runMiddlewares(server.middlewares.fns, req, makeRes())).toBe(true);
    expect(req.url).toBe("/views/demo/demo.js");

    const withQuery = makeReq("/views/demo/demo?t=1&x=2");
    await runMiddlewares(server.middlewares.fns, withQuery, makeRes());
    expect(withQuery.url).toBe("/views/demo/demo.js?t=1&x=2");
    expect(server.transformRequest).not.toHaveBeenCalled();
  });

  it("passes non-module requests through untouched", async () => {
    const server = await devServer("quark-module-extensionless");
    for (const url of ["/", "/views/", "/views/demo/demo.js", "/index.html", "/about", undefined]) {
      const req = makeReq(url);
      expect(await runMiddlewares(server.middlewares.fns, req, makeRes())).toBe(true);
      expect(req.url).toBe(url);
    }
  });

  it("answers 404 for unresolved /views/* and script-destination requests", async () => {
    const server = await devServer("quark-module-extensionless");
    let res = makeRes();
    expect(await runMiddlewares(server.middlewares.fns, makeReq("/views/missing/missing"), res)).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe("No module at /views/missing/missing (expected /views/missing/missing.js)");

    res = makeRes();
    await runMiddlewares(server.middlewares.fns, makeReq("/nope", { "sec-fetch-dest": "script" }), res);
    expect(res.statusCode).toBe(404);

    res = makeRes();
    const req = makeReq("/nope", { "sec-fetch-dest": "document" });
    expect(await runMiddlewares(server.middlewares.fns, req, res)).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("lets /nucleus/* deep links fall through to the SPA fallback", async () => {
    const server = await devServer("quark-module-extensionless");
    const routes = [
      "/nucleus",
      "/nucleus/docs/quick_start",
      "/nucleus/packages/quark",
      "/nucleus/packages/quark/modules",
      "/nucleus/examples/todos",
    ];
    for (const url of routes) {
      const req = makeReq(url, { "sec-fetch-dest": "document" });
      const res = makeRes();
      expect(await runMiddlewares(server.middlewares.fns, req, res)).toBe(true);
      expect(req.url).toBe(url);
      expect(res.statusCode).toBe(200);
    }
    expect(server.transformRequest).not.toHaveBeenCalled();
  });

  it("leaves Vite's own extensionless script URLs to Vite", async () => {
    const server = await devServer("quark-module-extensionless");
    for (const url of ["/@vite/client", "/@id/virtual:x", "/node_modules/.vite/deps/idb", "/@fs/x/y"]) {
      const req = makeReq(url, { "sec-fetch-dest": "script" });
      const res = makeRes();
      expect(await runMiddlewares(server.middlewares.fns, req, res)).toBe(true);
      expect(req.url).toBe(url);
      expect(res.statusCode).toBe(200);
    }
  });

  it("registers nothing without a package root (preview config)", async () => {
    const plugin = pluginByName(
      (await createRigViteConfig({ mode: "preview", root: ws.site })).plugins as unknown[],
      "quark-module-extensionless",
    ) as ServerPlugin;
    const server = makeServer();
    plugin.configureServer!(server);
    expect(server.middlewares.fns).toHaveLength(0);
  });
});

describe("quark-module-extensionless (preview)", () => {
  it("rewrites against the build output directory", async () => {
    const server = await previewServer("quark-module-extensionless");
    expect(server.middlewares.fns).toHaveLength(1);
    const listed = makeReq("/shell?x");
    await runMiddlewares(server.middlewares.fns, listed, makeRes());
    expect(listed.url).toBe("/shell.js?x");

    const built = makeReq("/views/demo/demo");
    await runMiddlewares(server.middlewares.fns, built, makeRes());
    expect(built.url).toBe("/views/demo/demo.js");

    const res = makeRes();
    await runMiddlewares(server.middlewares.fns, makeReq("/views/missing"), res);
    expect(res.statusCode).toBe(404);

    const html = makeReq("/index.html");
    expect(await runMiddlewares(server.middlewares.fns, html, makeRes())).toBe(true);
    expect(html.url).toBe("/index.html");
  });
});

describe("dev-server-compress", () => {
  it("registers brotli compression on dev and preview servers", async () => {
    const dev = await devServer("dev-server-compress");
    expect(dev.middlewares.fns).toHaveLength(1);
    const preview = await previewServer("dev-server-compress");
    expect(preview.middlewares.fns).toHaveLength(1);
    expect(compressionMock.lastOptions).toMatchObject({ threshold: 0 });
  });

  it("compresses by content-type, else by URL extension", async () => {
    await devServer("dev-server-compress");
    const filter = compressionMock.lastOptions!.filter;
    const withType = (type: string) => ({ getHeader: (k: string) => (k.toLowerCase() === "content-type" ? type : undefined) });
    expect(filter({ url: "/x.bin" }, withType("text/html"))).toBe(true);
    expect(filter({ url: "/x.js" }, withType("image/png"))).toBe(false);
    // Lower-case header lookup.
    expect(
      filter({ url: "/x" }, { getHeader: (k: string) => (k.toLowerCase() === "content-type" ? "text/css" : undefined) }),
    ).toBe(true);

    const noType = { getHeader: () => undefined };
    expect(filter({ url: "/assets/app.js?v=1" }, noType)).toBe(true);
    expect(filter({ url: "/views/demo/demo.quark" }, noType)).toBe(true);
    expect(filter({ url: "/docs/" }, noType)).toBe(true);
    expect(filter({ url: "/image.png" }, noType)).toBe(false);
    expect(filter({ url: "/shell" }, noType)).toBe(false);
    expect(filter({}, noType)).toBe(false);
    expect(filter({ url: "/x.js" }, {})).toBe(true);
  });
});

describe("site-service-worker", () => {
  it("bundles the worker on request in dev with root scope headers", async () => {
    const server = await devServer("site-service-worker");
    const [mw] = server.middlewares.fns;
    const next = vi.fn();
    await mw(makeReq("/service-worker/other.js"), makeRes(), next);
    await mw(makeReq(undefined), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(2);

    const res = makeRes();
    await mw(makeReq("/service-worker/service-worker.js?v=2"), res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.headers).toEqual({
      "content-type": "application/javascript",
      "cache-control": "no-store",
      "service-worker-allowed": "/",
    });
    // IIFE bundle with the imported module inlined.
    expect(res.body).toMatch(/^\s*\(\(\) => \{/);
    expect(res.body).toContain('"api"');
    expect(res.body).not.toContain("import ");
  });

  it("only adds headers in preview", async () => {
    const plugin = pluginByName(
      (await createRigViteConfig({ mode: "build-site", root: ws.site })).plugins as unknown[],
      "site-service-worker",
    ) as ServerPlugin;
    const server = makeServer();
    plugin.configurePreviewServer!(server);
    const [mw] = server.middlewares.fns;
    const next = vi.fn();
    let res = makeRes();
    mw(makeReq("/service-worker/service-worker.js"), res, next);
    expect(res.headers).toEqual({ "service-worker-allowed": "/", "cache-control": "no-store" });
    res = makeRes();
    mw(makeReq("/index.html"), res, next);
    expect(res.headers).toEqual({});
    mw(makeReq(undefined), res, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("writes the bundle into dist and removes copied module sources", async () => {
    const plugin = pluginByName(
      (await createRigViteConfig({ mode: "build-site", root: ws.site })).plugins as unknown[],
      "site-service-worker",
    ) as ServerPlugin;
    const dir = path.join(ws.site, "dist-sw");
    await writeTree(dir, {
      "demo-utils.ts": "export const demo = 1;\n",
      "service-worker/api.js": "x",
      "service-worker/sandbox.js": "x",
      "service-worker/keep.js": "x",
    });
    await plugin.writeBundle!({ dir });
    const bundled = await readFile(path.join(dir, "service-worker/service-worker.js"), "utf8");
    expect(bundled).toContain('"api"');
    expect(await exists(path.join(dir, "demo-utils.ts"))).toBe(false);
    expect(await exists(path.join(dir, "service-worker/api.js"))).toBe(false);
    expect(await exists(path.join(dir, "service-worker/sandbox.js"))).toBe(false);
    expect(await exists(path.join(dir, "service-worker/keep.js"))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("sandbox-html-rewrite", () => {
  it("serves /sandbox/<app> from sandbox.html in dev and preview", async () => {
    const dev = await devServer("sandbox-html-rewrite");
    const preview = await previewServer("sandbox-html-rewrite").catch(() => null);
    const buildSite = pluginByName(
      (await createRigViteConfig({ mode: "build-site", root: ws.site })).plugins as unknown[],
      "sandbox-html-rewrite",
    ) as ServerPlugin;
    const previewServerFake = makeServer();
    buildSite.configurePreviewServer!(previewServerFake);
    expect(preview).toBeNull();

    for (const server of [dev, previewServerFake]) {
      const [mw] = server.middlewares.fns;
      const next = vi.fn();
      const cases: [string | undefined, string | undefined][] = [
        ["/sandbox/cells-app", "/sandbox.html"],
        ["/sandbox/cells-app/", "/sandbox.html"],
        ["/sandbox/cells-app?embed=1", "/sandbox.html?embed=1"],
        ["/sandbox/a/b", "/sandbox/a/b"],
        ["/sandbox", "/sandbox"],
        ["/sandbox.html", "/sandbox.html"],
        [undefined, undefined],
      ];
      for (const [url, expected] of cases) {
        const req = makeReq(url);
        mw(req, makeRes(), next);
        expect(req.url).toBe(expected);
      }
      expect(next).toHaveBeenCalledTimes(cases.length);
    }
  });
});

describe("serve-workspace-packages", () => {
  it("streams files under the rush root's packages/ with a MIME type", async () => {
    const server = await devServer("serve-workspace-packages");
    const [mw] = server.middlewares.fns;

    const res = makeRes();
    const finished = waitForFinish(res);
    await mw(makeReq("/packages/site/public/views/demo/demo.html?x=1"), res, vi.fn());
    await finished;
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toBe("<p>demo</p>\n");

    const octet = makeRes();
    const octetDone = waitForFinish(octet);
    await mw(makeReq("/packages/site/shell.ts"), octet, vi.fn());
    await octetDone;
    expect(octet.headers["content-type"]).toBe("application/octet-stream");
    expect(octet.body).toBe("export const shell = 'shell';\n");
  });

  it("falls through for other URLs, directories, missing files and escapes", async () => {
    const server = await devServer("serve-workspace-packages");
    const [mw] = server.middlewares.fns;
    for (const url of [
      undefined,
      "/index.html",
      "/packages/site",
      "/packages/site/missing.js",
      "/packages/../rush.json",
      "/packages/",
    ]) {
      const next = vi.fn();
      const res = makeRes();
      await mw(makeReq(url), res, next);
      expect(next, url).toHaveBeenCalledTimes(1);
      expect(res.headers).toEqual({});
    }
  });
});
