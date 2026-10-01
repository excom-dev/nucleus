import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, readDemo, readFileRelative } from "../../index";

// <root>/support/tests/view.test.ts next to <root>/support/demos and <root>/view.html
const root = mkdtempSync(join(tmpdir(), "nucleus-test-files-"));
mkdirSync(join(root, "support/tests"), { recursive: true });
mkdirSync(join(root, "support/demos"));
writeFileSync(join(root, "view.html"), "<p>view</p>");
writeFileSync(join(root, "support/demos/simple.html"), "<p>demo</p>");
const testUrl = pathToFileURL(join(root, "support/tests/view.test.ts")).href;

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("readFileRelative / readDemo", () => {
  it("reads a file relative to the calling module", () => {
    expect(readFileRelative(testUrl, "../../view.html")).toBe("<p>view</p>");
  });

  it("reads a demo from the sibling demos folder", () => {
    expect(readDemo(testUrl, "simple")).toBe("<p>demo</p>");
  });

  it("throws for a missing file", () => {
    expect(() => readDemo(testUrl, "missing")).toThrow(/ENOENT/);
  });
});
