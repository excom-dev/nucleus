import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    "nucleus-kit.progressive.min.js",
    "nucleus-kit.progressive.min.js.map",
    "nucleus-kit.progressive.d.ts",
    "nucleus-kit.progressive.d.ts.map",
    "other.js",
    "notes.txt",
  ]) {
    await writeFile(path.join(root, "dist", file), "");
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

type Conditions = Record<string, string>;

const buildMap = async (): Promise<Record<string, Conditions>> => {
  await buildExports(root);
  return JSON.parse(
    await readFile(path.join(root, "dist/exports.generated.json"), "utf8"),
  );
};

describe("buildExports", () => {
  it("writes a sorted exports map for JS and CSS dist files", async () => {
    const map = await buildMap();
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

  it("maps a <name>.progressive.min.js entry to its own declaration file", async () => {
    const map = await buildMap();
    for (const key of [
      "./nucleus-kit.progressive.min",
      "./dist/nucleus-kit.progressive.min",
      "./nucleus-kit.progressive.min.js",
      "./dist/nucleus-kit.progressive.min.js",
    ]) {
      expect(map[key]).toEqual({
        types: "./dist/nucleus-kit.progressive.d.ts",
        import: "./dist/nucleus-kit.progressive.min.js",
        default: "./dist/nucleus-kit.progressive.min.js",
      });
      expect(Object.keys(map[key])[0]).toBe("types");
    }
  });

  it("omits the types condition when no matching declaration exists", async () => {
    const map = await buildMap();
    expect(map["./other"]).toEqual({
      import: "./dist/other.js",
      default: "./dist/other.js",
    });
    expect("types" in map["./other"]).toBe(false);
  });

  it("only emits types conditions that point at files on disk", async () => {
    const map = await buildMap();
    const typed = Object.values(map).filter((c) => "types" in c);
    expect(typed.length).toBeGreaterThan(0);
    for (const { types } of typed) {
      await expect(access(path.join(root, types))).resolves.toBeUndefined();
    }
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
