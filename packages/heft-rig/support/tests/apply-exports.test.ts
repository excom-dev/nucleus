import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyExports } from "../../scripts/apply-exports.mjs";

const SCRIPT = path.resolve(__dirname, "../../scripts/apply-exports.mjs");
const originalArgv = process.argv;

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-apply-exports-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

const makePackage = async (name: string, pkg: object) => {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, "dist"), { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
};

const readPkg = async (dir: string) =>
  JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));

describe("applyExports", () => {
  it("copies dist/exports.generated.json onto package.json exports", async () => {
    const dir = await makePackage("lib", { name: "@excom/lib", exports: {} });
    const map = { ".": { default: "./dist/index.js" } };
    await writeFile(
      path.join(dir, "dist/exports.generated.json"),
      JSON.stringify(map),
    );
    await applyExports(dir);
    expect(await readPkg(dir)).toEqual({ name: "@excom/lib", exports: map });
    // Pretty-printed with two spaces.
    expect(await readFile(path.join(dir, "package.json"), "utf8")).toContain(
      '\n  "exports"',
    );
  });

  it("leaves package.json alone when no exports map was generated", async () => {
    const dir = await makePackage("no-map", { name: "@excom/no-map" });
    await applyExports(dir);
    expect(await readPkg(dir)).toEqual({ name: "@excom/no-map" });
  });

  it("rethrows errors other than ENOENT", async () => {
    const dir = await makePackage("bad-map", { name: "@excom/bad-map" });
    // A directory in place of the file: readFile fails with EISDIR.
    await mkdir(path.join(dir, "dist/exports.generated.json"));
    await expect(applyExports(dir)).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("skips the rig package itself", async () => {
    const dir = path.join(root, "packages/heft-rig");
    await mkdir(dir, { recursive: true });
    // No package.json at all: reading it would throw if not skipped.
    await expect(applyExports(dir)).resolves.toBeUndefined();
    await expect(applyExports(dir.replace(/\//g, "\\"))).resolves.toBeUndefined();
  });

  it("defaults the package root to the current working directory", async () => {
    const dir = await makePackage("cwd", { name: "@excom/cwd" });
    await writeFile(
      path.join(dir, "dist/exports.generated.json"),
      JSON.stringify({ ".": { default: "./dist/index.js" } }),
    );
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await applyExports();
    } finally {
      process.chdir(cwd);
    }
    expect((await readPkg(dir)).exports).toEqual({
      ".": { default: "./dist/index.js" },
    });
  });

  describe("main guard", () => {
    it("applies exports to the current directory when executed directly", async () => {
      const dir = await makePackage("main", { name: "@excom/main" });
      await writeFile(
        path.join(dir, "dist/exports.generated.json"),
        JSON.stringify({ ".": { default: "./dist/main.js" } }),
      );
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      process.argv = [process.execPath, SCRIPT];
      vi.resetModules();
      await import("../../scripts/apply-exports.mjs");
      expect((await readPkg(dir)).exports).toEqual({ ".": { default: "./dist/main.js" } });
    });

    it("stays idle when imported or when argv[1] cannot be resolved", async () => {
      const dir = await makePackage("idle", { name: "@excom/idle" });
      await writeFile(
        path.join(dir, "dist/exports.generated.json"),
        JSON.stringify({ ".": { default: "./dist/idle.js" } }),
      );
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      for (const argv of [[process.execPath], [process.execPath, "missing.mjs"], [process.execPath, "/elsewhere.mjs"]]) {
        process.argv = argv;
        vi.resetModules();
        await import("../../scripts/apply-exports.mjs");
      }
      expect((await readPkg(dir)).exports).toBeUndefined();
    });
  });
});
