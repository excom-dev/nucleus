import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRigViteConfig,
  CSS_MINIFY_TARGET,
  progressiveChunks,
  resolveCoverageReporters,
  resolveCoverageThresholds,
  resolveVitestMaxWorkers,
  UMD_SHARED_GLOBALS,
  umdExternals,
  umdGlobalName,
  writeMinifiedCss,
} from "../../scripts/vite-config.mjs";
import { createWorkspace, pluginByName, writeTree, type Workspace } from "./helpers/vite-fixture";

vi.mock("vite-plugin-dts", () => ({
  default: vi.fn((options: object) => ({ name: "vite:dts", options })),
}));

const RIG_ROOT = path.resolve(__dirname, "../..");
const names = (plugins: unknown[]) => (plugins as { name: string }[]).map((p) => p.name);

let ws: Workspace;

beforeAll(async () => {
  ws = await createWorkspace();
});

afterAll(async () => {
  await ws.cleanup();
});

afterEach(() => {
  delete process.env.DOCS_SITE_BASE;
  vi.unstubAllEnvs();
});

describe("createRigViteConfig", () => {
  it("returns only root/configFile for an unknown mode", async () => {
    const config = await createRigViteConfig({ mode: "nope", root: ws.site });
    expect(config).toEqual({ root: ws.site, configFile: false });
  });

  describe("test", () => {
    describe("worker cap and reporters", () => {
      it("caps workers only in CI or when HEFT_RIG_VITEST_MAX_WORKERS is a positive integer", () => {
        expect(resolveVitestMaxWorkers({})).toBeUndefined();
        expect(resolveVitestMaxWorkers({ CI: "true" })).toBe(2);
        expect(resolveVitestMaxWorkers({ HEFT_RIG_VITEST_MAX_WORKERS: "3" })).toBe(3);
        expect(resolveVitestMaxWorkers({ HEFT_RIG_VITEST_MAX_WORKERS: "3", CI: "true" })).toBe(3);
        expect(resolveVitestMaxWorkers({ HEFT_RIG_VITEST_MAX_WORKERS: "0", CI: "true" })).toBe(2);
        expect(resolveVitestMaxWorkers({ HEFT_RIG_VITEST_MAX_WORKERS: "nope" })).toBeUndefined();
      });

      it("writes the HTML coverage report only outside CI", () => {
        expect(resolveCoverageReporters({})).toEqual(["text", "json", "json-summary", "html"]);
        expect(resolveCoverageReporters({ CI: "true" })).toEqual(["text", "json", "json-summary"]);
      });

      it("drops the thresholds only for excom.coverageThreshold: false", () => {
        const gate = { statements: 90, branches: 90, functions: 90, lines: 90 };
        expect(resolveCoverageThresholds(undefined)).toEqual(gate);
        expect(resolveCoverageThresholds(null)).toEqual(gate);
        expect(resolveCoverageThresholds({ packageType: "kit-element" })).toEqual(gate);
        // Only the literal `false` opts out — a truthy or look-alike value gates.
        expect(resolveCoverageThresholds({ coverageThreshold: true })).toEqual(gate);
        expect(resolveCoverageThresholds({ coverageThreshold: 0 })).toEqual(gate);
        expect(resolveCoverageThresholds({ coverageThreshold: "false" })).toEqual(gate);
        expect(resolveCoverageThresholds({ coverageThreshold: false })).toBeUndefined();
      });

      it("leaves maxWorkers to Vitest locally and sets it in CI", async () => {
        vi.stubEnv("CI", "");
        vi.stubEnv("HEFT_RIG_VITEST_MAX_WORKERS", "");
        const local = await createRigViteConfig({ mode: "test", root: ws.site });
        expect("maxWorkers" in local.test!).toBe(false);
        expect(local.test!.coverage!.reporter).toContain("html");

        vi.stubEnv("CI", "true");
        const ci = await createRigViteConfig({ mode: "test", root: ws.site });
        expect(ci.test!.maxWorkers).toBe(2);
        expect(ci.test!.coverage!.reporter).toEqual(["text", "json", "json-summary"]);

        vi.stubEnv("HEFT_RIG_VITEST_MAX_WORKERS", "5");
        const explicit = await createRigViteConfig({ mode: "test", root: ws.site });
        expect(explicit.test!.maxWorkers).toBe(5);
      });
    });

    it("builds the vitest config for a package inside packages/", async () => {
      const config = await createRigViteConfig({ mode: "test", root: ws.site });
      expect(config.root).toBe(ws.site);
      const test = config.test!;
      expect(test.projects).toBeUndefined();
      expect(test.environment).toBe("happy-dom");
      expect(test.include).toEqual(["**/*.test.ts"]);
      expect(test.setupFiles).toEqual([
        path.resolve(RIG_ROOT, "profiles/default/config/setup.ts"),
        path.join(ws.site, "test/setup.ts"),
      ]);
      const coverage = test.coverage as { exclude: string[]; thresholds: object };
      expect(coverage.exclude).toEqual(
        expect.arrayContaining([
          `${path.join(ws.rushRoot, "packages")}/lib/**`,
          `${path.join(ws.rushRoot, "packages")}/alpha/**`,
          "**/support/tests/**",
          "**/*.config.*",
        ]),
      );
      expect(coverage.exclude).not.toContain(`${path.join(ws.rushRoot, "packages")}/site/**`);
      // Built output never counts, so a local build cannot fail the threshold.
      expect(coverage.exclude).toContain("**/dist/**");
      expect(coverage.thresholds).toEqual({
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      });

      const alias = config.resolve!.alias as unknown as { find: RegExp | string; replacement: string }[];
      expect(config.resolve!.preserveSymlinks).toBe(true);
      // alpha has an index.ts: bare + subpath aliases; beta: subpath only.
      const finds = alias.map((a) => String(a.find));
      expect(finds).toEqual([
        "/^@excom\\/alpha$/",
        "/^@excom\\/alpha\\/(.+)$/",
        "/^@excom\\/beta\\/(.+)$/",
        "@vitest/coverage-v8",
      ]);
      expect(alias[0].replacement).toBe(path.join(ws.rushRoot, "packages/alpha/index.ts"));
      expect(alias[1].replacement).toBe(`${path.join(ws.rushRoot, "packages/alpha")}/$1`);
      expect(alias[3].replacement).toBe(path.resolve(RIG_ROOT, "node_modules/@vitest/coverage-v8"));
      expect((alias[0].find as RegExp).test("@excom/alpha")).toBe(true);
      expect((alias[0].find as RegExp).test("@excom/alpha/src")).toBe(false);
      expect((alias[1].find as RegExp).test("@excom/alpha/src/x")).toBe(true);
    });

    it("prefers the linked heft-rig setup file and skips a missing package setup", async () => {
      const config = await createRigViteConfig({ mode: "test", root: ws.linked });
      expect(config.test!.setupFiles).toEqual([
        path.join(ws.linked, "node_modules/@excom/heft-rig/profiles/default/config/setup.ts"),
      ]);
    });

    it("tolerates a rush.json without projects", async () => {
      const bare = path.join(ws.root, "bare-rush/packages/pkg");
      await writeTree(bare, { "package.json": "{}" });
      await writeTree(path.join(ws.root, "bare-rush"), { "rush.json": "{}" });
      const config = await createRigViteConfig({ mode: "test", root: bare });
      expect((config.resolve!.alias as unknown as { find: unknown }[]).map((a) => a.find)).toEqual([
        "@vitest/coverage-v8",
      ]);
    });

    it("omits the thresholds for an opted-out package and keeps them for its neighbour", async () => {
      const exempt = path.join(ws.root, "opt-out/packages/exempt");
      const gated = path.join(ws.root, "opt-out/packages/gated");
      await writeTree(exempt, {
        "package.json": JSON.stringify({
          name: "@excom/exempt",
          excom: { coverageThreshold: false, packageType: "kit-element" },
        }),
      });
      await writeTree(gated, {
        "package.json": JSON.stringify({
          name: "@excom/gated",
          excom: { packageType: "kit-element" },
        }),
      });
      const exemptCoverage = (await createRigViteConfig({ mode: "test", root: exempt })).test!
        .coverage as { thresholds?: object };
      const gatedCoverage = (await createRigViteConfig({ mode: "test", root: gated })).test!
        .coverage as { thresholds?: object };
      expect(exemptCoverage.thresholds).toBeUndefined();
      expect(gatedCoverage.thresholds).toEqual({
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      });
    });

    it("has no workspace aliases and a projects glob outside a rush workspace", async () => {
      const config = await createRigViteConfig({ mode: "test", root: ws.orphan });
      const alias = config.resolve!.alias as unknown as { find: unknown }[];
      expect(alias.map((a) => a.find)).toEqual(["@vitest/coverage-v8"]);
      if (!ws.orphan.includes("packages")) {
        expect(config.test!.projects).toEqual(["packages/*"]);
      }
      // The sibling directory (not the file) is excluded from coverage.
      expect(config.test!.coverage!.exclude).toContain(`${path.dirname(ws.orphan)}/other/**`);
      expect(config.test!.coverage!.exclude!.some((g: string) => g.includes("sibling.txt"))).toBe(false);
    });
  });

  describe("build-js", () => {
    const entry = (root: string, name = "index") => ({
      name,
      type: "ts",
      path: path.join(root, `${name}.ts`),
    });

    it("externalises dependencies and peerDependencies, emits declarations by default", async () => {
      const config = await createRigViteConfig({
        mode: "build-js",
        root: ws.site,
        entry: entry(ws.site),
      });
      const rolldown = config.build!.rolldownOptions!;
      expect(rolldown.external).toEqual(["dep-a", "peer-b"]);
      expect(rolldown.preserveEntrySignatures).toBe("exports-only");
      expect(config.build!.lib).toEqual({ entry: path.join(ws.site, "index.ts") });
      expect(config.build!.outDir).toBe("./dist");
      expect(config.build!.emptyOutDir).toBe(false);
      // Plain + minified ESM come out of one bundle: minify is per output.
      expect(config.build!.minify).toBe(false);
      expect(config.build!.sourcemap).toBe(true);
      expect(rolldown.output).toEqual([
        {
          format: "es",
          exports: "named",
          entryFileNames: "index.js",
          chunkFileNames: "[name].js",
          sourcemap: false,
        },
        {
          format: "es",
          exports: "named",
          entryFileNames: "index.min.js",
          chunkFileNames: "[name].min.js",
          minify: true,
          comments: { annotation: false, jsdoc: false, legal: true },
        },
      ]);
      const [dtsPlugin] = config.plugins as { name: string; options: Record<string, unknown> }[];
      expect(dtsPlugin.name).toBe("vite:dts");
      expect(dtsPlugin.options).toMatchObject({
        root: ws.site,
        entryRoot: ws.site,
        tsconfigPath: path.join(ws.site, "tsconfig.json"),
      });
      const beforeWriteFile = dtsPlugin.options.beforeWriteFile as (
        f: string,
        c: string,
      ) => null | { filePath: string; content: string };
      expect(beforeWriteFile("dist/index.js", "x")).toBeNull();
      expect(beforeWriteFile("dist/index.d.ts", "export const a: number;")).toBeNull();
      expect(
        beforeWriteFile(
          "dist/index.d.ts",
          `import { A } from "./src/a";\nexport * from './src/b';\nexport { C } from "./src/c";\nimport "./src/side";\n`,
        ),
      ).toEqual({
        filePath: "dist/index.d.ts",
        content: `import { A } from "../src/a";\nexport * from '../src/b';\nexport { C } from "../src/c";\nimport "./src/side";\n`,
      });
    });

    it("has no externals when the package has no package.json or deps", async () => {
      const config = await createRigViteConfig({
        mode: "build-js",
        root: ws.root,
        entry: entry(ws.root),
      });
      expect(config.build!.rolldownOptions!.external).toEqual([]);
      const lib = await createRigViteConfig({
        mode: "build-js",
        root: ws.lib,
        packageRoot: ws.lib,
        entry: entry(ws.lib),
      });
      expect(lib.build!.rolldownOptions!.external).toEqual([]);
    });

    it("skips declarations for non-index entries", async () => {
      const config = await createRigViteConfig({
        mode: "build-js",
        root: ws.lib,
        entry: entry(ws.lib, "other"),
      });
      expect(config.plugins).toEqual([]);
    });

    it("honours tsconfig declaration settings and extends chains", async () => {
      const tsconfig = path.join(ws.lib, "tsconfig.json");
      const hasDts = async () =>
        names(
          (await createRigViteConfig({ mode: "build-js", root: ws.lib, entry: entry(ws.lib) }))
            .plugins as unknown[],
        ).includes("vite:dts");

      await writeFile(tsconfig, JSON.stringify({ compilerOptions: { declaration: false } }));
      expect(await hasDts()).toBe(false);

      await writeFile(tsconfig, JSON.stringify({ compilerOptions: { declaration: true } }));
      expect(await hasDts()).toBe(true);

      // No declaration + no extends → default on.
      await writeFile(tsconfig, JSON.stringify({ compilerOptions: {} }));
      expect(await hasDts()).toBe(true);

      // extends resolves; base disables declarations.
      await writeFile(
        path.join(ws.lib, "tsconfig.base.json"),
        JSON.stringify({ compilerOptions: { declaration: false } }),
      );
      await writeFile(tsconfig, JSON.stringify({ extends: "./tsconfig.base.json" }));
      expect(await hasDts()).toBe(false);

      // extends resolves; base says nothing → on.
      await writeFile(path.join(ws.lib, "tsconfig.base.json"), JSON.stringify({}));
      expect(await hasDts()).toBe(true);

      // extends cannot be resolved → default on.
      await writeFile(tsconfig, JSON.stringify({ extends: "@nope/missing/tsconfig.json" }));
      expect(await hasDts()).toBe(true);

      await rm(tsconfig);
      await rm(path.join(ws.lib, "tsconfig.base.json"));
    });
  });

  describe("other lib build modes", () => {
    const entry = { name: "index", type: "ts", path: "/pkg/index.ts" };
    const cssEntry = { name: "index", type: "css", path: "/pkg/index.css" };

    it("removed the separate minified / bundle-css modes", async () => {
      for (const mode of ["build-js-min", "build-css-min", "build-css-bundle"]) {
        expect(await createRigViteConfig({ mode, root: ws.lib, entry })).toEqual({
          root: ws.lib,
          configFile: false,
        });
      }
    });

    it("build-js-bundle emits a UMD that reads neutron / kit-utils from the NucleusStack global", async () => {
      const config = await createRigViteConfig({ mode: "build-js-bundle", root: ws.lib, entry });
      expect(config.build!.lib).toEqual({ entry: "/pkg/index.ts" });
      expect(config.build!.minify).toBe(false);
      expect(config.build!.sourcemap).toBe(true);
      expect(config.build!.rolldownOptions!.external).toEqual(["@excom/neutron", "@excom/kit-utils"]);
      // An array, not an object: a lone object is expanded to Vite's default lib formats.
      expect(config.build!.rolldownOptions!.output).toEqual([
        {
          format: "umd",
          name: "NucleusStack.lib",
          entryFileNames: "index.umd.min.js",
          codeSplitting: false,
          extend: true,
          globals: UMD_SHARED_GLOBALS,
          minify: true,
          comments: { annotation: false, jsdoc: false, legal: true },
        },
      ]);
    });

    it("names UMD globals per package and keeps the kit self-contained", () => {
      expect(umdGlobalName("@excom/content-drawer", "index")).toBe("NucleusStack.contentDrawer");
      expect(umdGlobalName("@excom/neutron", "index")).toBe("NucleusStack.neutron");
      expect(umdGlobalName("@excom/kit-utils", "index")).toBe("NucleusStack.kitUtils");
      expect(umdGlobalName("@excom/nucleus-kit", "index")).toBe("index");
      expect(umdGlobalName(undefined, "index")).toBe("index");
      expect(umdExternals("@excom/content-drawer")).toEqual(["@excom/neutron", "@excom/kit-utils"]);
      expect(umdExternals("@excom/neutron")).toEqual(["@excom/kit-utils"]);
      expect(umdExternals("@excom/kit-utils")).toEqual(["@excom/neutron"]);
      expect(umdExternals("@excom/nucleus-kit")).toEqual([]);
      expect(umdExternals(undefined)).toEqual([]);
    });

    it("build-js-progressive emits one ESM entry plus a chunk per workspace package", async () => {
      const progressive = { name: "kit.progressive", type: "ts", path: "/pkg/kit.progressive.ts" };
      const config = await createRigViteConfig({ mode: "build-js-progressive", root: ws.lib, entry: progressive });
      expect(config.build!.minify).toBe(false);
      expect(config.build!.sourcemap).toBe(true);
      expect(config.build!.lib).toEqual({ entry: "/pkg/kit.progressive.ts" });
      expect(config.build!.rolldownOptions!.external).toEqual([]);
      expect(config.build!.rolldownOptions!.preserveEntrySignatures).toBe("allow-extension");
      const [output] = config.build!.rolldownOptions!.output as {
        entryFileNames: string;
        chunkFileNames: string;
        minify: boolean;
        codeSplitting: {
          groups: { name: (id: string) => string | undefined; includeDependenciesRecursively: boolean }[];
        };
      }[];
      expect(output.entryFileNames).toBe("kit.progressive.min.js");
      expect(output.chunkFileNames).toBe("progressive/[name].min.js");
      expect(output.minify).toBe(true);
      const [group] = output.codeSplitting.groups;
      expect(output.codeSplitting.groups).toHaveLength(1);
      expect(group.includeDependenciesRecursively).toBe(false);
      expect(group.name("/ws/packages/quark/src/quark.ts")).toBe("quark");
      expect(group.name(path.join(ws.lib, "index.ts"))).toBeUndefined();
    });

    it("progressiveChunks names workspace packages and folds node_modules into their importer", () => {
      const chunks = progressiveChunks("nucleus-kit");
      expect(chunks("/repo/packages/neutron/src/a.ts")).toBe("neutron");
      expect(chunks("C:\\repo\\packages\\kit-utils\\dom.ts")).toBe("kit-utils");
      expect(chunks("/repo/packages/nucleus-kit/nucleus-kit.progressive.ts")).toBeUndefined();
      // Without a chunking context there is nothing to walk.
      expect(chunks("/repo/node_modules/.pnpm/input-format@1/index.js")).toBeUndefined();

      const graph: Record<string, string[]> = {
        "/repo/node_modules/.pnpm/input-format@1/index.js": ["/repo/node_modules/.pnpm/input-format@1/lib.js"],
        "/repo/node_modules/.pnpm/input-format@1/lib.js": [
          "/repo/node_modules/.pnpm/input-format@1/index.js", // cycle
          "/repo/packages/super-input/src/mask.ts",
        ],
        "/repo/node_modules/.pnpm/orphan@1/index.js": [],
        "/repo/node_modules/.pnpm/own@1/index.js": ["/repo/packages/nucleus-kit/kit.ts"],
        "\0rolldown/runtime.js": ["/repo/packages/neutron/src/a.ts"],
      };
      const ctx = {
        getModuleInfo: (id: string) => (id in graph ? { importers: graph[id] } : null),
      };
      expect(chunks("/repo/node_modules/.pnpm/input-format@1/index.js", ctx)).toBe("super-input");
      expect(chunks("/repo/node_modules/.pnpm/orphan@1/index.js", ctx)).toBeUndefined();
      expect(chunks("/repo/node_modules/.pnpm/unknown@1/index.js", ctx)).toBeUndefined();
      // Only imported by the kit itself → stays with the entry.
      expect(chunks("/repo/node_modules/.pnpm/own@1/index.js", ctx)).toBeUndefined();
      // Virtual / non-node_modules ids are not walked.
      expect(chunks("\0rolldown/runtime.js", ctx)).toBeUndefined();
    });

    it("build-css emits one plain stylesheet named after the entry", async () => {
      const plain = await createRigViteConfig({ mode: "build-css", root: ws.lib, entry: cssEntry });
      expect(plain.css).toBeDefined();
      expect(plain.build!.minify).toBe(false);
      expect(plain.build!.sourcemap).toBe(false);
      expect(plain.build!.rolldownOptions).toEqual({
        checks: { pluginTimings: false },
        input: "/pkg/index.css",
        output: { assetFileNames: "index.css" },
      });
    });

    it("writeMinifiedCss derives .min.css and .bundle.min.css from the plain stylesheet", async () => {
      const dir = path.join(ws.lib, "dist-css");
      await writeTree(dir, {
        "basic.css": `/* c */\n.a {\n  color: red;\n}\n.a { @media (min-width: 10px) { color: blue; } }\n.b::after { content: "▲"; }\n`,
      });
      await writeMinifiedCss(dir, "basic");
      const min = await readFile(path.join(dir, "basic.min.css"), "utf8");
      expect(min).toBe(await readFile(path.join(dir, "basic.bundle.min.css"), "utf8"));
      expect(min).not.toContain("/* c */");
      expect(min).toContain(".a{color:red}");
      // Nested @media is lowered for the Vite 8 baseline target, unicode is kept.
      expect(min).toContain("@media(min-width:10px){.a{color:#00f}}");
      expect(min).toContain(`content:"▲"`);
      expect(CSS_MINIFY_TARGET).toEqual(["chrome111", "edge111", "firefox114", "safari16.4"]);
    });
  });

  describe("build-site", () => {
    it("adds sandbox.html and the quark modules as stable inputs", async () => {
      const config = await createRigViteConfig({ mode: "build-site", root: ws.site });
      expect(config.base).toBe("/");
      expect(config.publicDir).toBe(path.join(ws.site, "public"));
      expect(names(config.plugins as unknown[])).toEqual(["sandbox-html-rewrite", "site-service-worker"]);
      const build = config.build!;
      expect(build.outDir).toBe(path.join(ws.site, "dist"));
      expect(build.emptyOutDir).toBe(true);
      expect(build.chunkSizeWarningLimit).toBe(2000);
      expect(build.rolldownOptions!.preserveEntrySignatures).toBe("exports-only");
      expect(build.rolldownOptions!.input).toEqual({
        main: path.join(ws.site, "index.html"),
        sandbox: path.join(ws.site, "sandbox.html"),
        shell: path.join(ws.site, "shell.ts"),
        "demo-utils": path.join(ws.site, "public/demo-utils.ts"),
      });
      const output = build.rolldownOptions!.output as {
        entryFileNames: (c: { name: string }) => string;
        chunkFileNames: string;
        assetFileNames: string;
      };
      expect(output.entryFileNames({ name: "shell" })).toBe("[name].js");
      expect(output.entryFileNames({ name: "demo-utils" })).toBe("[name].js");
      expect(output.entryFileNames({ name: "main" })).toBe("assets/[name]-[hash].js");
      expect(output.chunkFileNames).toBe("assets/[name]-[hash].js");
      expect(output.assetFileNames).toBe("assets/[name]-[hash][extname]");
      // Site builds bundle their dependencies: no externals were read.
      expect(build.rolldownOptions!.external).toBeUndefined();
    });

    it("omits sandbox.html when the site has none and honours DOCS_SITE_BASE", async () => {
      process.env.DOCS_SITE_BASE = "/docs/";
      const config = await createRigViteConfig({ mode: "build-site", root: ws.lib, packageRoot: ws.lib });
      expect(config.base).toBe("/docs/");
      expect(config.build!.rolldownOptions!.input).toEqual({
        main: path.join(ws.lib, "index.html"),
        shell: path.join(ws.lib, "shell.ts"),
        "demo-utils": path.join(ws.lib, "public/demo-utils.ts"),
      });
    });
  });

  describe("dev", () => {
    it("roots the playground at support/demos and rewrites `/` to the entry", async () => {
      const config = await createRigViteConfig({ mode: "dev", root: ws.site });
      expect(config.server).toMatchObject({ port: 3001, host: true, watch: { usePolling: true } });
      expect(names(config.plugins as unknown[])).toEqual([
        "dev-server-compress",
        "quark-module-extensionless",
        "sandbox-html-rewrite",
        "site-service-worker",
        "serve-workspace-packages",
        "serve-demo-html",
        "strip-vite-client-from-subtemplates",
      ]);
      const serveDemo = pluginByName(config.plugins as unknown[], "serve-demo-html") as {
        configureServer: (s: { middlewares: { use: (fn: Function) => void } }) => void;
      };
      let mw: Function = () => {};
      serveDemo.configureServer({ middlewares: { use: (fn) => (mw = fn) } });
      const next = vi.fn();
      const req = { url: "/" };
      mw(req, {}, next);
      expect(req.url).toBe("/index.html");
      const query = { url: "/?a=1" };
      mw(query, {}, next);
      expect(query.url).toBe("/index.html?a=1");
      const other = { url: "/other.html" };
      mw(other, {}, next);
      expect(other.url).toBe("/other.html");
      const none = { url: undefined };
      mw(none, {}, next);
      expect(none.url).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(4);
    });

    it("accepts a string or object entry and strips the vite client from sub-templates", async () => {
      const entryPath = path.join(ws.site, "support/demos/other.html");
      const fromString = await createRigViteConfig({ mode: "dev", root: ws.site, entry: entryPath });
      const fromObject = await createRigViteConfig({
        mode: "dev",
        root: ws.site,
        entry: { name: "other", type: "html", path: entryPath },
      });
      for (const config of [fromString, fromObject]) {
        const strip = pluginByName(config.plugins as unknown[], "strip-vite-client-from-subtemplates") as {
          transformIndexHtml: { order: string; handler: (html: string, ctx: { path?: string }) => string };
        };
        expect(strip.transformIndexHtml.order).toBe("post");
        const html = `<script type="module" src="/@vite/client"></script>\n<p>x</p>`;
        expect(strip.transformIndexHtml.handler(html, { path: "/other.html?x" })).toBe(html);
        expect(strip.transformIndexHtml.handler(html, { path: "/" })).toBe(html);
        expect(strip.transformIndexHtml.handler(html, { path: "/index.html" })).toBe("<p>x</p>");
        expect(strip.transformIndexHtml.handler("<p>x</p>", {})).toBe("<p>x</p>");
      }
    });

    it("skips the service-worker and workspace plugins without a package root or rush root", async () => {
      const config = await createRigViteConfig({ mode: "dev", root: ws.orphan });
      expect(names(config.plugins as unknown[])).toEqual([
        "dev-server-compress",
        "quark-module-extensionless",
        "sandbox-html-rewrite",
        "site-service-worker",
        "serve-demo-html",
        "strip-vite-client-from-subtemplates",
      ]);
    });
  });

  describe("dev-site", () => {
    it("serves the package root with public/ and the site plugins", async () => {
      process.env.DOCS_SITE_BASE = "/base/";
      const config = await createRigViteConfig({ mode: "dev-site", root: ws.site, packageRoot: ws.site });
      expect(config.base).toBe("/base/");
      expect(config.publicDir).toBe(path.join(ws.site, "public"));
      expect(config.css).toBeDefined();
      expect(config.server).toMatchObject({ port: 3001, host: true });
      expect(names(config.plugins as unknown[])).toEqual([
        "dev-server-compress",
        "quark-module-extensionless",
        "sandbox-html-rewrite",
        "site-service-worker",
        "serve-workspace-packages",
      ]);
    });

    it("defaults the base to /", async () => {
      const config = await createRigViteConfig({ mode: "dev-site", root: ws.orphan });
      expect(config.base).toBe("/");
      expect(names(config.plugins as unknown[])).not.toContain("serve-workspace-packages");
    });
  });

  describe("preview", () => {
    it("serves dist with compression and the module rewrite", async () => {
      const config = await createRigViteConfig({ mode: "preview", root: ws.site });
      expect(config.build).toEqual({ outDir: path.join(ws.site, "dist") });
      expect(config.preview).toEqual({ port: 4173, host: true });
      expect(names(config.plugins as unknown[])).toEqual([
        "dev-server-compress",
        "quark-module-extensionless",
      ]);
    });
  });
});
