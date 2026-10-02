import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

  it("waits out a version unpkg does not list yet, and fails on any other answer", async () => {
    const late = vi.fn().mockResolvedValueOnce(reply(404)).mockResolvedValueOnce(reply(200, listing(DIST)));
    expect(await checkPublishedKit({ root, fetch: late, delay: 0 })).toMatchObject({ files: 3 });
    expect(late).toHaveBeenCalledTimes(2);
    const never = vi.fn(async () => reply(404));
    await expect(checkPublishedKit({ root, fetch: never, attempts: 3, delay: 0 })).rejects.toThrow("answered 404");
    expect(never).toHaveBeenCalledTimes(3);
    const broken = vi.fn(async () => reply(500));
    await expect(checkPublishedKit({ root, fetch: broken, delay: 0 })).rejects.toThrow("answered 500");
    expect(broken).toHaveBeenCalledTimes(1);
  });
});
