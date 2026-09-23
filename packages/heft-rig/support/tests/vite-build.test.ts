import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspace, writeTree, type Workspace } from "./helpers/vite-fixture";

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  prepareSiteDocs: vi.fn(),
}));

vi.mock("vite", () => ({ build: mocks.build }));
vi.mock("../../scripts/collect-docs-metas.mjs", () => ({
  prepareSiteDocs: mocks.prepareSiteDocs,
}));
vi.mock("vite-plugin-dts", () => ({ default: vi.fn(() => ({ name: "vite:dts" })) }));

const RIG_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(RIG_ROOT, "scripts/vite-build.mjs");
const exists = (p: string) => access(p).then(() => true, () => false);
const originalArgv = process.argv;

let ws: Workspace;

beforeAll(async () => {
  ws = await createWorkspace();
});

afterAll(async () => {
  await ws.cleanup();
});

beforeEach(() => {
  vi.resetModules();
  mocks.build.mockReset();
  mocks.prepareSiteDocs.mockReset();
  // Pretend the build produced its outputs so buildExports has a dist to scan
  // and writeMinifiedCss has a stylesheet to read.
  mocks.build.mockImplementation(async (config: ViteConfig) => {
    const dist = path.join(config.root, "dist");
    await mkdir(dist, { recursive: true });
    for (const name of outputNames(config.build)) {
      await writeFile(path.join(dist, name), name.endsWith(".css") ? ".a { color: red; }" : "");
    }
    // Like vite-plugin-dts on the ESM pair build: `<entry>.d.ts` next to the JS.
    const entry = config.build.lib?.entry;
    if (entry && config.plugins?.some((p) => p?.name === "vite:dts")) {
      await writeFile(path.join(dist, `${path.basename(entry, ".ts")}.d.ts`), "");
    }
  });
});

type ViteConfig = {
  root: string;
  plugins?: ({ name?: string } | null | undefined)[];
  build: BuildConfig;
};

type BuildConfig = {
  lib?: { entry?: string };
  rolldownOptions: {
    input?: unknown;
    output: { entryFileNames?: string; assetFileNames?: string } | { entryFileNames: string }[];
  };
};

/** Files a lib build would write: every output's entry, or the CSS asset (single string input). */
const outputNames = (build: BuildConfig): string[] => {
  const { input, output } = build.rolldownOptions;
  if (Array.isArray(output)) return output.map((o) => o.entryFileNames);
  return typeof input === "string" && output.assetFileNames ? [output.assetFileNames] : [];
};
const libModes = () => mocks.build.mock.calls.flatMap(([c]) => outputNames(c.build));

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

const load = async () => {
  process.argv = [process.execPath, "/elsewhere.mjs"];
  return import("../../scripts/vite-build.mjs");
};

describe("runFullBuild", () => {
  it("builds site packages once after collecting docs metas", async () => {
    const { runFullBuild } = await load();
    await writeTree(ws.site, { "dist/stale.txt": "old" });
    await runFullBuild(ws.site);
    expect(mocks.prepareSiteDocs).toHaveBeenCalledWith(ws.site);
    expect(mocks.build).toHaveBeenCalledTimes(1);
    const config = mocks.build.mock.calls[0][0];
    expect(config.root).toBe(ws.site);
    expect(config.build.rolldownOptions.input.main).toBe(path.join(ws.site, "index.html"));
    // dist was wiped before the build.
    expect(await exists(path.join(ws.site, "dist/stale.txt"))).toBe(false);
    expect(await exists(path.join(ws.site, "dist/exports.generated.json"))).toBe(false);
  });

  it("runs every lib build mode per root entry and writes exports", async () => {
    const { runFullBuild } = await load();
    await writeTree(ws.lib, {
      "index.css": ".a {}",
      "index.d.ts": "",
      "index.test.ts": "",
      "index.spec.ts": "",
      "index.test.css": "",
      "index.spec.css": "",
      "README.md": "",
    });
    await mkdir(path.join(ws.lib, "src"), { recursive: true });
    await runFullBuild(ws.lib);
    expect(mocks.prepareSiteDocs).not.toHaveBeenCalled();
    // Two builds per TS entry (ESM pair, UMD), one per CSS entry.
    expect(mocks.build).toHaveBeenCalledTimes(5);
    expect(libModes().sort()).toEqual(
      ["index.js", "index.min.js", "index.umd.min.js", "other.js", "other.min.js", "other.umd.min.js", "index.css"].sort(),
    );
    // The minified stylesheets are derived from the plain one, not built.
    expect(await readFile(path.join(ws.lib, "dist/index.min.css"), "utf8")).toBe(".a{color:red}\n");
    expect(await readFile(path.join(ws.lib, "dist/index.bundle.min.css"), "utf8")).toBe(".a{color:red}\n");
    const map = JSON.parse(await readFile(path.join(ws.lib, "dist/exports.generated.json"), "utf8"));
    expect(map["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    });
    // Size report covers every output that was written.
    const report = JSON.parse(await readFile(path.join(ws.lib, "dist/size-report.json"), "utf8"));
    expect(report.name).toBe("@excom/lib");
    expect(Object.keys(report.files).sort()).toEqual(
      [
        "index.js",
        "index.min.js",
        "index.umd.min.js",
        "other.js",
        "other.min.js",
        "other.umd.min.js",
        "index.css",
        "index.min.css",
        "index.bundle.min.css",
      ].sort(),
    );
    expect(report.files["index.js"]).toEqual({ raw: 0, gzip: expect.any(Number), brotli: expect.any(Number) });
    await rm(path.join(ws.lib, "index.css"));
  });

  it("runs only the progressive mode for a <name>.progressive.ts entry", async () => {
    const { runFullBuild } = await load();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await writeTree(ws.lib, { "kit.progressive.ts": "export const kit = 1;\n" });
    await runFullBuild(ws.lib);
    const modes = libModes();
    expect(modes.filter((m) => m.startsWith("kit.progressive"))).toEqual(["kit.progressive.min.js"]);
    const progressive = mocks.build.mock.calls.find(([c]) => outputNames(c.build).includes("kit.progressive.min.js"))![0];
    expect(progressive.build.rolldownOptions.output[0].chunkFileNames).toBe("progressive/[name].min.js");
    const map = JSON.parse(await readFile(path.join(ws.lib, "dist/exports.generated.json"), "utf8"));
    // The progressive mode runs no dts plugin, so no `kit.progressive.d.ts` → no `types`.
    expect(map["./kit.progressive.min"]).toEqual({
      import: "./dist/kit.progressive.min.js",
      default: "./dist/kit.progressive.min.js",
    });
    await rm(path.join(ws.lib, "kit.progressive.ts"));
  });

  it("skips packages with no root entry files", async () => {
    const { runFullBuild } = await load();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runFullBuild(ws.linked);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(`No build entry files found in ${ws.linked}; skipping.`);
    expect(await exists(path.join(ws.linked, "dist"))).toBe(false);
  });

  it("builds the current working directory when executed directly", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(ws.linked);
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = [process.execPath, SCRIPT];
    await import("../../scripts/vite-build.mjs");
    expect(mocks.build).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(`No build entry files found in ${ws.linked}; skipping.`);
  });

  it("does not run when argv[1] is missing or unresolvable", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = [process.execPath];
    await import("../../scripts/vite-build.mjs");
    vi.resetModules();
    process.argv = [process.execPath, "nope.mjs"];
    await import("../../scripts/vite-build.mjs");
    expect(console.log).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });
});
