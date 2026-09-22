import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getPackageType,
  isSitePackage,
  readPackageJson,
} from "../../scripts/package-type.mjs";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-package-type-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const makePackage = async (name: string, json: unknown) => {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(json));
  return dir;
};

describe("package-type", () => {
  it("returns null when there is no package.json", async () => {
    expect(await readPackageJson(path.join(root, "missing"))).toBeNull();
    expect(await getPackageType(path.join(root, "missing"))).toBeUndefined();
    expect(await isSitePackage(path.join(root, "missing"))).toBe(false);
  });

  it("reads the excom.packageType", async () => {
    const dir = await makePackage("site", {
      name: "@excom/site",
      excom: { packageType: "site" },
    });
    expect(await readPackageJson(dir)).toEqual({
      name: "@excom/site",
      excom: { packageType: "site" },
    });
    expect(await getPackageType(dir)).toBe("site");
    expect(await isSitePackage(dir)).toBe(true);
  });

  it("treats a package without excom metadata as a non-site package", async () => {
    const dir = await makePackage("plain", { name: "@excom/plain" });
    expect(await getPackageType(dir)).toBeUndefined();
    expect(await isSitePackage(dir)).toBe(false);
  });
});
