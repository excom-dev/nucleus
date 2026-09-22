import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspace, writeTree, type Workspace } from "./helpers/vite-fixture";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  prepareSiteDocs: vi.fn(),
  server: { listen: vi.fn(), printUrls: vi.fn(), bindCLIShortcuts: vi.fn() },
}));
vi.mock("vite", () => ({ createServer: mocks.createServer }));
vi.mock("../../scripts/collect-docs-metas.mjs", () => ({
  prepareSiteDocs: mocks.prepareSiteDocs,
}));

let ws: Workspace;

beforeAll(async () => {
  ws = await createWorkspace();
});

afterAll(async () => {
  await ws.cleanup();
});

beforeEach(() => {
  vi.resetModules();
  mocks.createServer.mockReset().mockResolvedValue(mocks.server);
  mocks.prepareSiteDocs.mockReset();
  mocks.server.listen.mockReset();
  mocks.server.printUrls.mockReset();
  mocks.server.bindCLIShortcuts.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const start = (cwd: string) => {
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  return import("../../scripts/vite-dev.mjs");
};

describe("vite-dev.mjs", () => {
  it("starts a dev-site server for site packages after collecting docs metas", async () => {
    await start(ws.site);
    expect(mocks.prepareSiteDocs).toHaveBeenCalledWith(ws.site);
    expect(mocks.createServer).toHaveBeenCalledTimes(1);
    const config = mocks.createServer.mock.calls[0][0];
    expect(config.root).toBe(ws.site);
    expect(config.publicDir).toBe(path.join(ws.site, "public"));
    expect(config.server.port).toBe(3001);
    expect(mocks.server.listen).toHaveBeenCalledTimes(1);
    expect(mocks.server.printUrls).toHaveBeenCalledTimes(1);
    expect(mocks.server.bindCLIShortcuts).toHaveBeenCalledWith({ print: true });
  });

  it("fails when a site package has no index.html", async () => {
    await rm(path.join(ws.site, "index.html"));
    try {
      await expect(start(ws.site)).rejects.toThrow(
        `Site package is missing ${path.join(ws.site, "index.html")}. Expected index.html at the package root.`,
      );
    } finally {
      await writeTree(ws.site, { "index.html": "<!doctype html>\n" });
    }
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("starts the demo playground for packages with support/demos/index.html", async () => {
    await writeTree(ws.lib, { "support/demos/index.html": "<h1>lib demos</h1>\n" });
    await start(ws.lib);
    expect(mocks.prepareSiteDocs).not.toHaveBeenCalled();
    const config = mocks.createServer.mock.calls[0][0];
    expect(config.root).toBe(path.join(ws.lib, "support/demos"));
    expect(config.publicDir).toBeUndefined();
    expect(config.plugins.map((p: { name: string }) => p.name)).toContain("serve-demo-html");
    expect(mocks.server.listen).toHaveBeenCalledTimes(1);
  });

  it("fails when neither entry exists", async () => {
    await expect(start(ws.linked)).rejects.toThrow(
      `No Vite entry found in ${ws.linked}. Site packages need ./index.html; demo playgrounds need support/demos/index.html.`,
    );
    expect(mocks.createServer).not.toHaveBeenCalled();
  });
});
