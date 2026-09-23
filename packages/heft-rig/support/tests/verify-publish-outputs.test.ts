import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { verifyPublishOutputs } from "../../scripts/verify-publish-outputs.mjs";
import { makeTempDir, removeDir, writeFiles } from "./docs-pipeline-fixtures";

const EXPORTS_MAP = {
  ".": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  },
  "./dist/index.js": {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  },
  "./styles.css": { default: "./dist/styles.css" },
};

type Pkg = Record<string, unknown>;

/** A built, publishable package: dist files, exports map applied, files: dist. */
function completePackage(name: string, extra: Pkg = {}) {
  return {
    [`packages/${name}/package.json`]: JSON.stringify({
      name: `@excom/${name}`,
      version: "1.2.3",
      files: ["dist"],
      exports: EXPORTS_MAP,
      ...extra,
    }),
    [`packages/${name}/index.ts`]: "export {};",
    [`packages/${name}/dist/exports.generated.json`]: JSON.stringify(EXPORTS_MAP),
    [`packages/${name}/dist/index.js`]: "export {};",
    [`packages/${name}/dist/index.d.ts`]: "export {};",
    [`packages/${name}/dist/styles.css`]: ":root{}",
  };
}

/** A repo with `rush.json` listing every `packages/<name>` in `files`. */
function makeRepo(tmp: string, id: string, files: Record<string, string>): string {
  const repo = path.join(tmp, id);
  const folders = [
    ...new Set(
      Object.keys(files)
        .filter((f) => f.startsWith("packages/"))
        .map((f) => f.split("/").slice(0, 2).join("/")),
    ),
  ];
  writeFiles(repo, {
    "rush.json": JSON.stringify({
      projects: folders.map((projectFolder) => ({
        packageName: `@excom/${projectFolder.split("/")[1]}`,
        projectFolder,
      })),
    }),
    ...files,
  });
  return repo;
}

describe("verifyPublishOutputs", () => {
  let tmp: string;
  let log: MockInstance;
  let error: MockInstance;
  const cwd = process.cwd();

  beforeAll(() => {
    tmp = makeTempDir("heft-rig-verify-publish-");
  });

  afterAll(() => {
    process.chdir(cwd);
    removeDir(tmp);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(cwd);
  });

  const run = async (id: string, files: Record<string, string>) => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    return verifyPublishOutputs(makeRepo(tmp, id, files));
  };

  it("passes a complete package and prints a one-line summary", async () => {
    const problems = await run("ok", {
      ...completePackage("lib"),
      ...completePackage("other"),
    });
    expect(problems).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("OK: 2 publishable package(s)"),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("accepts nested conditions, fallback arrays, null targets and wildcards", async () => {
    const exportsMap = {
      ".": {
        node: { types: "./dist/index.d.ts", default: "./dist/index.js" },
        default: ["./dist/index.js", "./dist/styles.css"],
      },
      "./blocked": null,
      "./chunks/*": "./dist/*.js",
      "./plain": "./dist/index.js",
    };
    const problems = await run("shapes", {
      ...completePackage("lib", { exports: exportsMap }),
    });
    expect(problems).toEqual([]);
  });

  it("reports a package that was never built", async () => {
    const files = completePackage("lib");
    delete files["packages/lib/dist/exports.generated.json"];
    const problems = await run("unbuilt", files);
    expect(problems).toEqual([
      "@excom/lib: missing dist/exports.generated.json — the package was not built",
    ]);
    expect(error).toHaveBeenCalledWith(problems[0]);
  });

  it("skips the built-output check for a package without rig build entries", async () => {
    // A self-built package (the VS Code highlighter) hand-writes `exports`
    // and never gets `dist/exports.generated.json`; its targets still must exist.
    const files = completePackage("tool");
    delete files["packages/tool/index.ts"];
    delete files["packages/tool/dist/exports.generated.json"];
    files["packages/tool/tool.d.ts"] = "export {};";
    files["packages/tool/tool.test.ts"] = "";
    expect(await run("self-built", files)).toEqual([]);

    delete files["packages/tool/dist/index.js"];
    const problems = await run("self-built-dangling", files);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^@excom\/tool: missing export target \.\/dist\/index\.js/);
  });

  it("reports a package.json with no exports map", async () => {
    const files = completePackage("lib");
    files["packages/lib/package.json"] = JSON.stringify({
      name: "@excom/lib",
      files: ["dist"],
    });
    const problems = await run("no-exports", files);
    expect(problems).toEqual([
      '@excom/lib: package.json has no "exports" map — rush apply-exports did not run',
    ]);
  });

  it("reports an exports map with no targets at all", async () => {
    const problems = await run("empty-exports", {
      ...completePackage("lib", { exports: {} }),
    });
    expect(problems).toEqual([
      '@excom/lib: "exports" map has no targets — rush apply-exports did not run',
    ]);
  });

  it("reports a dangling types path once, with the subpath count", async () => {
    const files = completePackage("lib");
    // `build-exports` can point `types` at a `.d.ts` the build never emits.
    delete files["packages/lib/dist/index.d.ts"];
    const problems = await run("dangling-types", files);
    expect(problems).toEqual([
      '@excom/lib: missing export target ./dist/index.d.ts (exports["."].types, 2 subpaths)',
    ]);
  });

  it("reports a dangling runtime target", async () => {
    const problems = await run("dangling-default", {
      ...completePackage("lib", {
        exports: { "./missing": { default: "./dist/missing.js" } },
      }),
    });
    expect(problems).toEqual([
      '@excom/lib: missing export target ./dist/missing.js (exports["./missing"].default)',
    ]);
  });

  it("rejects a target that resolves to a directory or an unfilled wildcard", async () => {
    const files = completePackage("lib", {
      exports: { ".": "./dist", "./chunks/*": "./chunks/*.js" },
    });
    const problems = await run("dir-target", files);
    expect(problems).toEqual([
      "@excom/lib: missing export target ./dist (exports[\".\"])",
      '@excom/lib: missing export target ./chunks/*.js (exports["./chunks/*"])',
    ]);
  });

  it("reports missing and incomplete files entries", async () => {
    const problems = await run("files", {
      ...completePackage("no-files", { files: undefined }),
      ...completePackage("wrong-files", { files: ["support", "index.ts"] }),
      ...completePackage("empty-files", { files: [] }),
      // `dist/**` and `./dist/` still pack the build output.
      ...completePackage("glob-files", { files: ["./dist/", "support"] }),
      ...completePackage("deep-files", { files: ["dist/**/*"] }),
    });
    expect(problems).toEqual([
      '@excom/no-files: "files" is missing from package.json',
      '@excom/wrong-files: "files" does not include "dist" (has: support, index.ts)',
      '@excom/empty-files: "files" is empty',
    ]);
  });

  it("skips private packages entirely", async () => {
    const files = completePackage("tooling", { private: true });
    delete files["packages/tooling/dist/exports.generated.json"];
    delete files["packages/tooling/dist/index.d.ts"];
    const problems = await run("private", { ...files, ...completePackage("lib") });
    expect(problems).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("OK: 1 publishable package(s)"),
    );
  });

  it("collects several problems across packages and counts them", async () => {
    const broken = completePackage("broken", { files: ["support"] });
    delete broken["packages/broken/dist/exports.generated.json"];
    delete broken["packages/broken/dist/index.d.ts"];
    const problems = await run("many", { ...broken, ...completePackage("lib") });
    expect(problems).toEqual([
      "@excom/broken: missing dist/exports.generated.json — the package was not built",
      '@excom/broken: missing export target ./dist/index.d.ts (exports["."].types, 2 subpaths)',
      '@excom/broken: "files" does not include "dist" (has: support)',
    ]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("3 publish output problem(s) in 2 publishable package(s)"),
    );
  });

  it("reports a project folder with no readable package.json", async () => {
    const repo = makeRepo(tmp, "no-pkg", completePackage("lib"));
    writeFiles(repo, {
      "rush.json": JSON.stringify({
        projects: [
          { packageName: "@excom/gone", projectFolder: "packages/gone" },
          { projectFolder: 42 },
          "not-an-object",
        ],
      }),
    });
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await verifyPublishOutputs(repo)).toEqual([
      "@excom/gone: no readable package.json in packages/gone",
    ]);
  });

  it("tolerates a rush.json with no projects", async () => {
    const repo = path.join(tmp, "bare");
    writeFiles(repo, { "rush.json": "{}" });
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await verifyPublishOutputs(repo)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("OK: 0 publishable"));
  });

  it("finds the repo root from cwd when no root is passed", async () => {
    const repo = makeRepo(tmp, "from-cwd", completePackage("lib"));
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.chdir(path.join(repo, "packages", "lib"));
    expect(await verifyPublishOutputs()).toEqual([]);
  });

  it("throws when no rush.json is found above cwd", async () => {
    const orphan = path.join(tmp, "orphan");
    mkdirSync(orphan, { recursive: true });
    process.chdir(orphan);
    await expect(verifyPublishOutputs()).rejects.toThrow(/Could not find rush.json/);
  });
});
