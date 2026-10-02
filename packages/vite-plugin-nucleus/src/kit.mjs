// The Nucleus Kit in a site build: bundled from the installed kit (the default),
// or with `kit: "unpkg"` loaded from unpkg at the installed version. Then nothing
// of the kit, nor of a package it bundles, may ship in the build: the plugin
// rewrites what it can (`@excom/nucleus-kit/<path>` imported by a script, by a
// stylesheet a page links or by a page's `<style>`) and stops the build, naming
// the file, on the rest.
import { transformCss } from "../css.mjs";
import { access, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const KIT = "@excom/nucleus-kit";
const KIT_IMPORT = /^@excom\/nucleus-kit\/(.+)$/;
const KIT_CSS_IMPORT = /@import\s+(?:url\(\s*)?(["']?)@excom\/nucleus-kit\/([^"')\s;]+\.css)\1\s*\)?/g;
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1/g;
const CSS_URL = /url\(\s*(["']?)([^"')\s]+)\1\s*\)/g;
const CSS_REQUEST = /\.css(?:$|\?)/;
const PACKAGE = /^(@[^/]+\/[^/]+|[^/@.][^/]*)(?:\/(.*))?$/;
/** The `exports` conditions a page's `import` meets. */
const CONDITIONS = ["browser", "import", "module", "default"];

const exists = (file) => access(file).then(() => true, () => false);
const inside = (dir, file) => {
  const from = relative(dir, file);
  return from !== "" && from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from);
};

/** The real directory of package `name` as Node finds it from `dir`, if installed. */
async function packageDir(dir, name) {
  const candidate = join(dir, "node_modules", name);
  if (await exists(join(candidate, "package.json"))) return realpath(candidate);
  return dirname(dir) === dir ? undefined : packageDir(dirname(dir), name);
}

/** The Nucleus Kit installed for the site at `root`: its real `dir`, `version` and package.json. */
export async function kitOf(root) {
  const dir = await packageDir(root, KIT);
  if (!dir) throw new Error(`kit "unpkg": ${KIT} is not installed`);
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  return { dir, version: pkg.version, pkg };
}

/** The file an `exports` value names for a page's `import`: the first condition it meets. */
const exportedFile = (value) =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map(exportedFile).find(Boolean)
      : Object.entries(value ?? {})
          .filter(([condition]) => CONDITIONS.includes(condition))
          .map(([, target]) => exportedFile(target))
          .find(Boolean);

/**
 * The installed kit as an unpkg build of the site at `root` sees it: `url(path)`
 * on unpkg of `@excom/nucleus-kit/<path>` (the file its `exports` name, none when
 * it exports no such path; without `exports`, as in a workspace, `dist/<path>.min.js`
 * or the stylesheet), whether a file is `owned` by the kit or a package it
 * bundles, whether a specifier `names` one of them.
 * @param {string} root
 */
export async function unpkgKitOf(root) {
  const kit = await kitOf(root);
  const base = `https://unpkg.com/${KIT}@${kit.version}`;
  const { exports } = kit.pkg;
  const bundled = Object.keys(kit.pkg.dependencies ?? {});
  const owners = [kit.dir, ...(await Promise.all(bundled.map((name) => packageDir(kit.dir, name)))).filter(Boolean)];
  const fileOf = (path) =>
    exports === undefined
      ? `dist/${path.endsWith(".css") ? path : `${path}.min.js`}`
      : exportedFile(exports[`./${path}`])?.replace(/^\.\//, "");
  return {
    root,
    version: kit.version,
    url: (path) => {
      const file = fileOf(path);
      return file && `${base}/${file}`;
    },
    owned: (file) => owners.some((dir) => inside(dir, file)),
    names: (specifier) => [KIT, ...bundled].includes(PACKAGE.exec(specifier)?.[1]),
  };
}

const uncommented = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** A stylesheet's `@import` targets. */
const importsOf = (css) => [...uncommented(css).matchAll(CSS_IMPORT)].map(([, , specifier]) => specifier);

/** A stylesheet's `url()` targets, its `@import`s left out. */
const urlsOf = (css) =>
  [...uncommented(css).replace(/@import[^;]*;?/g, "").matchAll(CSS_URL)].map(([, , specifier]) => specifier);

/** The file a stylesheet's `@import` names, as PostCSS finds it: relative, or a package's file. */
async function cssFileOf(specifier, from) {
  if (/^[a-z][a-z\d+.-]*:|^\//i.test(specifier)) return undefined;
  const [, name, rest] = specifier.startsWith(".") ? [] : (PACKAGE.exec(specifier) ?? []);
  const dir = name && rest ? await packageDir(dirname(from), name) : undefined;
  const file = specifier.startsWith(".") ? resolve(dirname(from), specifier) : dir && join(dir, rest);
  return file && (await exists(file)) ? realpath(file) : undefined;
}

/** CSS a stylesheet adds to a build (not only definitions: mixins, custom selectors). */
const emits = async (file) =>
  (await transformCss(await readFile(file, "utf8"), file)).replace(/\/\*[\s\S]*?\*\//g, "").trim() !== "";

/**
 * The plugin of an unpkg build; `unpkg()` is the kit of the site being built
 * (`unpkgKitOf`). A script's `@excom/nucleus-kit/<path>` and a stylesheet's
 * `@import` of `@excom/nucleus-kit/<name>.css` load the file the kit exports
 * there from unpkg. Stops the build on a path the kit does not export, a chunk
 * holding code of the kit or of a package it bundles (a bare
 * `@excom/nucleus-kit`, `@excom/quark`), a stylesheet that pulls in their CSS
 * through a nested `@import`, and a stylesheet's `url()` naming them (the kit's
 * `dist` holds no such file).
 * @param {() => Awaited<ReturnType<typeof unpkgKitOf>>} unpkg
 */
export function kitPlugin(unpkg) {
  const shown = (file) => relative(unpkg().root, file) || file;
  const stop = (context, message) => context.error(`kit "unpkg": ${message}`);
  const urlOf = (context, path) =>
    unpkg().url(path) ?? stop(context, `${KIT}/${path} is not a path ${KIT}@${unpkg().version} exports`);
  /** A stylesheet and its nested imports: no `url()` naming the kit, no kit file that adds CSS. */
  const check = async (context, file, css, seen = new Set()) => {
    const named = urlsOf(css).find(unpkg().names);
    if (named) stop(context, `${shown(file)} names ${named} in a url()`);
    for (const specifier of importsOf(css)) {
      const target = await cssFileOf(specifier, file);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      if (!unpkg().owned(target)) await check(context, target, await readFile(target, "utf8"), seen);
      else if (await emits(target))
        stop(context, `${shown(file)} imports ${specifier}, Nucleus Kit CSS the build would ship; a stylesheet a page links imports @excom/nucleus-kit/<name>.css`);
    }
  };
  return {
    name: "nucleus-kit",
    enforce: "pre",
    // no chunk of ours to preload: a page whose script only imports the kit
    // loads it straight from unpkg (`<script type="module" src="https://unpkg.com/…">`)
    config: () => ({ build: { modulePreload: { polyfill: false } } }),
    resolveId(source) {
      const path = KIT_IMPORT.exec(source)?.[1];
      return path ? { id: urlOf(this, path), external: true } : null;
    },
    // before PostCSS inlines the imports
    async transform(code, id) {
      if (!CSS_REQUEST.test(id)) return null;
      const rewritten = code.replace(KIT_CSS_IMPORT, (_, __, path) => `@import "${urlOf(this, path)}"`);
      await check(this, id.split("?")[0], rewritten);
      return rewritten === code ? null : { code: rewritten, map: null };
    },
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle).filter(({ type }) => type === "chunk")) {
        const [id] =
          Object.entries(chunk.modules).find(([id, { renderedLength }]) => renderedLength && unpkg().owned(id.split("?")[0])) ?? [];
        if (id) stop(this, `${chunk.fileName} holds ${shown(id)}: import @excom/nucleus-kit/<entry>, loaded from unpkg`);
      }
    },
  };
}
