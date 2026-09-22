/**
 * Regex type expansion for CEM. Same-file `type` / `interface` plus
 * workspace `@excom/*` packages. Does not run `tsc`.
 *
 * Stop rules: `LIB_TYPES`, `class` names (except a top-level `@type`
 * that extends `Event` / `CustomEvent`), non-workspace imports.
 * Indexed access `T["k"]` resolves only on `type` / `interface` objects.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const PRIMITIVE_TS = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "undefined",
  "null",
  "void",
  "never",
  "any",
  "unknown",
  "object",
  "true",
  "false",
  "tokenlist",
]);

const TS_KEYWORDS = new Set([
  ...PRIMITIVE_TS,
  "keyof",
  "typeof",
  "readonly",
  "infer",
  "extends",
  "in",
  "out",
  "as",
  "is",
  "asserts",
  "unique",
  "const",
  "new",
  "this",
  "interface",
  "type",
  "enum",
  "namespace",
  "module",
]);

/** DOM / lib identifiers we do not chase into node_modules. */
export const LIB_TYPES = new Set([
  "HTMLElement",
  "HTMLTemplateElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "ShadowRoot",
  "Window",
  "Event",
  "CustomEvent",
  "SubmitEvent",
  "MessageEvent",
  "EventListener",
  "Function",
  "Promise",
  "Array",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Date",
  "Error",
  "RegExp",
  "Object",
  "Boolean",
  "String",
  "Number",
  "RequestInit",
  "Request",
  "Response",
  "ResponseType",
  "Headers",
  "AbortSignal",
  "AbortController",
  "MutationRecord",
  "MutationObserver",
  "GeolocationPositionError",
  "GeolocationPosition",
  "DeviceOrientationEvent",
  "ViewTransition",
  "CloseWatcher",
  "ScrollBehavior",
  "NodeList",
  "DOMTokenList",
  "NodeListOf",
  "ReturnType",
  "InstanceType",
  "Partial",
  "Required",
  "Readonly",
  "Record",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "Parameters",
  "ConstructorParameters",
  "Awaited",
]);

const TYPE_EXPAND_MAX_DEPTH = 4;

const INDEXED_ACCESS_RE =
  /\b([A-Za-z_][A-Za-z0-9]*)((?:\s*\[\s*(["'])[^"']*\3\s*\])+)/g;

export function createTypeContext(src, { modulePath, packageRoot } = {}) {
  const filePath =
    packageRoot && modulePath ? path.resolve(packageRoot, modulePath) : "";
  const fileCache = new Map();
  if (filePath) fileCache.set(filePath, src);
  return {
    src,
    filePath,
    packageRoot: packageRoot || "",
    fileCache,
    declCache: new Map(),
  };
}

/**
 * Turns a raw `@type` / `ConstructorType` annotation into a CEM `type`
 * object: `{ text }` for primitives and lib identifiers; `{ text, expanded }`
 * when an alias expands to a richer shape.
 */
export function resolveTypeAnnotation(raw, ctx) {
  const expr = normalizeTypeRaw(raw);
  if (!expr) return undefined;
  if (expr.startsWith("{")) {
    return {
      text: "object",
      expanded: expandTypeExpr(expr, ctx, new Set(), 0, ctx.filePath, false),
    };
  }
  if (/^[A-Za-z_][A-Za-z0-9]*$/.test(expr)) {
    const mapped = primitiveTypeFor(expr);
    if (mapped) return { text: mapped };
    if (PRIMITIVE_TS.has(expr) || LIB_TYPES.has(expr)) return { text: expr };
    return cemTypeFromName(expr, ctx);
  }
  return cemTypeFromExpr(expr, ctx, undefined);
}

function primitiveTypeFor(name) {
  if (name === "String") return "string";
  if (name === "Number") return "number";
  if (name === "Boolean") return "boolean";
  return undefined;
}

function normalizeTypeRaw(raw) {
  const t = String(raw ?? "")
    .replace(/^\s*\*\s?/gm, "")
    .trim();
  if (!t) return undefined;
  if (t.startsWith("{")) {
    const close = findMatchingBrace(t, 0);
    if (close >= 0) return t.slice(0, close + 1);
  }
  return compactType(t.split(/\n(?=\s*@)/)[0]);
}

function cemTypeFromName(name, ctx) {
  const decl = lookupDecl(name, ctx, ctx.filePath);
  if (!decl) return { text: name };
  if (decl.kind === "class" && !isEventLike(decl)) return { text: name };
  const seen = new Set([name]);
  const expanded = formatDeclExpansion(decl, ctx, seen, 1);
  return cemTypePair(name, expanded);
}

function cemTypeFromExpr(expr, ctx, displayName) {
  const compact = compactType(expr);
  const seen = new Set(displayName ? [displayName] : []);
  const expanded = expandTypeExpr(
    compact,
    ctx,
    seen,
    displayName ? 1 : 0,
    ctx.filePath,
    false,
  );
  return cemTypePair(displayName ?? compact, expanded);
}

function cemTypePair(text, expanded) {
  if (expanded && expanded !== text && !isPrimitiveTypeText(expanded)) {
    return { text, expanded };
  }
  if (
    expanded &&
    expanded !== text &&
    isPrimitiveTypeText(expanded) &&
    text === expanded
  ) {
    return { text: expanded };
  }
  if (
    expanded &&
    expanded !== text &&
    isPrimitiveTypeText(expanded) &&
    !/^[A-Z]/.test(text)
  ) {
    return { text: expanded };
  }
  return { text };
}

function isPrimitiveTypeText(text) {
  if (!text) return false;
  return text.split(/\s*\|\s*/).every((part) => {
    const t = part.trim();
    return (
      PRIMITIVE_TS.has(t) ||
      /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(t)
    );
  });
}

function isEventLike(decl) {
  return (decl.heritage ?? []).some((h) => {
    const name = compactType(h).replace(/<.*$/, "");
    return name === "Event" || name === "CustomEvent";
  });
}

function isFunctionType(expr) {
  const c = compactType(expr);
  return /=>/.test(c) || /^\(/.test(c);
}

function formatDeclExpansion(decl, ctx, seen, depth) {
  const fromFile = decl.file;
  if (decl.kind === "type") {
    return expandTypeExpr(decl.rhs, ctx, seen, depth, fromFile, false);
  }
  if (decl.kind === "class") {
    if (!isEventLike(decl)) return decl.name;
    const fieldSrc = classFieldsAsObject(decl.body);
    const body = expandTypeExpr(
      fieldSrc,
      ctx,
      seen,
      depth,
      fromFile,
      true,
    );
    const heritages = (decl.heritage ?? []).map((h) =>
      expandTypeExpr(h, ctx, seen, depth, fromFile, false),
    );
    if (!heritages.length) return body;
    return compactType(`${heritages.join(" & ")} & ${body}`);
  }
  const keepNames = isEventLike(decl);
  const body = expandTypeExpr(
    decl.body,
    ctx,
    seen,
    depth,
    fromFile,
    keepNames,
  );
  const heritages = (decl.heritage ?? []).map((h) =>
    expandTypeExpr(h, ctx, seen, depth, fromFile, false),
  );
  if (!heritages.length) return body;
  return compactType(`${heritages.join(" & ")} & ${body}`);
}

function expandTypeExpr(expr, ctx, seen, depth, fromFile, keepNamedAliases) {
  if (!expr || depth >= TYPE_EXPAND_MAX_DEPTH) return compactType(expr);
  let out = compactType(expr);
  out = out.replace(INDEXED_ACCESS_RE, (full, name) => {
    if (TS_KEYWORDS.has(name) || LIB_TYPES.has(name) || seen.has(name)) {
      return full;
    }
    const decl = lookupDecl(name, ctx, fromFile);
    if (!decl || decl.kind === "class") return full;
    const keys = [
      ...full
        .slice(name.length)
        .matchAll(/\[\s*["']([^"']+)["']\s*\]/g),
    ].map((m) => m[1]);
    const propType = getIndexedType(decl, keys, ctx);
    if (!propType) return full;
    const next = new Set(seen);
    next.add(name);
    return expandTypeExpr(
      propType,
      ctx,
      next,
      depth + 1,
      decl.file,
      keepNamedAliases,
    );
  });
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9]*)\b/g, (id) => {
    if (TS_KEYWORDS.has(id) || LIB_TYPES.has(id) || seen.has(id)) return id;
    const decl = lookupDecl(id, ctx, fromFile);
    if (!decl) return id;
    if (decl.kind === "class") return id;
    if (keepNamedAliases && decl.kind === "type" && isFunctionType(decl.rhs)) {
      return id;
    }
    const next = new Set(seen);
    next.add(id);
    return formatDeclExpansion(decl, ctx, next, depth + 1);
  });
  return flattenIntersectedObjects(compactType(out));
}

/**
 * `TEvent & { type; detail }` → `CustomEvent & { type; detail; bubbles; … }`.
 * Author object fields (right) come first; earlier object fields fill the rest.
 */
function flattenIntersectedObjects(expr) {
  const parts = splitTopLevel(expr, "&")
    .map((p) => compactType(p))
    .filter(Boolean);
  if (parts.length < 2) return expr;
  const named = [];
  const objects = [];
  for (const part of parts) {
    if (part.startsWith("{")) objects.push(part);
    else named.push(part);
  }
  if (!objects.length) return expr;
  if (objects.length === 1) {
    return compactType([...named, objects[0]].join(" & "));
  }
  const fields = [];
  const seen = new Set();
  for (const obj of [...objects].reverse()) {
    for (const field of parseObjectFields(obj)) {
      if (seen.has(field.name)) continue;
      seen.add(field.name);
      fields.push(field);
    }
  }
  const merged = `{ ${fields.map((f) => `${f.name}: ${f.type}`).join("; ")} }`;
  return compactType([...named, merged].join(" & "));
}

function getIndexedType(decl, keys, ctx) {
  let current = decl;
  for (let i = 0; i < keys.length; i++) {
    if (!current || current.kind === "class") return undefined;
    const fields = parseObjectFields(objectBodyOf(current));
    const field = fields.find((f) => f.name === keys[i]);
    if (!field) return undefined;
    if (i === keys.length - 1) return field.type;
    const nextName = field.type.trim().match(/^[A-Za-z_][A-Za-z0-9]*$/);
    if (!nextName) return undefined;
    current = lookupDecl(nextName[0], ctx, current.file);
  }
  return undefined;
}

function objectBodyOf(decl) {
  if (decl.kind === "interface") return decl.body;
  if (decl.kind === "type") {
    const rhs = compactType(decl.rhs);
    if (rhs.startsWith("{")) return rhs;
  }
  return "";
}

function parseObjectFields(body) {
  if (!body) return [];
  const trimmed = compactType(body);
  if (!trimmed.startsWith("{")) return [];
  const close = findMatchingBrace(trimmed, 0);
  if (close < 0) return [];
  const inner = trimmed.slice(1, close).trim();
  const fields = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  let angle = 0;
  const flush = (end) => {
    const raw = inner.slice(start, end).trim();
    start = end + 1;
    if (!raw || raw.startsWith("...")) return;
    const m =
      /^((?:readonly\s+)?)(\[|[A-Za-z_][A-Za-z0-9]*)(?:\s*\??\s*:\s*)([\s\S]+)$/.exec(
        raw,
      );
    if (!m || m[2] === "[") return;
    fields.push({ name: m[2], type: compactType(m[3]) });
  };
  while (i < inner.length) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(inner, i);
      continue;
    }
    // `=>` is atomic, its `>` must not unbalance the angle counter.
    if (c === "=" && inner[i + 1] === ">") {
      i += 2;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if ((c === ";" || c === ",") && depth === 0 && angle === 0) {
      flush(i);
    }
    i++;
  }
  if (start < inner.length) flush(inner.length);
  return fields;
}

function classFieldsAsObject(body) {
  const fields = parseObjectFields(body || "{}");
  if (!fields.length) return "{}";
  return `{ ${fields.map((f) => `${f.name}: ${f.type}`).join("; ")} }`;
}

function lookupDecl(name, ctx, fromFile) {
  if (!name || !/^[A-Za-z_][A-Za-z0-9]*$/.test(name)) return undefined;
  const fileKey = fromFile || ":memory:";
  const cacheKey = `${fileKey}::${name}`;
  if (ctx.declCache.has(cacheKey)) return ctx.declCache.get(cacheKey);

  const src = fileSource(ctx, fromFile);
  ctx.declCache.set(cacheKey, null);
  let found = parseDeclInSource(name, src, fromFile || "");
  if (!found) {
    const imported = importSpecFor(name, src);
    if (imported) {
      const resolved = resolveImportFile(imported.spec, fromFile, ctx);
      if (resolved) found = lookupDecl(imported.exportName, ctx, resolved);
    }
  }
  if (!found) {
    found = lookupViaReexport(name, src, fromFile, ctx);
  }
  ctx.declCache.set(cacheKey, found ?? null);
  return found ?? undefined;
}

/** Follow `export { X } from` / `export * from` barrels (`@excom/neutron` → `src/types`). */
function lookupViaReexport(name, src, fromFile, ctx) {
  if (!src) return undefined;
  const named = exportNamedSpecFor(name, src);
  if (named) {
    const resolved = resolveImportFile(named.spec, fromFile, ctx);
    if (resolved) return lookupDecl(named.exportName, ctx, resolved);
  }
  for (const spec of exportStarSpecs(src)) {
    const resolved = resolveImportFile(spec, fromFile, ctx);
    if (!resolved) continue;
    const found = lookupDecl(name, ctx, resolved);
    if (found) return found;
  }
  return undefined;
}

function exportNamedSpecFor(name, src) {
  const exportRe =
    /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+(["'])([^"']+)\2/g;
  let m;
  while ((m = exportRe.exec(src)) !== null) {
    const [, named, , spec] = m;
    for (const raw of named.split(",")) {
      const bits = raw.trim().replace(/^type\s+/, "");
      if (!bits) continue;
      const parts = bits.split(/\s+as\s+/);
      const exported = parts[0].trim();
      const local = (parts[1] ?? parts[0]).trim();
      if (local === name) return { spec, exportName: exported };
    }
  }
  return undefined;
}

function exportStarSpecs(src) {
  const specs = [];
  const starRe = /export\s+(?:type\s+)?\*\s+from\s+(["'])([^"']+)\1/g;
  let m;
  while ((m = starRe.exec(src)) !== null) {
    specs.push(m[2]);
  }
  return specs;
}

function fileSource(ctx, fromFile) {
  if (!fromFile) return ctx.src;
  if (ctx.fileCache.has(fromFile)) return ctx.fileCache.get(fromFile);
  if (!existsSync(fromFile)) {
    ctx.fileCache.set(fromFile, "");
    return "";
  }
  const src = readFileSync(fromFile, "utf8");
  ctx.fileCache.set(fromFile, src);
  return src;
}

function parseDeclInSource(name, src, file) {
  if (!src) return undefined;
  const typeRe = new RegExp(
    `(?:^|[\\s;])(?:export\\s+)?type\\s+${name}\\s*=\\s*`,
    "m",
  );
  const tm = typeRe.exec(src);
  if (tm) {
    return {
      kind: "type",
      name,
      rhs: readTypeRhs(src, tm.index + tm[0].length),
      file,
    };
  }
  const ifaceRe = new RegExp(
    `(?:^|[\\s;])(?:export\\s+)?interface\\s+${name}\\b([^{]*)\\{`,
    "m",
  );
  const im = ifaceRe.exec(src);
  if (im) {
    const open = src.lastIndexOf("{", im.index + im[0].length - 1);
    const close = findMatchingBrace(src, open);
    if (close < 0) return undefined;
    return {
      kind: "interface",
      name,
      heritage: parseHeritage(im[1]),
      body: src.slice(open, close + 1),
      file,
    };
  }
  const classRe = new RegExp(
    `(?:^|[\\s;])(?:export\\s+)?(?:abstract\\s+)?class\\s+${name}\\b([^{]*)\\{`,
    "m",
  );
  const cm = classRe.exec(src);
  if (cm) {
    const open = src.lastIndexOf("{", cm.index + cm[0].length - 1);
    const close = findMatchingBrace(src, open);
    if (close < 0) return undefined;
    return {
      kind: "class",
      name,
      heritage: parseHeritage(cm[1]),
      body: src.slice(open, close + 1),
      file,
    };
  }
  return undefined;
}

function parseHeritage(raw) {
  const s = String(raw ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\bimplements\b[\s\S]*$/, "")
    .trim();
  const m = /^extends\s+(.+)$/.exec(s);
  if (!m) return [];
  return splitTopLevel(m[1], ",").map((p) => compactType(p)).filter(Boolean);
}

function splitTopLevel(src, sep) {
  const parts = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  let angle = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    // `=>` is atomic, its `>` must not unbalance the angle counter.
    if (c === "=" && src[i + 1] === ">") {
      i += 2;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === sep && depth === 0 && angle === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(src.slice(start));
  return parts;
}

function importSpecFor(name, src) {
  const importRe =
    /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+(["'])([^"']+)\3/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const [, named, def, , spec] = m;
    if (def === name) return { spec, exportName: name };
    if (!named) continue;
    for (const raw of named.split(",")) {
      const bits = raw.trim().replace(/^type\s+/, "");
      if (!bits) continue;
      const parts = bits.split(/\s+as\s+/);
      const exported = parts[0].trim();
      const local = (parts[1] ?? parts[0]).trim();
      if (local === name) return { spec, exportName: exported };
    }
  }
  return undefined;
}

function resolveImportFile(spec, fromFile, ctx) {
  if (!spec) return undefined;
  if (spec.startsWith(".")) {
    if (!fromFile) return undefined;
    return resolveTsFile(path.resolve(path.dirname(fromFile), spec));
  }
  const pkgMatch = spec.match(/^(@excom\/[^/]+)(?:\/(.*))?$/);
  if (!pkgMatch || !ctx.packageRoot) return undefined;
  const pkgName = pkgMatch[1];
  const subpath = pkgMatch[2];
  const nm = path.resolve(ctx.packageRoot, "node_modules", pkgName);
  if (!existsSync(nm)) return undefined;
  let pkgDir;
  try {
    pkgDir = realpathSync(nm);
  } catch {
    return undefined;
  }
  const packagesDir = path.resolve(ctx.packageRoot, "..");
  if (!pkgDir.startsWith(packagesDir + path.sep) && pkgDir !== packagesDir) {
    return undefined;
  }
  if (subpath) return resolveTsFile(path.join(pkgDir, subpath));
  return resolveWorkspaceEntry(pkgDir);
}

function resolveWorkspaceEntry(pkgDir) {
  const pkgPath = path.join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) return resolveTsFile(path.join(pkgDir, "index"));
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    pkg = {};
  }
  const short = String(pkg.name ?? "").replace(/^@[^/]+\//, "");
  const candidates = [
    pkg.types,
    pkg.typings,
    "index.ts",
    short ? `${short}.ts` : "",
    "src/index.ts",
    pkg.main,
  ].filter(Boolean);
  for (const rel of candidates) {
    const abs = path.resolve(pkgDir, rel);
    const ts = abs.endsWith(".d.ts")
      ? abs.replace(/\.d\.ts$/, ".ts")
      : abs.replace(/\.[cm]?js$/, ".ts");
    const hit = resolveTsFile(ts) ?? resolveTsFile(abs);
    if (hit) return hit;
  }
  return undefined;
}

function resolveTsFile(abs) {
  const candidates = [abs];
  if (!abs.endsWith(".ts") && !abs.endsWith(".js")) {
    candidates.push(`${abs}.ts`, path.join(abs, "index.ts"));
  }
  for (const c of candidates) {
    if (existsSync(c) && c.endsWith(".ts") && !c.endsWith(".d.ts")) return c;
  }
  return undefined;
}

function readTypeRhs(src, start) {
  let i = start;
  let depth = 0;
  let angle = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "=" && src[i + 1] === ">") {
      i += 2;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === ";" && depth === 0 && angle === 0) {
      return src.slice(start, i);
    }
    i++;
  }
  return src.slice(start);
}

export function compactType(s) {
  return String(s ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === "\\") j++;
    j++;
  }
  return j + 1;
}

export function findMatchingAngle(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "=" && src[i + 1] === ">") {
      i += 2;
      continue;
    }
    if (c === "<") depth++;
    else if (c === ">") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

export function findMatchingBrace(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}
