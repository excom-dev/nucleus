import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { writeTree } from "./helpers/vite-fixture";

const RIG_ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(RIG_ROOT, "scripts/build-size.mjs");
const originalArgv = process.argv;

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-size-"));
  await writeTree(root, {
    "package.json": JSON.stringify({ name: "@excom/sized", version: "1.2.3" }),
    "dist/index.js": "export const answer = 42;\n".repeat(40),
    "dist/index.min.js": "export const a=42;\n",
    "dist/index.umd.min.js.map": "{}",
    "dist/index.d.ts": "export declare const answer: number;\n",
    "dist/index.css": ".a { color: red }\n",
    "dist/exports.generated.json": "{}",
    "dist/progressive/quark.min.js": "const q = 1;\n",
  });
});

afterAll(async () => {
  process.argv = originalArgv;
  await rm(root, { recursive: true, force: true });
});

describe("build-size", () => {
  it("measures raw / gzip / brotli bytes of every JS and CSS output, recursively", async () => {
    const { measureDist, measure } = await import("../../scripts/build-size.mjs");
    const report = await measureDist(root);
    expect(report.name).toBe("@excom/sized");
    expect(report.version).toBe("1.2.3");
    expect(Object.keys(report.files)).toEqual([
      "index.css",
      "index.js",
      "index.min.js",
      "progressive/quark.min.js",
    ]);
    const source = "export const answer = 42;\n".repeat(40);
    expect(report.files["index.js"]).toEqual({
      raw: source.length,
      gzip: gzipSync(Buffer.from(source), { level: 9 }).length,
      brotli: expect.any(Number),
    });
    expect(report.files["index.js"].gzip).toBeLessThan(report.files["index.js"].raw);
    expect(report.files["index.js"].brotli).toBeLessThan(report.files["index.js"].raw);
    expect(measure(Buffer.from(""))).toEqual({ raw: 0, gzip: expect.any(Number), brotli: expect.any(Number) });
  });

  it("writes dist/size-report.json and prints a table", async () => {
    const { buildSizeReport, formatSizeTable, SIZE_REPORT_FILE } = await import("../../scripts/build-size.mjs");
    const lines: string[] = [];
    const report = await buildSizeReport(root, { log: (line: string) => lines.push(line) });
    const written = JSON.parse(await readFile(path.join(root, "dist", SIZE_REPORT_FILE), "utf8"));
    expect(written).toEqual(report);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("@excom/sized dist sizes");
    expect(lines[0]).toContain("progressive/quark.min.js");
    expect(lines[0]).toMatch(/index\.js\s+1\.0 kB/);
    expect(formatSizeTable({ name: "x", files: {} })).toBe("x: no dist outputs");
  });

  it("reports the current working directory when executed directly", async () => {
    vi.resetModules();
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = [process.execPath, SCRIPT];
    await import("../../scripts/build-size.mjs");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("@excom/sized dist sizes"));
    vi.restoreAllMocks();
  });

  it("does not run when argv[1] is missing or unresolvable", async () => {
    vi.resetModules();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.argv = [process.execPath];
    await import("../../scripts/build-size.mjs");
    vi.resetModules();
    process.argv = [process.execPath, "nope.mjs"];
    await import("../../scripts/build-size.mjs");
    expect(log).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
