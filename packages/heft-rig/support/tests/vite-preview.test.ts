import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  server: { printUrls: vi.fn(), bindCLIShortcuts: vi.fn() },
}));
vi.mock("vite", () => ({ preview: mocks.preview }));

beforeEach(() => {
  vi.resetModules();
  mocks.preview.mockReset().mockResolvedValue(mocks.server);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vite-preview.mjs", () => {
  it("previews the package dist with the rig preview config", async () => {
    const root = path.join("/", "tmp", "preview-pkg");
    vi.spyOn(process, "cwd").mockReturnValue(root);
    await import("../../scripts/vite-preview.mjs");
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    const config = mocks.preview.mock.calls[0][0];
    expect(config.root).toBe(root);
    expect(config.configFile).toBe(false);
    expect(config.build).toEqual({ outDir: path.join(root, "dist") });
    expect(config.preview).toEqual({ port: 4173, host: true });
    expect(mocks.server.printUrls).toHaveBeenCalledTimes(1);
    expect(mocks.server.bindCLIShortcuts).toHaveBeenCalledWith({ print: true });
  });
});
