#!/usr/bin/env node
/**
 * `rush build:package-metas` / `pnpm build:package-metas` from a package root:
 *
 *   1. `support/custom-elements.json` via `build-cem.mjs` when the package
 *      defines Neutron elements.
 *   2. `support/package-meta.json` for documented packages — the docs-site
 *      bundle (flattened APIs, demos, README HTML, installation, exports).
 *
 * `excom.documented: false` (or no `excom`) skips the full meta, except
 * site packages with `support/docs/*.md` — those emit a slim meta (`docs`,
 * empty APIs). Mixin CEMs come from `node_modules`; Rush dependency order
 * must hold when this is a bulk command.
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

import { buildCem } from "./build-cem.mjs";
import { flattenCem } from "./cem-flatten.mjs";
import {
  analyzeCss,
  extractMixinCustomProperties,
  mergeCssDocsIntoDeclaration,
} from "./cem-analyze-css.mjs";
import { renderMarkdown, renderMarkdownInline } from "./render-markdown.mjs";
import { titleFromDocHtml, titleCaseKey } from "./build-search-docs.mjs";
import { SITE_BASE, SITE_HOME_DOC } from "./site-base.mjs";

export async function buildPackageMetas(packageRoot = process.cwd()) {
  await buildCem(packageRoot);

  const pkgJsonPath = path.resolve(packageRoot, "package.json");
  const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
  const shortName = pkg.name.replace(/^@[^/]+\//, "");
  const packageType = pkg.excom?.packageType;
  const docs = await readSupportDocs(packageRoot, { shortName, packageType });
  const docSections = await readDocSections(packageRoot, docs);
  const skipDocumented = !pkg.excom || pkg.excom.documented === false;
  const isSiteDocs = packageType === "site" && Object.keys(docs).length > 0;

  if (skipDocumented && !isSiteDocs) return;

  const packageBlock = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    peerDependencies: pkg.peerDependencies ?? {},
    excom: pkg.excom,
    exports: pkg.exports,
  };

  if (skipDocumented && isSiteDocs) {
    await writePackageMeta(packageRoot, {
      shortName,
      package: packageBlock,
      docs,
      ...(docSections ? { docSections } : {}),
      demos: {},
      elementApis: [],
      exportedFiles: {},
    });
    return;
  }

  const cem = await readJsonIfExists(
    path.resolve(packageRoot, "support/custom-elements.json"),
  );
  const cssFiles = await listRootCss(packageRoot);
  const demos = await readDemos(packageRoot);

  const elementApis = htmlifyApiDescriptions(
    cem
      ? flattenCem(cem, resolveMixinCem(packageRoot))
      : await buildCssLibraryApis(packageRoot, shortName),
  );

  await writePackageMeta(packageRoot, {
    shortName,
    package: packageBlock,
    demos,
    ...(docs.readme !== undefined ? { readme: docs.readme } : {}),
    ...(Object.keys(docs).length ? { docs } : {}),
    ...(docSections ? { docSections } : {}),
    installation: buildInstallation(pkg, cssFiles),
    elementApis,
    exportedFiles: buildExportedFiles(pkg.exports),
  });
}

async function writePackageMeta(packageRoot, meta) {
  const outDir = path.resolve(packageRoot, "support");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.resolve(outDir, "package-meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
    "utf8",
  );
}

/**
 * `support/docs/*.md` → HTML, keyed by lowercase basename
 * (`README.md` → `readme`, `QUICK_START.md` → `quick_start`). `INTERNAL.md`
 * (contributor notes) is skipped. Relative links between those files
 * (`./PROPS.md`, `PROPS.md#md-x`) work on GitHub as authored and are
 * rewritten to the site routes here (`/nucleus/packages/<pkg>/props`, the
 * README to `/nucleus/packages/<pkg>`; site packages `/nucleus/docs/<page>`).
 * The README is rendered through the same rewrite — its `./PAGE.md` links
 * get the base too.
 */
async function readSupportDocs(packageRoot, { shortName, packageType } = {}) {
  const docsDir = path.resolve(packageRoot, "support/docs");
  if (!existsSync(docsDir)) return {};
  const entries = await readdir(docsDir, { withFileTypes: true });
  const docs = {};
  for (const entry of entries) {
    if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
    if (entry.name.toLowerCase() === "internal.md") continue;
    const key = entry.name.replace(/\.md$/i, "").toLowerCase();
    const md = await readFile(path.join(docsDir, entry.name), "utf8");
    docs[key] = rewriteDocLinks(renderMarkdown(md), { shortName, packageType });
  }
  return docs;
}

/**
 * `./PAGE.md#hash` → the page's site route under `SITE_BASE`, on `href`
 * (external `<a>`) and `route-href` (the `<spa-a>` the renderer emits for
 * relative links) alike.
 *
 * Site package: `/nucleus/docs/<page>`, except `INTRODUCTION.md` — the docs
 * home is `SITE_BASE` itself and `/nucleus/docs/introduction` is a 404.
 * Other packages: `/nucleus/packages/<pkg>/<page>`, README `/nucleus/packages/<pkg>`.
 */
export function rewriteDocLinks(html, { shortName, packageType } = {}) {
  if (!html || !shortName) return html;
  return html.replace(
    /\b(route-href|href)="(?:\.\/)?([\w-]+)\.md(#[^"]*)?"/gi,
    (_full, attr, name, hash = "") => {
      const key = name.toLowerCase();
      const route =
        packageType === "site"
          ? key === SITE_HOME_DOC
            ? SITE_BASE
            : `${SITE_BASE}/docs/${key}`
          : key === "readme"
            ? `${SITE_BASE}/packages/${shortName}`
            : `${SITE_BASE}/packages/${shortName}/${key}`;
      return `${attr}="${route}${hash}"`;
    },
  );
}

/**
 * `support/docs-sections.json` (`{ sections: [{ id, title, docs: [key] }] }`,
 * the docs-site format) → sidebar groups with page titles from each page's
 * first `<h1>`. Keys without a rendered page are dropped with a warning.
 * `undefined` when the file is absent.
 */
async function readDocSections(packageRoot, docs) {
  const sectionsPath = path.resolve(packageRoot, "support/docs-sections.json");
  if (!existsSync(sectionsPath)) return undefined;
  const { sections = [] } = JSON.parse(await readFile(sectionsPath, "utf8"));
  const out = [];
  for (const section of sections) {
    const pages = [];
    for (const name of section.docs ?? []) {
      if (!(name in docs)) {
        console.warn(
          `[build-package-metas] docs-sections.json names "${name}" but support/docs has no such page`,
        );
        continue;
      }
      pages.push({ name, title: titleFromDocHtml(docs[name]) || titleCaseKey(name) });
    }
    if (pages.length) out.push({ id: section.id, title: section.title, docs: pages });
  }
  return out;
}

function resolveMixinCem(packageRoot) {
  return (ref) => {
    const base = path.resolve(packageRoot, "node_modules", ref);
    const mixinPkg = readJsonSyncIfExists(path.join(base, "package.json"));
    if (mixinPkg?.excom?.packageType !== "element-base") return undefined;
    return readJsonSyncIfExists(path.join(base, "support/custom-elements.json"));
  };
}

/** CEM descriptions are authored as markdown (backticks, etc.); docs use HTML. */
const API_DESC_COLLECTIONS = [
  "attributes",
  "events",
  "slots",
  "cssProperties",
  "cssClasses",
  "cssAliases",
  "listens",
  "commands",
  "defaultActions",
  "expectedChildren",
  "provisions",
];

function htmlifyApiDescriptions(apis) {
  for (const api of apis ?? []) {
    if (api.summary) api.summary = renderMarkdownInline(api.summary);
    for (const key of API_DESC_COLLECTIONS) {
      for (const item of api[key] ?? []) {
        if (item.description) {
          item.description = renderMarkdownInline(item.description);
        }
        if (item.defaultAction) {
          item.defaultAction = renderMarkdownInline(item.defaultAction);
        }
      }
    }
  }
  return apis;
}

function buildInstallation(pkgJson, cssFiles) {
  const { name, version, description } = pkgJson;
  const shortName = name.replace(/^@[^/]+\//, "");
  const packageType = pkgJson.excom?.packageType;
  const isElement = packageType === "kit-element";
  const sideEffectImport = pkgJson.excom?.sideEffectImport === true;
  const cssEntry = cssFiles.includes("index.css")
    ? null
    : cssFiles.includes("basic.css")
      ? "basic.css"
      : cssFiles[0];
  const cssImport = cssFiles.includes("index.css")
    ? `@import "${name}";`
    : cssEntry
      ? `@import "${name}/${cssEntry}";`
      : undefined;
  const jsImport =
    isElement || sideEffectImport
      ? `import "${name}";`
      : packageType === "library" && cssImport
        ? undefined
        : `import { /* … */ } from "${name}";`;
  return {
    name,
    shortName,
    version,
    description,
    packageType,
    // Element UMDs read `neutron` / `kit-utils` from `NucleusStack`
    // (`UMD_SHARED_GLOBALS`); a CDN page loads those two UMDs first.
    cdn: isElement
      ? [
          `<script src="https://unpkg.com/@excom/kit-utils/dist/index.umd.min.js"></script>`,
          `<script src="https://unpkg.com/@excom/neutron/dist/index.umd.min.js"></script>`,
          `<script src="https://unpkg.com/${name}@${version}/dist/index.umd.min.js"></script>`,
          ...(cssEntry || cssFiles.includes("index.css")
            ? [`<link rel="stylesheet" href="https://unpkg.com/${name}@${version}/dist/${cssEntry ?? "index.css"}">`]
            : []),
        ].join("\n")
      : undefined,
    install: { npm: `npm install ${name}` },
    imports: {
      js: jsImport,
      css: cssImport,
      html: isElement
        ? `<!-- import path to \`node_modules\` will depend on your build setup -->\n<script type="module" src="/node_modules/${name}"></script>\n<link rel="stylesheet" href="/node_modules/${name}">`
        : undefined,
    },
    peerDependencies: Object.entries(pkgJson.peerDependencies ?? {}).map(
      ([n, v]) => ({ name: n, version: v }),
    ),
  };
}

function buildExportedFiles(exports) {
  return Object.fromEntries(
    Object.entries(exports ?? {})
      .filter(([k]) => !k.startsWith("./dist/"))
      .map(([k, v]) => [k, typeof v === "string" ? { default: v } : v]),
  );
}

async function readDemos(packageRoot) {
  const demosDir = path.resolve(packageRoot, "support/demos");
  if (!existsSync(demosDir)) return {};
  const entries = await readdir(demosDir, { withFileTypes: true });
  const demos = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const name = entry.name.replace(/\.html$/, "");
    if (name === "index") continue;
    demos[name] = await readFile(path.join(demosDir, entry.name), "utf8");
  }
  return demos;
}

async function listRootCss(packageRoot) {
  const entries = await readdir(packageRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".css"))
    .map((e) => e.name);
}

/**
 * CSS-only library (no CEM): scan `@cssproperty` / `@cssclass` /
 * `@custom-selector` and emit one synthetic API for the docs site.
 */
async function buildCssLibraryApis(packageRoot, shortName) {
  const cssPaths = await listCssFilesRecursive(path.resolve(packageRoot));
  if (!cssPaths.length) return [];

  const decl = {
    tagName: shortName,
    kind: "class",
    summary: undefined,
    cssProperties: [],
    _neutron: { cssClasses: [], cssAliases: [] },
  };

  for (const cssPath of cssPaths) {
    const cssSrc = await readFile(cssPath, "utf8");
    const cssApi = analyzeCss(cssSrc);
    // Theme tokens in `@define-mixin scheme-*` without `@cssproperty` — harvest as defaults.
    const schemeProps = extractMixinCustomProperties(cssSrc);
    if (schemeProps.length) {
      cssApi.cssProperties = [
        ...schemeProps.map((p) => ({ name: p.name, default: p.default })),
        ...cssApi.cssProperties,
      ];
    }
    mergeCssDocsIntoDeclaration(decl, cssApi);
  }

  const hasDocs =
    decl.cssProperties.length ||
    decl._neutron.cssClasses.length ||
    decl._neutron.cssAliases.length;
  if (!hasDocs) return [];

  return flattenCem(
    {
      schemaVersion: "1.0.0",
      modules: [{ path: `${shortName}.css`, declarations: [decl] }],
    },
    () => undefined,
  );
}

async function listCssFilesRecursive(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "support" ||
        entry.name === "coverage"
      ) {
        continue;
      }
      await listCssFilesRecursive(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      acc.push(full);
    }
  }
  return acc;
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(await readFile(filePath, "utf8"));
}

function readJsonSyncIfExists(filePath) {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function isMain() {
  if (!process.argv[1]) return false;
  try {
    const resolvedArg = path.resolve(process.cwd(), process.argv[1]);
    const thisFile = fileURLToPath(import.meta.url);
    const [argReal, fileReal] = await Promise.all([
      realpath(resolvedArg),
      realpath(thisFile),
    ]);
    return argReal === fileReal;
  } catch {
    return false;
  }
}

if (await isMain()) {
  await buildPackageMetas();
}
