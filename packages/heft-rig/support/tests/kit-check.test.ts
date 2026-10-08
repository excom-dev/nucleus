import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { checkPublishedKit } from "../../scripts/kit-check.mjs";
import { makeTempDir, removeDir, writeFiles } from "./docs-pipeline-fixtures";

let tmp: string;

beforeAll(() => {
  tmp = makeTempDir("heft-rig-kit-check-");
  writeFiles(tmp, {
    "node_modules/@excom/nucleus-kit/package.json": JSON.stringify({ name: "@excom/nucleus-kit", version: "9.9.9" }),
  });
});

afterAll(() => removeDir(tmp));

describe("checkPublishedKit", () => {
  const sha = (text: string) => `sha256-${createHash("sha256").update(text).digest("base64")}`;
  const DIST = {
    "nucleus-kit.progressive.min.js": "entry",
    "progressive/quark.min.js": "quark",
    "progressive/quark.min.js.map": "map",
    "basic.css": "css",
    "index.min.js": "not loaded by a page",
  };
  const listing = (files: Record<string, string>) => ({
    package: "@excom/nucleus-kit",
    version: "9.9.9",
    prefix: "/dist/",
    files: Object.entries(files).map(([file, text]) => ({ path: `/dist/${file}`, integrity: sha(text) })),
  });
  const reply = (status: number, body?: unknown) => ({ ok: status === 200, status, json: async () => body });
  let root: string;

  beforeAll(() => {
    root = path.join(tmp, "checked");
    writeFiles(tmp, Object.fromEntries(Object.entries(DIST).map(([file, text]) => [`node_modules/@excom/nucleus-kit/dist/${file}`, text])));
    writeFiles(root, { "index.html": "" });
  });

  it("passes when unpkg holds, file for file, the kit built here", async () => {
    const fetch = vi.fn(async () => reply(200, listing({ ...DIST, "progressive/quark.min.js.map": "other map" })));
    expect(await checkPublishedKit({ root, fetch })).toEqual({ version: "9.9.9", files: 3 });
    expect(fetch).toHaveBeenCalledWith("https://unpkg.com/@excom/nucleus-kit@9.9.9/dist/?meta");
  });

  it("names the first file that differs, is missing on unpkg, or is not built here", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ ...DIST, "progressive/quark.min.js": "changed" }, "dist/progressive/quark.min.js differs"],
      [{ "nucleus-kit.progressive.min.js": "entry", "basic.css": "css" }, "dist/progressive/quark.min.js is not on unpkg"],
      [{ ...DIST, "progressive/extra.min.js": "x" }, "dist/progressive/extra.min.js is not built here"],
    ];
    for (const [files, message] of cases)
      await expect(checkPublishedKit({ root, fetch: async () => reply(200, listing(files)) })).rejects.toThrow(
        `The Nucleus Kit changed since 9.9.9 was published: ${message} (https://unpkg.com/@excom/nucleus-kit@9.9.9/dist/?meta). Publish a new version before deploying.`
      );
  });

  it("waits out a version unpkg does not serve yet, saying so once, and fails on any other answer", async () => {
    const log = vi.fn();
    const late = vi
      .fn()
      .mockResolvedValueOnce(reply(404))
      .mockResolvedValueOnce(reply(404))
      .mockResolvedValueOnce(reply(200, listing(DIST)));
    expect(await checkPublishedKit({ root, fetch: late, attempts: 5, delay: 0, log })).toMatchObject({ files: 3 });
    expect(late).toHaveBeenCalledTimes(3);
    expect(log.mock.calls).toEqual([["unpkg does not serve this version yet: asking again for up to 0 s"]]);
    const never = vi.fn(async () => reply(404));
    await expect(checkPublishedKit({ root, fetch: never, attempts: 3, delay: 0, log })).rejects.toThrow(
      "/dist/?meta answered 404 for 0 s: unpkg does not serve this version (yet). Deploy again once it does."
    );
    expect(never).toHaveBeenCalledTimes(3);
    const broken = vi.fn(async () => reply(500));
    await expect(checkPublishedKit({ root, fetch: broken, delay: 0, log })).rejects.toThrow("answered 500");
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("waits eight minutes by default: unpkg lagged the 0.4.0 publish by more than the old 50 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const never = vi.fn(async () => reply(404));
      let error: Error | undefined;
      checkPublishedKit({ root, fetch: never, log: vi.fn() }).catch((cause) => (error = cause));
      // the file reads are real: let them finish between the waits
      while (!error) {
        await vi.advanceTimersByTimeAsync(15_000);
        await new Promise(setImmediate);
      }
      expect(error.message).toContain("answered 404 for 480 s");
      expect(never).toHaveBeenCalledTimes(33);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("kit-check.mjs run as a script", () => {
  const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/kit-check.mjs");
  const sha = (text: string) => `sha256-${createHash("sha256").update(text).digest("base64")}`;
  const originalArgv = process.argv;
  let site: string;

  beforeAll(() => {
    site = makeTempDir("heft-rig-kit-main-");
    writeFiles(site, {
      "node_modules/@excom/nucleus-kit/package.json": JSON.stringify({ name: "@excom/nucleus-kit", version: "9.9.9" }),
      "node_modules/@excom/nucleus-kit/dist/nucleus-kit.progressive.min.js": "entry",
    });
  });
  afterAll(() => removeDir(site));
  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** Imports the script with `argv`, in `site`, unpkg answering `integrity` for the entry file. */
  const importWith = async (argv: string[], integrity = sha("entry")) => {
    vi.resetModules();
    vi.spyOn(process, "cwd").mockReturnValue(site);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ files: [{ path: "/dist/nucleus-kit.progressive.min.js", integrity }] }),
    }));
    vi.stubGlobal("fetch", fetch);
    process.argv = argv;
    await import("../../scripts/kit-check.mjs");
    return { log, error, fetch };
  };

  it("says the kit on unpkg is the kit built here, and leaves the exit code alone", async () => {
    const { log, error } = await importWith([process.execPath, SCRIPT]);
    expect(log).toHaveBeenCalledWith("@excom/nucleus-kit@9.9.9 on unpkg is the kit built here (1 files)");
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the difference to stderr and sets the exit code to 1", async () => {
    const { log, error } = await importWith([process.execPath, SCRIPT], sha("other"));
    expect(error).toHaveBeenCalledWith(expect.stringContaining("dist/nucleus-kit.progressive.min.js differs"));
    expect(log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("checks nothing when imported, with no script given, or with one that does not exist", async () => {
    for (const argv of [[process.execPath, "/elsewhere.mjs"], [process.execPath], [process.execPath, "nope.mjs"]]) {
      const { log, error, fetch } = await importWith(argv);
      expect([log, error, fetch].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    }
    expect(process.exitCode).toBeUndefined();
  });
});
