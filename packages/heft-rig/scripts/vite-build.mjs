// `node vite-build.mjs [--kit=bundled|unpkg]` (`pnpm run build`): the
// package's build. `--kit=unpkg` is the deploy build of a site or app: the
// Nucleus Kit loads from unpkg at the installed version instead of being
// bundled (`pnpm run build --kit=unpkg`). Libraries ignore it.
import { readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite";
import { createRigViteConfig, NODE_ONLY_ENTRIES, writeMinifiedCss } from "./vite-config.mjs";
import { buildSizeReport } from "./build-size.mjs";
import { buildExports } from "./build-exports.mjs";
import { isSitePackage, readPackageJson, usesSiteBuild } from "./package-type.mjs";
import { prepareSiteDocs } from "./collect-docs-metas.mjs";

/**
 * Run the full Vite build for the current package (or given root).
 * Site and app packages emit a static site into `dist/` (`@excom/vite-plugin-nucleus`; a site
 * collects its docs first). Library packages discover root-level .ts/.css entry
 * files, run all build modes (a `<name>.progressive.ts` entry runs only the
 * progressive mode; `excom.umd: false` skips the UMD, for Node-only libraries,
 * and a `testing.ts` / `server.ts` entry never gets one), then buildExports and
 * the size report.
 * @param {string} [packageRoot=process.cwd()]
 * @param {{ kit?: "bundled" | "unpkg" }} [options] where a site takes the Nucleus Kit from
 */
export async function runFullBuild(packageRoot = process.cwd(), { kit } = {}) {
  await rm(path.resolve(packageRoot, "dist"), {
    recursive: true,
    force: true,
  });

  if (await usesSiteBuild(packageRoot)) {
    if (await isSitePackage(packageRoot)) await prepareSiteDocs(packageRoot);
    await build(
      await createRigViteConfig({
        mode: "build-site",
        root: packageRoot,
        packageRoot,
        kit,
      }),
    );
    return;
  }

  const files = (await readdir(packageRoot, { withFileTypes: true })).filter(
    (file) =>
      file.isFile() &&
      (file.name.endsWith(".ts") || file.name.endsWith(".css")) &&
      !file.name.endsWith(".d.ts") &&
      !file.name.endsWith(".test.ts") &&
      !file.name.endsWith(".spec.ts") &&
      !file.name.endsWith(".test.css") &&
      !file.name.endsWith(".spec.css"),
  );

  const umd = (await readPackageJson(packageRoot))?.excom?.umd !== false;
  const builds = files
    .flatMap((file) => {
      const name = file.name.replace(/\.(ts|css)$/, "");
      const type = file.name.endsWith(".css") ? "css" : "ts";
      const p = path.resolve(packageRoot, file.name);
      const entry = {
        name,
        type,
        path: p,
      };
      if (type === "ts" && name.endsWith(".progressive")) {
        return [{ mode: "build-js-progressive", entry }];
      }
      // `build-js` emits `<name>.js` + `<name>.min.js` from one bundle; the
      // UMD needs its own bundle (different externals); a Node-only entry
      // gets none. One CSS build emits `<name>.css`; the minified twins are
      // derived from it below.
      return type === "ts"
        ? [
            { mode: "build-js", entry },
            ...(umd && !NODE_ONLY_ENTRIES.includes(name) ? [{ mode: "build-js-bundle", entry }] : []),
          ]
        : [{ mode: "build-css", entry }];
    })
    .filter(Boolean);

  /*
   * Packages with no root-level entry files (e.g. tooling-only packages)
   * have nothing to build or export; bail before buildExports scans a
   * `dist` directory that was never created.
   */
  if (!builds.length) {
    console.log(`No build entry files found in ${packageRoot}; skipping.`);
    return;
  }
  await Promise.all(
    builds.map(async (info) => {
      await build(
        await createRigViteConfig({
          mode: info.mode,
          root: packageRoot,
          packageRoot,
          entry: info.entry,
        }),
      );
      if (info.mode === "build-css") {
        await writeMinifiedCss(path.resolve(packageRoot, "dist"), info.entry.name);
      }
    }),
  );

  await buildExports(packageRoot);
  await buildSizeReport(packageRoot);
}

async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const resolvedArg = path.resolve(process.cwd(), process.argv[1]);
    const thisFile = fileURLToPath(import.meta.url);
    const [argRealPath, fileRealPath] = await Promise.all([
      realpath(resolvedArg),
      realpath(thisFile),
    ]);
    return argRealPath === fileRealPath;
  } catch {
    return false;
  }
}
if (await isMain()) {
  const { values } = parseArgs({ options: { kit: { type: "string" } } });
  await runFullBuild(process.cwd(), values);
}
