import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExports } from "../../scripts/build-exports.mjs";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-build-exports-"));
  await mkdir(path.join(root, "dist"), { recursive: true });
  for (const file of [
    "index.js",
    "index.min.js",
    "index.umd.min.js",
    "index.css",
    "index.min.css",
    "index.js.map",
    "index.min.js.map",
    "index.d.ts",
    "other.js",
    "notes.txt",
  ]) {
    await writeFile(path.join(root, "dist", file), "");
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("buildExports", () => {
  it("writes a sorted exports map for JS and CSS dist files", async () => {
    await buildExports(root);
    const map = JSON.parse(
      await readFile(path.join(root, "dist/exports.generated.json"), "utf8"),
    );
    const keys = Object.keys(map);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));

    // Root export is the plain ESM entry only.
    expect(map["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    });

    // ESM `.js`: bare + dist + explicit `.js` keys.
    for (const key of ["./index", "./dist/index", "./index.js", "./dist/index.js"]) {
      expect(map[key]).toEqual({
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js",
      });
    }
    expect(map["./index.min"]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.min.js",
      default: "./dist/index.min.js",
    });
    expect(map["./other"]).toEqual({
      types: "./dist/other.d.ts",
      import: "./dist/other.js",
      default: "./dist/other.js",
    });

    // UMD: no `import` condition.
    expect(map["./index.umd.min"]).toEqual({
      types: "./dist/index.d.ts",
      default: "./dist/index.umd.min.js",
    });
    expect(map["./index.umd.min.js"]).toBeDefined();

    // CSS keeps the full filename and only has `default`.
    expect(map["./index.css"]).toEqual({ default: "./dist/index.css" });
    expect(map["./dist/index.min.css"]).toEqual({
      default: "./dist/index.min.css",
    });
    expect(map["./index.css.css"]).toBeUndefined();

    // Maps, declarations and unrelated files never get a subpath.
    expect(keys.some((k) => k.includes(".map"))).toBe(false);
    expect(keys.some((k) => k.includes(".d.ts"))).toBe(false);
    expect(keys.some((k) => k.includes("notes"))).toBe(false);
  });

  it("defaults the package root to the current working directory", async () => {
    const cwd = process.cwd();
    process.chdir(root);
    try {
      await rm(path.join(root, "dist/exports.generated.json"), { force: true });
      await buildExports();
    } finally {
      process.chdir(cwd);
    }
    const map = JSON.parse(
      await readFile(path.join(root, "dist/exports.generated.json"), "utf8"),
    );
    expect(map["."]).toBeDefined();
  });
});
