import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { formatPackageJson } from "../../scripts/format-package-json.mjs";

const SCRIPT = path.resolve(__dirname, "../../scripts/format-package-json.mjs");
const originalArgv = process.argv;

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-format-pkg-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

let counter = 0;
const run = async (pkg: object) => {
  const dir = path.join(root, `pkg-${counter++}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg));
  await formatPackageJson(dir);
  const text = await readFile(path.join(dir, "package.json"), "utf8");
  return { json: JSON.parse(text), text };
};

const RIG_SCRIPTS = {
  build: "node node_modules/@excom/heft-rig/scripts/vite-build.mjs",
  "build:watch": "node node_modules/@excom/heft-rig/scripts/vite-build-watch.mjs",
  format: "node node_modules/@excom/heft-rig/scripts/format.mjs",
  test: "node node_modules/@excom/heft-rig/scripts/vitest.mjs",
  coverage: "node node_modules/@excom/heft-rig/scripts/coverage.mjs",
};
const DEV_SCRIPTS = {
  dev: "node node_modules/@excom/heft-rig/scripts/vite-dev.mjs",
  preview: "node node_modules/@excom/heft-rig/scripts/vite-preview.mjs",
};

describe("formatPackageJson", () => {
  it("requires name and version", async () => {
    await expect(run({ name: "@excom/x" })).rejects.toThrow(
      "Package name and version are required",
    );
    await expect(run({ version: "1.0.0" })).rejects.toThrow(
      "Package name and version are required",
    );
  });

  it("rejects unknown package types", async () => {
    await expect(
      run({ name: "@excom/x", version: "1.0.0", excom: { packageType: "nope" } }),
    ).rejects.toThrow("Invalid package type: nope");
  });

  it("writes packages without excom metadata back unchanged", async () => {
    const { json, text } = await run({
      version: "1.0.0",
      name: "plain",
      scripts: { x: "y" },
    });
    expect(json).toEqual({ version: "1.0.0", name: "plain", scripts: { x: "y" } });
    expect(text).toBe(JSON.stringify(json, null, 2));
  });

  it("applies kit-element defaults", async () => {
    const { json } = await run({
      name: "@excom/super-input",
      version: "2.0.0",
      excom: { packageType: "kit-element", documented: true },
      keywords: ["super-input", "extra"],
    });
    expect(json.description).toBe("<super-input> custom element");
    expect(json.license).toBe("MIT");
    expect(json.engines).toEqual({ node: ">=24.13.0" });
    expect(json.type).toBe("module");
    expect(json.scripts).toEqual({ ...RIG_SCRIPTS, ...DEV_SCRIPTS });
    expect(json.dependencies).toEqual({ "@excom/neutron": "workspace:^" });
    expect(json.peerDependencies).toEqual({});
    expect(json.devDependencies).toEqual({ "@excom/heft-rig": "workspace:^" });
    expect(json.repository).toEqual({
      url: "excom-dev/nucleus",
      directory: "packages/super-input",
    });
    expect(json.homepage).toBe(
      "https://github.com/excom-dev/nucleus/tree/main/packages/super-input/support/docs/README.md",
    );
    expect(json.bugs).toBe("https://github.com/excom-dev/nucleus/issues");
    expect(json.keywords).toEqual([
      "super-input",
      "neutron",
      "custom-elements",
      "extra",
    ]);
    expect(json.excom).toEqual({ documented: true, packageType: "kit-element" });
    expect(Object.keys(json.excom)).toEqual(["documented", "packageType"]);
    expect("private" in json).toBe(false);
  });

  it("keeps the coverage opt-out in a stable alphabetical position", async () => {
    const { json } = await run({
      name: "@excom/super-input",
      version: "2.0.0",
      excom: { packageType: "kit-element", documented: false, coverageThreshold: false },
    });
    expect(json.excom).toEqual({
      coverageThreshold: false,
      documented: false,
      packageType: "kit-element",
    });
    expect(Object.keys(json.excom)).toEqual(["coverageThreshold", "documented", "packageType"]);
  });

  it("applies element-base defaults with a PascalCase name", async () => {
    const { json } = await run({
      name: "@excom/fetchable-element",
      version: "1.0.0",
      excom: { packageType: "element-base" },
    });
    expect(json.description).toBe("FetchableElement base for Neutron elements");
    expect(json.keywords).toEqual([
      "FetchableElement",
      "fetchable-element",
      "neutron",
      "kit-element-base",
      "custom-elements",
    ]);
    expect(json.scripts).toEqual({ ...RIG_SCRIPTS, ...DEV_SCRIPTS });
  });

  it("applies library defaults", async () => {
    const { json } = await run({
      name: "@excom/quark",
      version: "1.0.0",
      excom: { packageType: "library" },
    });
    expect(json.description).toBe("quark library");
    expect(json.scripts).toEqual(RIG_SCRIPTS);
    expect(json.dependencies).toEqual({});
    expect(json.keywords).toEqual(["quark"]);
  });

  it("applies tool defaults (library shape, no dev/preview) and keeps package scripts", async () => {
    const { json } = await run({
      name: "@excom/nucleus-devtools",
      version: "1.0.0",
      excom: { packageType: "tool" },
      scripts: { build: "wxt build", dev: "wxt" },
    });
    expect(json.description).toBe("nucleus-devtools tool");
    expect(json.scripts).toEqual({ ...RIG_SCRIPTS, build: "wxt build", dev: "wxt" });
    expect(json.keywords).toEqual(["nucleus-devtools", "tool"]);
    expect(json.dependencies).toEqual({});
    expect(json.devDependencies).toEqual({ "@excom/heft-rig": "workspace:^" });
  });

  it("applies site defaults", async () => {
    const { json } = await run({
      name: "@excom/docs-site",
      version: "1.0.0",
      excom: { packageType: "site" },
    });
    expect(json.description).toBe("docs-site site");
    expect(json.scripts).toEqual({ ...RIG_SCRIPTS, ...DEV_SCRIPTS });
    expect(json.keywords).toEqual(["docs-site", "site"]);
  });

  it("applies heft-rig defaults and honours private packages", async () => {
    const { json } = await run({
      name: "@excom/heft-rig",
      private: true,
      version: "1.0.0",
      excom: { packageType: "heft-rig" },
      files: ["scripts/**"],
    });
    expect(Object.keys(json).slice(0, 3)).toEqual(["name", "private", "version"]);
    expect(json.private).toBe(true);
    expect(json.description).toBe("Heft Rig for Monorepo");
    expect(json.scripts).toEqual({
      build: `node -e "console.log('heft-rig: no build output')`,
      "build:watch": `node -e "console.log('heft-rig: no build watch')`,
      format: `node -e "console.log('heft-rig: no format')`,
      test: "node scripts/vitest.mjs",
      coverage: "node scripts/coverage.mjs",
    });
    expect(json.devDependencies).toEqual({});
    expect(json.keywords).toEqual([]);
    expect("repository" in json).toBe(false);
    expect("homepage" in json).toBe(false);
    expect(json.files).toEqual(["scripts/**"]);
  });

  it("falls back to `other` defaults when excom has no packageType", async () => {
    const { json } = await run({
      name: "@excom/misc",
      version: "3.1.0",
      excom: {},
      engines: { pnpm: ">=9", node: ">=20" },
    });
    expect(json.description).toBe("Package misc");
    expect(json.engines).toEqual({ node: ">=20", pnpm: ">=9" });
    expect(Object.keys(json.engines)).toEqual(["node", "pnpm"]);
    expect("type" in json).toBe(false);
    expect(json.scripts).toEqual({
      build: `node -e "console.log('misc: no build output')`,
      "build:watch": `node -e "console.log('misc: no build watch')`,
      format: `node -e "console.log('misc: no format')`,
      test: `node -e "console.log('misc: no tests')`,
      coverage: `node -e "console.log('misc: no coverage')`,
    });
    expect(json.devDependencies).toEqual({ "@excom/heft-rig": "workspace:^" });
    expect(json.keywords).toEqual(["misc"]);
  });

  it("keeps explicit fields, sorts dependency maps and dedupes keywords", async () => {
    const { json } = await run({
      name: "@excom/quark",
      version: "1.0.0",
      displayName: "Quark",
      description: "Custom",
      license: "Apache-2.0",
      type: "commonjs",
      repository: { url: "x" },
      homepage: "https://example.test",
      bugs: "https://bugs.test",
      keywords: ["quark", "b", "a"],
      dependencies: { zeta: "1", alpha: "2" },
      peerDependencies: { b: "1", a: "1" },
      devDependencies: { "@excom/heft-rig": "workspace:*", aaa: "1" },
      excom: { packageType: "library" },
      zz: 1,
      aa: 2,
    });
    expect(json.displayName).toBe("Quark");
    expect(json.description).toBe("Custom");
    expect(json.license).toBe("Apache-2.0");
    expect(json.type).toBe("commonjs");
    expect(json.repository).toEqual({ url: "x" });
    expect(json.homepage).toBe("https://example.test");
    expect(json.bugs).toBe("https://bugs.test");
    expect(json.keywords).toEqual(["quark", "b", "a"]);
    expect(Object.keys(json.dependencies)).toEqual(["alpha", "zeta"]);
    expect(Object.keys(json.peerDependencies)).toEqual(["a", "b"]);
    expect(json.devDependencies).toEqual({
      "@excom/heft-rig": "workspace:*",
      aaa: "1",
    });
    const keys = Object.keys(json);
    expect(keys.indexOf("aa")).toBeLessThan(keys.indexOf("zz"));
    expect(keys.indexOf("excom")).toBeLessThan(keys.indexOf("aa"));
  });

  it("defaults the package root to the current working directory", async () => {
    const dir = path.join(root, "cwd");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@excom/cwd", version: "1.0.0", excom: {} }),
    );
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await formatPackageJson();
    } finally {
      process.chdir(cwd);
    }
    const json = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    expect(json.description).toBe("Package cwd");
  });

  describe("main guard", () => {
    const prepare = async (name: string) => {
      const dir = path.join(root, name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: `@excom/${name}`, version: "1.0.0", excom: {} }),
      );
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      return dir;
    };
    const read = async (dir: string) =>
      JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));

    it("formats the current directory when executed directly", async () => {
      const dir = await prepare("main");
      process.argv = [process.execPath, SCRIPT];
      vi.resetModules();
      await import("../../scripts/format-package-json.mjs");
      expect((await read(dir)).description).toBe("Package main");
    });

    it("stays idle when imported or when argv[1] cannot be resolved", async () => {
      const dir = await prepare("idle");
      for (const argv of [[process.execPath], [process.execPath, "missing.mjs"], [process.execPath, "/elsewhere.mjs"]]) {
        process.argv = argv;
        vi.resetModules();
        await import("../../scripts/format-package-json.mjs");
      }
      expect((await read(dir)).description).toBeUndefined();
    });
  });
});
