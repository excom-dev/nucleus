import { afterEach, beforeEach, describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import { stage } from "../../scripts/stage.mjs";
import { entries, join, PACKAGE, read, removeDir, tempDir, tree, write } from "./stage/fs.mjs";

// Spelled out here so widening what ships is a deliberate edit of this test too.
const SHIPPED = ["_headers", "backend", "data", "img", "index.html", "manifest.webmanifest", "models", "shell.css", "shell.quark", "sw.js", "views"];

describe("stage", () => {
  let scratch = "";
  let out = "";
  beforeEach(async () => {
    scratch = await tempDir();
    out = join(scratch, "dist");
  });
  afterEach(() => removeDir(scratch));

  it("stages the allowlist and nothing else from the package", async () => {
    await stage({ out });
    expect(await entries(out)).toEqual(SHIPPED);
  });

  it("copies each directory and file whole", async () => {
    await stage({ out, kitVersion: "1.0.0" });
    for (const dir of ["backend", "data", "img", "models", "views"]) expect(await tree(join(out, dir))).toEqual(await tree(join(PACKAGE, dir)));
    for (const file of ["_headers", "manifest.webmanifest", "shell.css", "shell.quark", "sw.js"]) expect(await read(out, file)).toBe(await read(PACKAGE, file));
  });

  it("leaves no stale file behind", async () => {
    await write(join(out, "stale.txt"), "old");
    await stage({ out });
    expect(await entries(out)).not.toContain("stale.txt");
  });

  it("pins both Kit URLs to the workspace version", async () => {
    const { version } = JSON.parse(await read(PACKAGE, "../nucleus-kit/package.json"));
    expect(await stage({ out })).toBe(version);
    const pinned = (await read(out, "index.html")).match(/unpkg\.com\/@excom\/nucleus-kit@[^/]+\//g);
    expect(pinned).toEqual(Array(2).fill(`unpkg.com/@excom/nucleus-kit@${version}/`));
  });

  it("rewrites the Kit URLs and no other line", async () => {
    await stage({ out, kitVersion: "1.0.0-rc.1" });
    const before = (await read(PACKAGE, "index.html")).split("\n");
    const after = (await read(out, "index.html")).split("\n");
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toEqual([
      expect.stringContaining("unpkg.com/@excom/nucleus-kit@1.0.0-rc.1/dist/basic.bundle.min.css"),
      expect.stringContaining("unpkg.com/@excom/nucleus-kit@1.0.0-rc.1/dist/nucleus-kit.progressive.min.js"),
    ]);
  });

  it("ships every local file the page links", async () => {
    await stage({ out, kitVersion: "1.0.0" });
    const links = [...(await read(out, "index.html")).matchAll(/(?:href|src|src-url)="(\/[^"?#]+\.[a-z0-9]+)"/g)].map(([, link]) => link);
    const staged = await tree(out);
    expect(links).toContain("/img/apple-touch-icon.png");
    for (const link of links) expect(staged).toContain(link.slice(1));
  });

  it("refuses a page with no Kit URL to pin", async () => {
    const root = join(scratch, "app");
    await Promise.all(SHIPPED.map((name) => write(join(root, name), "<title>No Kit</title>")));
    await expect(stage({ root, out, kitVersion: "1.0.0" })).rejects.toThrow("no unpkg Kit URL");
  });
});
