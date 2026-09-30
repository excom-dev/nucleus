import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRigViteConfig } from "../../scripts/vite-config.mjs";
import { writeTree } from "./helpers/vite-fixture";

// Real vite-plugin-dts: a published package ships only `dist`, so every
// relative path in its declarations must resolve inside it.
let root: string;
let dist: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "heft-rig-dts-"));
  dist = path.join(root, "dist");
  await writeTree(root, {
    "package.json": JSON.stringify({ name: "@excom/dts-fixture" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "bundler",
        target: "ES2020",
        declaration: true,
        emitDeclarationOnly: true,
        allowImportingTsExtensions: true,
      },
      include: ["./*.ts", "./src/**/*.ts"],
    }),
    "index.ts": `export { thing } from "./src/thing";\nexport type { Extra } from "./extra";\n`,
    "extra.ts": `export interface Extra { id: number }\n`,
    "src/thing.ts": `import type { Extra } from "../extra";\nimport type { Kind } from "./kind";\nexport const thing = (): { extra?: Extra; kind: Kind } => ({ kind: "a" });\n`,
    "src/kind.ts": `export type Kind = "a" | "b";\n`,
  });
  await build({
    ...(await createRigViteConfig({
      mode: "build-js",
      root,
      packageRoot: root,
      entry: { name: "index", type: "ts", path: path.join(root, "index.ts") },
    })),
    logLevel: "silent",
  });
}, 60_000);

afterAll(() => rm(root, { recursive: true, force: true }));

const relativeSpecifiers = (source: string) =>
  [...source.matchAll(/(?:from\s*|import\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)].map(
    ([, specifier]) => specifier,
  );

describe("library build declarations", () => {
  it("point every relative import at a declaration inside dist", async () => {
    const files = (await readdir(dist, { recursive: true })).filter((f) => f.endsWith(".d.ts"));
    expect(files.sort()).toEqual(["extra.d.ts", "index.d.ts", "src/kind.d.ts", "src/thing.d.ts"]);

    const dangling = (
      await Promise.all(
        files.map(async (file) => {
          const from = path.dirname(path.join(dist, file));
          const source = await readFile(path.join(dist, file), "utf8");
          return relativeSpecifiers(source)
            .map((specifier) => ({ file, specifier, target: path.resolve(from, `${specifier}.d.ts`) }))
            .filter(({ target }) => path.relative(dist, target).startsWith("..") || !existsSync(target))
            .map(({ file, specifier }) => `${file}: ${specifier}`);
        }),
      )
    ).flat();

    expect(dangling).toEqual([]);
    expect(relativeSpecifiers(await readFile(path.join(dist, "index.d.ts"), "utf8"))).toEqual([
      "./src/thing",
      "./extra",
    ]);
  });
});
