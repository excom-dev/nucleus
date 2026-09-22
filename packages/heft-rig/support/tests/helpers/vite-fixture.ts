import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { vi } from "vitest";

/** Write `{ "rel/path": "content" }` under `root`. */
export const writeTree = async (root: string, files: Record<string, string>) => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
};

export interface Workspace {
  root: string;
  rushRoot: string;
  site: string;
  lib: string;
  linked: string;
  /** A directory with no rush.json anywhere above it. */
  orphan: string;
  cleanup: () => Promise<void>;
}

/**
 * A throwaway Rush workspace: `ws/rush.json` plus a site package, a library
 * package, one with a linked heft-rig setup file, and sibling projects for
 * `buildWorkspaceAliases`.
 */
export const createWorkspace = async (): Promise<Workspace> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-vite-"));
  const rushRoot = path.join(root, "ws");
  const site = path.join(rushRoot, "packages/site");
  const lib = path.join(rushRoot, "packages/lib");
  const linked = path.join(rushRoot, "packages/linked");
  const orphan = path.join(root, "orphan/proj");

  await writeTree(rushRoot, {
    "rush.json": JSON.stringify({
      projects: [
        { packageName: "@excom/alpha", projectFolder: "packages/alpha" },
        { packageName: "@excom/beta", projectFolder: "packages/beta" },
        { packageName: 5, projectFolder: "packages/bad" },
        null,
      ],
    }),
    "packages/alpha/index.ts": "export const alpha = 1;\n",
    "packages/beta/package.json": "{}",
    "packages/site/package.json": JSON.stringify({
      name: "@excom/site",
      dependencies: { "dep-a": "1" },
      peerDependencies: { "peer-b": "1" },
      excom: { packageType: "site" },
    }),
    "packages/site/index.html": "<!doctype html><title>site</title>\n",
    "packages/site/sandbox.html": "<!doctype html><title>sandbox</title>\n",
    "packages/site/shell.ts": "export const shell = 'shell';\n",
    "packages/site/index.ts": "export const site = 1;\n",
    "packages/site/index.css": ".site { color: red }\n",
    "packages/site/public/demo-utils.ts": "export const demo = 1;\n",
    "packages/site/public/views/demo/demo.js": "export default 'demo';\n",
    "packages/site/public/views/demo/demo.html": "<p>demo</p>\n",
    "packages/site/public/service-worker/service-worker.js":
      "import { api } from './api.js';\nself.addEventListener('fetch', () => api());\n",
    "packages/site/public/service-worker/api.js": "export const api = () => 'api';\n",
    "packages/site/dist/shell.js": "export const shell = 1;\n",
    "packages/site/dist/views/demo/demo.js": "export default 'demo';\n",
    "packages/site/support/demos/index.html": "<h1>demos</h1>\n",
    "packages/site/support/demos/other.html": "<h2>other</h2>\n",
    "packages/site/test/setup.ts": "// package setup\n",
    "packages/lib/package.json": JSON.stringify({ name: "@excom/lib" }),
    "packages/lib/index.ts": "export const lib = 1;\n",
    "packages/lib/other.ts": "export const other = 1;\n",
    "packages/linked/package.json": JSON.stringify({ name: "@excom/linked" }),
    "packages/linked/node_modules/@excom/heft-rig/profiles/default/config/setup.ts":
      "// linked setup\n",
  });
  await writeTree(orphan, {
    "package.json": JSON.stringify({ name: "orphan" }),
    "sibling.txt": "",
  });
  await mkdir(path.join(root, "orphan/other"), { recursive: true });

  return {
    root,
    rushRoot,
    site,
    lib,
    linked,
    orphan,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

export interface FakeRes extends Writable {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
  setHeader: (k: string, v: string) => void;
  getHeader: (k: string) => string | undefined;
}

/** A minimal `ServerResponse` stand-in that is also a Writable sink. */
export const makeRes = (): FakeRes => {
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  }) as FakeRes;
  res.statusCode = 200;
  res.headers = {};
  res.ended = false;
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  const end = res.end.bind(res);
  res.end = ((chunk?: unknown) => {
    res.ended = true;
    if (chunk !== undefined && chunk !== null) chunks.push(Buffer.from(chunk as string));
    end();
    return res;
  }) as FakeRes["end"];
  Object.defineProperty(res, "body", {
    get: () => Buffer.concat(chunks).toString("utf8"),
  });
  return res;
};

export const makeReq = (url: string | undefined, headers: Record<string, string> = {}) => ({
  url,
  headers,
});

export interface FakeServer {
  middlewares: { use: (fn: Function) => void; fns: Function[] };
  transformRequest: ReturnType<typeof vi.fn>;
  config: { logger: { error: ReturnType<typeof vi.fn> }; root: string; build: { outDir: string } };
}

export const makeServer = (root = "/", outDir = "dist"): FakeServer => {
  const fns: Function[] = [];
  return {
    middlewares: { use: (fn) => fns.push(fn), fns },
    transformRequest: vi.fn(),
    config: { logger: { error: vi.fn() }, root, build: { outDir } },
  };
};

/** Run every middleware a plugin registered, in order, like connect would. */
export const runMiddlewares = async (fns: Function[], req: object, res: FakeRes) => {
  let fellThrough = false;
  const run = async (i: number): Promise<void> => {
    if (i >= fns.length) {
      fellThrough = true;
      return;
    }
    let nextPromise: Promise<void> | undefined;
    await fns[i](req, res, () => {
      nextPromise = run(i + 1);
      return nextPromise;
    });
    if (nextPromise) await nextPromise;
  };
  await run(0);
  return fellThrough;
};

export const pluginByName = (plugins: unknown[], name: string) => {
  const found = (plugins as { name: string }[]).find((p) => p?.name === name);
  if (!found) throw new Error(`plugin ${name} not found`);
  return found as never;
};

export const waitForFinish = (res: Writable) =>
  new Promise<void>((resolve) => res.on("finish", resolve));
