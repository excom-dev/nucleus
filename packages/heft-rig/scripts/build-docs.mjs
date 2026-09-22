#!/usr/bin/env node
/**
 * `rush build:docs` / `pnpm build:docs`: one Markdown file per CEM element
 * into `support/dist-docs/<element>.md`.
 *
 * Inputs (CEM required; rest optional):
 *   - `support/custom-elements.json` — this package's CEM
 *     (from build:package-metas)
 *   - `node_modules/@<scope>/<pkg>/support/custom-elements.json` —
 *     upstream CEMs via `mixins[].package` (flatten composition)
 *   - `support/docs/README.md` — prose, primary element only; skeleton
 *     with placeholders expanded in place (mirrors the docs site)
 *   - `support/demos/*.html` (not index) — snippets, primary only
 *
 * README placeholders (same as the docs site):
 *   - `<include-content data-demo="NAME">` → fenced HTML demo source
 *   - `<live-demo src="pkg/NAME">` → fenced HTML demo source
 *   - `template-ref="/views/install-section/install-section.html"` → install/import
 *   - `template-ref="/views/api-reference/api-reference.html"` → CEM API tables
 *
 * Output names: tag (`spa-a.md`) or kebab declaration (`listenable-element.md`
 * for `ListenableElement`). Primary = filename matching the package shortname
 * (`spa-route.md` in `spa-route`), else first decl. Only primary gets README
 * and demos.
 *
 * Mixin attributes/events/slots fold into the API table with `Inherited from`.
 * No CEM → silent skip (Rush bulk stays runnable).
 */
import { readFile, readdir, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";

export async function buildDocs(packageRoot = process.cwd()) {
  const pkg = JSON.parse(
    await readFile(path.resolve(packageRoot, "package.json"), "utf8"),
  );
  const shortName = pkg.name.replace(/^@[^/]+\//, "");

  const cem = await readJson(
    path.resolve(packageRoot, "support/custom-elements.json"),
  );
  if (!cem) {
    await buildSiteDocs(packageRoot);
    return;
  }

  const decls = allDeclarations(cem);
  if (!decls.length) return;

  const flats = [];
  for (const decl of decls) {
    flats.push(await flattenDeclaration(decl, packageRoot));
  }

  const readme = await readIfExists(
    path.resolve(packageRoot, "support/docs/README.md"),
  );
  const demos = await readDemos(path.resolve(packageRoot, "support/demos"));
  const installation = buildInstallation(pkg, packageRoot);

  const named = flats.map((decl) => ({
    decl,
    fileName: elementFileName(decl),
  }));
  const primaryIdx = pickPrimaryIndex(named, shortName);

  const outDir = path.resolve(packageRoot, "support/dist-docs");
  // Wipe `support/dist-docs/` each run so renamed/removed elements leave no stale files.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (let i = 0; i < named.length; i++) {
    const { decl, fileName } = named[i];
    const isPrimary = i === primaryIdx;
    const md = renderElementMarkdown({
      decl,
      readme: isPrimary ? readme : undefined,
      demos: isPrimary ? demos : [],
      installation: isPrimary ? installation : undefined,
    });
    await writeFile(path.resolve(outDir, `${fileName}.md`), md, "utf8");
  }
}

/**
 * Same install/import block as docs-site `getInstallation()` in `shell.ts`.
 * Reads package.json + package root (CSS presence).
 */
function buildInstallation(pkg, packageRoot) {
  const name = pkg.name;
  const shortName = name.replace(/^@[^/]+\//, "");
  const cssCandidate = `${shortName}.css`;
  const hasCss = existsSync(path.resolve(packageRoot, cssCandidate));
  const isElement = pkg.excom?.packageType === "kit-element";
  return {
    name,
    shortName,
    version: pkg.version,
    description: pkg.description,
    packageType: pkg.excom?.packageType,
    install: {
      npm: `npm install ${name}`,
      pnpm: `pnpm add ${name}`,
      yarn: `yarn add ${name}`,
    },
    imports: {
      js: isElement
        ? `import "${name}";`
        : `import { /* … */ } from "${name}";`,
      css: hasCss ? `@import "${name}/${cssCandidate}";` : undefined,
    },
    peerDependencies: Object.entries(pkg.peerDependencies ?? {}).map(
      ([n, v]) => ({ name: n, version: v }),
    ),
  };
}

function elementFileName(decl) {
  if (decl.tagName) return decl.tagName;
  return camelToKebab(decl.name);
}

function pickPrimaryIndex(named, shortName) {
  const idx = named.findIndex((n) => n.fileName === shortName);
  return idx >= 0 ? idx : 0;
}

function camelToKebab(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
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
  await buildDocs();
}

/**
 * No CEM: copy `support/docs/*.md` → `support/dist-docs/docs/<lowercase>.md`
 * for `build:docs-index` to mirror into repo-root `dist-docs/`.
 */
async function buildSiteDocs(packageRoot) {
  const docsDir = path.resolve(packageRoot, "support/docs");
  if (!existsSync(docsDir)) return;
  // `INTERNAL.md` holds contributor notes, never consumer docs.
  const files = (await readdir(docsDir)).filter(
    (f) => f.endsWith(".md") && f.toLowerCase() !== "internal.md",
  );
  if (!files.length) return;

  const outDir = path.resolve(packageRoot, "support/dist-docs");
  const docsOut = path.resolve(outDir, "docs");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(docsOut, { recursive: true });

  for (const file of files) {
    const name = file.replace(/\.md$/i, "").toLowerCase();
    await copyFile(path.resolve(docsDir, file), path.resolve(docsOut, `${name}.md`));
  }
}

// --- I/O helpers --------------------------------------------------------

async function readIfExists(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return undefined;
  }
}

async function readJson(p) {
  const raw = await readIfExists(p);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function readDemos(dir) {
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const demos = [];
  for (const f of files) {
    if (!f.endsWith(".html") || f === "index.html") continue;
    const source = await readFile(path.join(dir, f), "utf8");
    demos.push({ name: f.replace(/\.html$/, ""), source: source.trim() });
  }
  return demos.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Composition flattening --------------------------------------------

function allDeclarations(cem) {
  const out = [];
  for (const mod of cem?.modules ?? []) {
    for (const decl of mod.declarations ?? []) out.push(decl);
  }
  return out;
}

function firstDeclaration(cem) {
  return cem?.modules?.[0]?.declarations?.[0];
}

/**
 * Recurse `decl.mixins` `{ name, package }` refs via that package's CEM
 * in `node_modules`. Unresolved refs stay opaque. Inherited entries get
 * `inheritedFrom` = immediate package (transitives collapse to nearest).
 */
async function flattenDeclaration(decl, packageRoot, seen = new Set()) {
  const out = {
    name: decl.name,
    tagName: decl.tagName,
    kind: decl.kind,
    customElement: decl.customElement,
    summary: decl.summary,
    description: decl.description,
    attributes: [...(decl.attributes ?? [])],
    members: [...(decl.members ?? [])],
    events: [...(decl.events ?? [])],
    slots: [...(decl.slots ?? [])],
    cssProperties: [...(decl.cssProperties ?? [])],
    _neutron: {
      listens: [...(decl._neutron?.listens ?? [])],
      commands: [...(decl._neutron?.commands ?? [])],
      defaultActions: [...(decl._neutron?.defaultActions ?? [])],
      expectedChildren: [...(decl._neutron?.expectedChildren ?? [])],
      cssClasses: [...(decl._neutron?.cssClasses ?? [])],
      cssAliases: [...(decl._neutron?.cssAliases ?? [])],
      provisions: [...(decl._neutron?.provisions ?? [])],
    },
  };

  for (const ref of decl.mixins ?? []) {
    if (!ref.package || seen.has(ref.package)) continue;
    const next = new Set(seen).add(ref.package);
    const mixinCemPath = path.resolve(
      packageRoot,
      "node_modules",
      ref.package,
      "support/custom-elements.json",
    );
    const mixinCem = await readJson(mixinCemPath);
    const mixinDecl = firstDeclaration(mixinCem);
    if (!mixinDecl) continue;
    const mixinFlat = await flattenDeclaration(mixinDecl, packageRoot, next);
    mergeInherited(out, mixinFlat, ref.package);
  }
  applyTagPlaceholders(out);
  return out;
}

/** Replace `{tag}` in event / listens / default-action names with the real tag. */
function applyTagPlaceholders(decl) {
  const tag = decl.tagName && decl.tagName !== "noop-tag" ? decl.tagName : undefined;
  if (!tag) return;
  const rewrite = (entry) => ({
    ...entry,
    name: String(entry.name ?? "").replaceAll("{tag}", tag),
    description: entry.description
      ? String(entry.description).replaceAll("{tag}", tag)
      : entry.description,
  });
  decl.events = (decl.events ?? []).map(rewrite);
  decl._neutron.listens = (decl._neutron.listens ?? []).map(rewrite);
  decl._neutron.defaultActions = (decl._neutron.defaultActions ?? []).map(rewrite);
}

function mergeInherited(target, source, fromPackage) {
  const tag = (entry) => ({ ...entry, inheritedFrom: fromPackage });
  for (const key of ["attributes", "members", "events", "slots", "cssProperties"]) {
    for (const entry of source[key]) {
      if (!target[key].some((e) => e.name === entry.name)) {
        target[key].push(tag(entry));
      }
    }
  }
  for (const key of [
    "listens",
    "commands",
    "defaultActions",
    "cssClasses",
    "cssAliases",
    "provisions",
  ]) {
    for (const entry of source._neutron[key] ?? []) {
      if (!target._neutron[key].some((e) => e.name === entry.name)) {
        target._neutron[key].push(tag(entry));
      }
    }
  }
  for (const entry of source._neutron.expectedChildren) {
    if (
      !target._neutron.expectedChildren.some(
        (e) =>
          e.relationship === entry.relationship && e.selector === entry.selector,
      )
    ) {
      target._neutron.expectedChildren.push(tag(entry));
    }
  }
}

// --- Markdown rendering -------------------------------------------------

function renderElementMarkdown({ decl, readme, demos, installation }) {
  const demoList = demos ?? [];

  // README is the skeleton (same as the docs site). Unreferenced install /
  // API / demos are appended so packages without include markers stay complete.
  if (readme) {
    const { markdown, usedInstall, usedApi, usedDemos } = expandReadmeIncludes(
      readme,
      { decl, demos: demoList, installation },
    );
    const lines = [markdown.trim(), ""];
    if (!usedInstall && installation) {
      renderInstallationSection(lines, installation);
    }
    if (!usedApi) {
      renderDeclSections(lines, decl, { headingLevel: 2 });
    }
    const unusedDemos = demoList.filter((d) => !usedDemos.has(d.name));
    if (unusedDemos.length) {
      lines.push("## Demo sources", "");
      for (const d of unusedDemos) {
        lines.push(`### ${d.name}`, "", "```html", d.source, "```", "");
      }
    }
    return lines.join("\n");
  }

  const lines = [];
  const title = decl.tagName ? `\`<${decl.tagName}>\`` : decl.name;
  lines.push(`# ${title}`, "");
  if (decl.summary) lines.push(`> ${decl.summary}`, "");
  if (decl.tagName) lines.push(`**Tag:** \`<${decl.tagName}>\``, "");
  if (decl.kind === "mixin") {
    lines.push(
      `**Kind:** Neutron mixin (composition base — not a registered element).`,
      "",
    );
  }
  if (installation) {
    renderInstallationSection(lines, installation);
  }
  renderDeclSections(lines, decl, { headingLevel: 2 });
  if (demoList.length) {
    lines.push("## Demo sources", "");
    for (const d of demoList) {
      lines.push(`### ${d.name}`, "", "```html", d.source, "```", "");
    }
  }
  return lines.join("\n");
}

/**
 * Expand docs-site include markers in a README so the file matches the portal
 * after Quark resolves them.
 */
function expandReadmeIncludes(readme, { decl, demos, installation }) {
  const demosByName = new Map(demos.map((d) => [d.name, d]));
  const usedDemos = new Set();
  let usedInstall = false;
  let usedApi = false;

  const replaceTag = (full, tagName, attrs) => {
    const demoName =
      getAttr(attrs, "data-demo") ??
      (tagName === "live-demo" ? demoNameFromSrc(getAttr(attrs, "src")) : undefined);
    if (demoName) {
      const demo = demosByName.get(demoName);
      if (!demo) return full;
      usedDemos.add(demoName);
      return `\n\`\`\`html\n${demo.source}\n\`\`\`\n`;
    }

    const templateRef = getAttr(attrs, "template-ref") ?? "";
    if (templateRef.includes("install-section")) {
      usedInstall = true;
      if (!installation) return "";
      const lines = [];
      renderInstallationBody(lines, installation);
      return `\n${lines.join("\n")}\n`;
    }
    if (templateRef.includes("api-reference")) {
      usedApi = true;
      const lines = [];
      // Nested under the README `### API Reference` heading.
      renderDeclSections(lines, decl, {
        headingLevel: 3,
        skipOuterHeading: true,
      });
      return lines.length ? `\n${lines.join("\n")}\n` : "";
    }

    // Unknown include — leave the marker.
    return full;
  };

  /*
   * Empty placeholders only (`<include-content …></include-content>` /
   * `<live-demo …></live-demo>` / self-closing). An empty body avoids
   * matching `` `<include-content>` `` in prose and eating the next closer.
   */
  const markdown = readme
    .replace(
      /<(include-content|live-demo)\b([^>]*)\/>/gi,
      (full, tagName, attrs) => replaceTag(full, tagName.toLowerCase(), attrs),
    )
    .replace(
      /<(include-content|live-demo)\b([^>]*)>\s*<\/\1>/gi,
      (full, tagName, attrs) => replaceTag(full, tagName.toLowerCase(), attrs),
    );

  return { markdown, usedInstall, usedApi, usedDemos };
}

function getAttr(attrs, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return attrs.match(re)?.[1];
}

function demoNameFromSrc(src) {
  if (!src) return undefined;
  const trimmed = src.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function renderInstallationSection(lines, installation) {
  lines.push("## Installation", "");
  renderInstallationBody(lines, installation);
}

function renderInstallationBody(lines, installation) {
  lines.push(`\`${installation.name}\` v${installation.version}`, "");
  lines.push("```bash", installation.install.pnpm, "```", "");
  lines.push("```bash", installation.install.npm, "```", "");
  lines.push("```bash", installation.install.yarn, "```", "");
  lines.push("### Import", "");
  lines.push("```ts", installation.imports.js, "```", "");
  if (installation.imports.css) {
    lines.push("```css", installation.imports.css, "```", "");
  }
  if (installation.peerDependencies.length) {
    renderTable(
      lines,
      "### Peer dependencies",
      ["Package", "Version"],
      installation.peerDependencies,
      (p) => [`\`${p.name}\``, `\`${p.version}\``],
    );
  }
}

function renderDeclSections(lines, decl, { headingLevel, skipOuterHeading = false }) {
  const h = (n) => "#".repeat(headingLevel + n);

  const attributes = annotateAttributeSurfaces(decl);
  const hasApi =
    attributes.length ||
    decl.events.length ||
    decl._neutron.listens.length ||
    decl._neutron.commands.length ||
    decl._neutron.defaultActions.length ||
    decl.slots.length ||
    decl._neutron.expectedChildren.length ||
    decl.cssProperties.length ||
    decl._neutron.cssClasses.length ||
    decl._neutron.cssAliases.length ||
    decl._neutron.provisions.length;

  if (!hasApi) return;

  if (!skipOuterHeading) {
    lines.push(`${h(0)} API`, "");
  }
  if (attributes.length) {
    renderTable(
      lines,
      `${h(1)} Attributes`,
      ["Name", "Surface", "Type", "Default", "Values", "Description"],
      attributes,
      (a) => [
        `\`${a.name}\``,
        a.surface,
        typeCell(a.type),
        a.default !== undefined
          ? `\`${JSON.stringify(coerceDefault(a.default, typeTextRaw(a.type)))}\``
          : "",
        valuesText(a.values),
        a.description ?? "",
      ],
    );
  }
  if (decl._neutron.provisions.length) {
    renderTable(
      lines,
      `${h(1)} Provision`,
      ["Name", "Type", "Description"],
      decl._neutron.provisions,
      (p) => [`\`${p.name}\``, typeCell(p.type), p.description ?? ""],
    );
  }
  if (decl._neutron.expectedChildren.length) {
    renderTable(
      lines,
      `${h(1)} Recognized Elements`,
      ["Relationship", "Selector", "Required", "Description"],
      decl._neutron.expectedChildren,
      (c) => [
        `\`${c.selector}\``,
        c.relationship,
        c.required ? "yes" : "no",
        c.description ?? "",
      ],
    );
  }
  if (decl.slots.length) {
    renderTable(
      lines,
      `${h(1)} Slots`,
      ["Name", "Description"],
      decl.slots,
      (s) => [`\`${s.name}\``, s.description ?? ""],
    );
  }
  if (decl.events.length) {
    renderTable(
      lines,
      `${h(1)} Fires`,
      ["Name", "Type", "Description"],
      decl.events,
      (e) => [`\`${e.name}\``, typeCell(e.type), e.description ?? ""],
    );
  }
  if (decl._neutron.listens.length) {
    renderTable(
      lines,
      `${h(1)} Listens for`,
      ["Name", "Type", "Description"],
      decl._neutron.listens,
      (e) => [`\`${e.name}\``, typeCell(e.type), e.description ?? ""],
    );
  }
  if (decl._neutron.commands.length) {
    renderTable(
      lines,
      `${h(1)} Commands`,
      ["Command", "Action"],
      decl._neutron.commands,
      (c) => [`\`${c.name}\``, c.description ?? ""],
    );
  }
  if (decl._neutron.defaultActions.length) {
    renderTable(
      lines,
      `${h(1)} Default actions`,
      ["Event", "Default behavior (unless preventDefault() is called)"],
      decl._neutron.defaultActions,
      (e) => [`\`${e.name}\``, e.description ?? ""],
    );
  }
  if (decl.cssProperties.length) {
    renderTable(
      lines,
      `${h(1)} CSS Custom Properties`,
      ["Name", "Syntax", "Default", "Description"],
      decl.cssProperties,
      (c) => [
        `\`${c.name}\``,
        c.syntax ? `\`${c.syntax}\`` : "",
        c.default ? `\`${c.default}\`` : "",
        c.description ?? "",
      ],
    );
  }
  if (decl._neutron.cssClasses.length) {
    renderTable(
      lines,
      `${h(1)} CSS Classes`,
      ["Name", "Description"],
      decl._neutron.cssClasses,
      (c) => [`\`.${c.name}\``, c.description ?? ""],
    );
  }
  if (decl._neutron.cssAliases.length) {
    renderTable(
      lines,
      `${h(1)} CSS Aliases`,
      ["Alias", "Kind", "Matches", "Description"],
      decl._neutron.cssAliases,
      (a) => [
        `\`${a.name}\``,
        a.kind ?? "element",
        (a.selectors ?? []).map((s) => `\`${s}\``).join(", "),
        a.description ?? "",
      ],
    );
  }
}

/*
 * Tag each attribute with `surface` from the field's `_neutron.surface`
 * (older CEMs: readonly → state, else option). One Attributes table.
 */
function annotateAttributeSurfaces(decl) {
  const surfaceByField = new Map();
  for (const m of decl.members) {
    if (m.kind !== "field") continue;
    surfaceByField.set(
      m.name,
      m._neutron?.surface ?? (m.readonly ? "state" : "option"),
    );
  }
  return (decl.attributes ?? []).map((a) => ({
    ...a,
    surface: a.fieldName
      ? (surfaceByField.get(a.fieldName) ?? "option")
      : "option",
  }));
}

function renderTable(lines, heading, headers, rows, renderRow) {
  const anyInherited = rows.some((r) => r.inheritedFrom);
  const finalHeaders = anyInherited ? [...headers, "Inherited from"] : headers;
  lines.push(heading, "");
  lines.push(`| ${finalHeaders.join(" | ")} |`);
  lines.push(`| ${finalHeaders.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    const cells = renderRow(row);
    if (anyInherited) cells.push(inheritedCell(row.inheritedFrom));
    lines.push(`| ${cells.map((c) => escapeCell(c)).join(" | ")} |`);
  }
  lines.push("");
}

function escapeCell(v) {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function typeText(type) {
  if (!type) return "";
  if (typeof type === "string") return `\`${type}\``;
  if (type.text) return `\`${type.text}\``;
  return "";
}

/** Display name, plus expanded shape in parens when the CEM has one. */
function typeCell(type) {
  const name = typeText(type);
  if (!name) return "";
  const expanded = typeof type === "object" ? type.expanded : undefined;
  if (expanded) return `${name} (\`${expanded}\`)`;
  return name;
}

function typeTextRaw(type) {
  if (!type) return undefined;
  if (typeof type === "string") return type;
  return type.text;
}

function valuesText(values) {
  if (!values?.length) return "";
  // Plain `|` — `renderTable` runs `escapeCell`, so escaping here becomes `\\|`.
  return values.map((v) => `\`${formatValueToken(v)}\``).join(" | ");
}

/** Quote enum literals; leave freeform `@values` tokens as authored. */
function formatValueToken(v) {
  if (
    typeof v === "number" ||
    typeof v === "boolean" ||
    v === "" ||
    /^(true|false|-?\d+(?:\.\d+)?)$/.test(v) ||
    /^[\w.-]+$/.test(v)
  ) {
    return JSON.stringify(v);
  }
  return v;
}

/** Older CEMs stored number/boolean defaults as strings. */
function coerceDefault(value, type) {
  if (typeof value !== "string") return value;
  if (type === "number" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return value;
}

function inheritedCell(from) {
  return from ? `\`${from}\`` : "";
}
