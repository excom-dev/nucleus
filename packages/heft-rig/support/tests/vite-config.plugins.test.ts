import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRigViteConfig } from "../../scripts/vite-config.mjs";
import {
  createWorkspace,
  makeReq,
  makeRes,
  makeServer,
  pluginByName,
  waitForFinish,
  type FakeServer,
  type Workspace,
} from "./helpers/vite-fixture";

// The rig's own dev plugins; the site build's are tested in @excom/vite-plugin-nucleus.

let ws: Workspace;

beforeAll(async () => {
  ws = await createWorkspace();
});

afterAll(async () => {
  await ws.cleanup();
});

const devServer = async (name: string, packageRoot = ws.site) => {
  const { plugins } = await createRigViteConfig({ mode: "dev-site", root: packageRoot, packageRoot });
  const server = makeServer(packageRoot);
  (pluginByName(plugins as unknown[], name) as { configureServer: (s: FakeServer) => void }).configureServer(server);
  return server;
};

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
