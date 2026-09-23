import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const isJs = (file) => file.endsWith(".js");
const isCss = (file) => file.endsWith(".css");
const isUmd = (file) => file.includes(".umd.");
const isMap = (file) => file.endsWith(".map");
const isDts = (file) => file.endsWith(".d.ts");

/**
 * Declaration file for a JS entry: strip `.js`, then the `.min` / `.umd`
 * output modifiers (`index.umd.min.js` → `index`,
 * `nucleus-kit.progressive.min.js` → `nucleus-kit.progressive`).
 * No matching `<base>.d.ts` in `dist/` → `undefined` (no `types` condition).
 */
const typesPathForJs = (file, dtsFiles) => {
  const base = file.replace(/(?:\.umd)?(?:\.min)?\.js$/, "");
  return dtsFiles.has(`${base}.d.ts`) ? `./dist/${base}.d.ts` : undefined;
};

/**
 * Build the conditional export object for a dist file.
 * - ESM `.js`: `types` → `import` → `default` (all ESM; no UMD on these keys)
 * - UMD `.js`: `types` → `default` (not an ESM module; no `import`)
 * - `.css`: `default` only (not an ES module)
 * `types` is emitted only when its declaration exists, and always first.
 */
const conditionsFor = (file, dtsFiles) => {
  const target = `./dist/${file}`;
  if (isCss(file)) {
    return { default: target };
  }
  const types = typesPathForJs(file, dtsFiles);
  if (isUmd(file)) {
    return {
      ...(types && { types }),
      default: target,
    };
  }
  return {
    ...(types && { types }),
    import: target,
    default: target,
  };
};

export async function buildExports(packageRoot = process.cwd()) {
  const dist = path.resolve(packageRoot, "dist");
  const out = path.resolve(packageRoot, "dist/exports.generated.json");

  const exportsMap = {};
  const files = await readdir(dist);
  const dtsFiles = new Set(files.filter(isDts));

  for (const file of files) {
    /*
     * Source maps are discovered via sourceMappingURL; declaration files
     * attach through the `types` condition on JS entries, neither needs
     * a standalone subpath export.
     */
    if (isMap(file) || isDts(file)) continue;
    if (!isJs(file) && !isCss(file)) continue;

    const conditions = conditionsFor(file, dtsFiles);
    // JS: strip `.js` for the bare key (`./index.min`). CSS keeps the
    // full filename (`./index.css`).
    const baseName = isJs(file) ? file.replace(/\.js$/, "") : file;

    const keys = [`./${baseName}`, `./dist/${baseName}`];
    if (isJs(file)) {
      keys.push(`./${baseName}.js`, `./dist/${baseName}.js`);
    }

    for (const key of keys) {
      exportsMap[key] = { ...conditions };
    }

    // Root export is the unminified ESM entry only, never UMD / *.min.js.
    if (file === "index.js") {
      exportsMap["."] = { ...conditions };
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(exportsMap).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(out, JSON.stringify(sorted, null, 2));
}
