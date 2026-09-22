import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { writeTree } from "./helpers/vite-fixture";

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

// Node built-ins are interop'd through `default`, so mock both shapes.
vi.mock("node:child_process", async (importOriginal) => {
  const mocked = { ...(await importOriginal<object>()), execFile: mocks.execFile };
  return { ...mocked, default: mocked };
});

const RIG_ROOT = path.resolve(__dirname, "../..");
const CONFIG = path.join(RIG_ROOT, "profiles/default/config");
const ESLINT = path.join(RIG_ROOT, "node_modules/.bin/eslint");
const PRETTIER = path.join(RIG_ROOT, "node_modules/.bin/prettier");
/*
 * The workspace-sibling fallback for the quark formatter: forced to be
 * unavailable (see `vi.doMock` below) regardless of whether the sibling
 * package is built.
 */
const SIBLING_FORMATTER = path.resolve(RIG_ROOT, "../quark-formatter/dist/index.js");

const FORMATTER_SRC = `export function format(source) {
  if (source.includes("THROW")) throw new Error("bad quark");
  return source.replace(/ {2,}/g, " ");
}
`;

let root: string;
let plain: string;
let withQuark: string;
let allClean: string;
let noFormatter: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-format-"));
  plain = path.join(root, "plain");
  withQuark = path.join(root, "with-quark");
  allClean = path.join(root, "all-clean");
  noFormatter = path.join(root, "no-formatter");
  await writeTree(allClean, {
    "package.json": JSON.stringify({ name: "all-clean" }),
    "clean.quark": "@use x;\n",
    "node_modules/@excom/quark-formatter/package.json": JSON.stringify({
      name: "@excom/quark-formatter",
      type: "module",
    }),
    "node_modules/@excom/quark-formatter/dist/index.js": FORMATTER_SRC,
  });
  await writeTree(plain, {
    "package.json": JSON.stringify({ name: "plain" }),
    "index.ts": "",
    "node_modules/x/skipped.quark": "@use  x;",
    "dist/skipped.quark": "@use  x;",
    "coverage/skipped.quark": "@use  x;",
    "temp/skipped.quark": "@use  x;",
    ".git/skipped.quark": "@use  x;",
  });
  await writeTree(withQuark, {
    "package.json": JSON.stringify({ name: "with-quark" }),
    "clean.quark": "@use x;\n",
    "src/dirty.quark": "@use   x;\n",
    "src/nested/broken.quark": "THROW\n",
    "node_modules/@excom/quark-formatter/package.json": JSON.stringify({
      name: "@excom/quark-formatter",
      type: "module",
    }),
    "node_modules/@excom/quark-formatter/dist/index.js": FORMATTER_SRC,
  });
  await writeTree(noFormatter, {
    "package.json": JSON.stringify({ name: "no-formatter" }),
    "sheet.quark": "@use  x;\n",
  });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetModules();
  mocks.execFile.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

const run = (cwd: string) => {
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  return import("../../scripts/format.mjs");
};

describe("format.mjs", () => {
  it("runs eslint --fix, then both prettier configs", async () => {
    await run(plain);
    expect(mocks.execFile).toHaveBeenCalledTimes(3);
    expect(mocks.execFile.mock.calls[0]).toEqual([
      ESLINT,
      [
        "--config",
        path.join(CONFIG, "eslint.config.cjs"),
        "--fix",
        "--no-error-on-unmatched-pattern",
        "*.{ts,tsx,js,jsx,mjs,cjs}",
        "src/**/*.{ts,tsx,js,jsx,mjs,cjs}",
      ],
      { stdio: "inherit" },
    ]);
    expect(mocks.execFile.mock.calls[1]).toEqual([
      PRETTIER,
      [
        "--config",
        path.join(CONFIG, ".prettierrc"),
        "--write",
        "--no-error-on-unmatched-pattern",
        "*.{ts,js,json,css,scss}",
        "src/**/*.{ts,js,json,css,scss}",
      ],
      { stdio: "inherit" },
    ]);
    expect(mocks.execFile.mock.calls[2][1]).toEqual([
      "--config",
      path.join(CONFIG, ".html.prettierrc"),
      "--write",
      "--no-error-on-unmatched-pattern",
      "*.{html,md}",
      "src/**/*.{html,md}",
    ]);
    // No .quark files outside skipped directories: nothing else happens.
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("Formatting complete");
    expect(process.exitCode).toBeUndefined();
  });

  it("formats .quark files with the package's own quark-formatter", async () => {
    await run(withQuark);
    expect(await readFile(path.join(withQuark, "clean.quark"), "utf8")).toBe("@use x;\n");
    expect(await readFile(path.join(withQuark, "src/dirty.quark"), "utf8")).toBe("@use x;\n");
    expect(console.log).toHaveBeenCalledWith("quark: formatted src/dirty.quark");
    expect(console.log).not.toHaveBeenCalledWith("quark: formatted clean.quark");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^quark: failed to format:\n  src\/nested\/broken\.quark: bad quark\n  formatter build: .*quark-formatter\/dist\/index\.js \(built .*\); if these errors don't match the current Quark grammar, rebuild @excom\/quark-parser and @excom\/quark-formatter$/,
      ),
    );
    expect(process.exitCode).toBe(1);
    expect(console.log).toHaveBeenCalledWith("Formatting complete");
  });

  it("leaves the exit code alone when every .quark file formats cleanly", async () => {
    await run(allClean);
    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalledWith(expect.stringMatching(/^quark: formatted/));
    expect(process.exitCode).toBeUndefined();
  });

  it("uses .cmd shims on Windows", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      await run(plain);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
    expect(mocks.execFile.mock.calls[0][0]).toBe(`${ESLINT}.cmd`);
    expect(mocks.execFile.mock.calls[1][0]).toBe(`${PRETTIER}.cmd`);
  });

  it("warns and skips .quark files when no formatter is available", async () => {
    vi.doMock(SIBLING_FORMATTER, () => {
      throw new Error("quark-formatter is not built");
    });
    await run(noFormatter);
    vi.doUnmock(SIBLING_FORMATTER);
    expect(console.warn).toHaveBeenCalledWith(
      "quark: found .quark files but @excom/quark-formatter is not built/available; skipping",
    );
    expect(await readFile(path.join(noFormatter, "sheet.quark"), "utf8")).toBe("@use  x;\n");
    expect(process.exitCode).toBeUndefined();
  });
});
