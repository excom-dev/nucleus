import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const isJs = (file) => file.endsWith(".js");
const isCss = (file) => file.endsWith(".css");
const isUmd = (file) => file.includes(".umd.");
const isMap = (file) => file.endsWith(".map");
const isDts = (file) => file.endsWith(".d.ts");

/** `index.min.js` / `super-input.umd.min.js` → `./dist/index.d.ts` / `./dist/super-input.d.ts` */
const typesPathForJs = (file) => {
  const entry = file.replace(/\.js$/, "").split(".")[0];
  return `./dist/${entry}.d.ts`;
};

/**
 * Build the conditional export object for a dist file.
 * - ESM `.js`: `types` → `import` → `default` (all ESM; no UMD on these keys)
 * - UMD `.js`: `types` → `default` (not an ESM module; no `import`)
 * - `.css`: `default` only (not an ES module)
 */
const conditionsFor = (file) => {
  const target = `./dist/${file}`;
  if (isCss(file)) {
    return { default: target };
  }
  if (isUmd(file)) {
    return {
      types: typesPathForJs(file),
      default: target,
    };
  }
  return {
    types: typesPathForJs(file),
    import: target,
    default: target,
  };
};

export async function buildExports(packageRoot = process.cwd()) {
  const dist = path.resolve(packageRoot, "dist");
  const out = path.resolve(packageRoot, "dist/exports.generated.json");

  const exportsMap = {};

  for (const file of await readdir(dist)) {
    /*
     * Source maps are discovered via sourceMappingURL; declaration files
     * attach through the `types` condition on JS entries, neither needs
     * a standalone subpath export.
     */
    if (isMap(file) || isDts(file)) continue;
    if (!isJs(file) && !isCss(file)) continue;

    const conditions = conditionsFor(file);
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
      exportsMap["."] = {
        types: typesPathForJs(file),
        import: `./dist/${file}`,
        default: `./dist/${file}`,
      };
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(exportsMap).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(out, JSON.stringify(sorted, null, 2));
}
