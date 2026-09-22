/**
 * Flatten a Custom Elements Manifest into render-friendly element API
 * objects. Mixin composition is resolved through a caller-supplied
 * `resolveMixinCem` lookup. Entries contributed by a mixin carry
 * `inheritedFrom` set to the contributing package identifier.
 */

export function firstDeclaration(cem) {
  return cem?.modules?.[0]?.declarations?.[0];
}

export function allDeclarations(cem) {
  const out = [];
  for (const mod of cem?.modules ?? []) {
    for (const d of mod.declarations ?? []) out.push(d);
  }
  return out;
}

export function flattenCem(cem, resolveMixinCem) {
  return allDeclarations(cem).map((decl) => toFlatApi(decl, resolveMixinCem));
}

function toFlatApi(decl, resolveMixinCem) {
  const api = blankApi(decl);
  mergeFromDeclaration(api, decl, api.tag);
  for (const ref of decl.mixins ?? []) {
    if (!ref.package) continue;
    const mixin = firstDeclaration(resolveMixinCem(ref.package));
    if (!mixin) continue;
    mergeTransitive(
      api,
      mixin,
      ref.package,
      new Set([ref.package]),
      resolveMixinCem,
    );
  }
  attachDefaultActions(api);
  sortApiCollections(api);
  return api;
}

function blankApi(decl) {
  return {
    tag: decl.tagName,
    summary: decl.summary,
    kind: decl.kind,
    attributes: [],
    events: [],
    slots: [],
    cssProperties: [],
    cssClasses: [],
    cssAliases: [],
    listens: [],
    commands: [],
    defaultActions: [],
    expectedChildren: [],
    provisions: [],
  };
}

function mergeFromDeclaration(api, decl, tagForPlaceholder) {
  const tag = resolveTagForPlaceholder(tagForPlaceholder ?? api.tag, decl);
  const surfaceByField = new Map();
  for (const m of decl.members ?? []) {
    if (m.kind !== "field") continue;
    surfaceByField.set(
      m.name,
      m._neutron?.surface ?? (m.readonly ? "state" : "option"),
    );
  }
  for (const a of decl.attributes ?? []) {
    const surface = a.fieldName
      ? (surfaceByField.get(a.fieldName) ?? "option")
      : "option";
    const entry = {
      name: a.name,
      ...flattenType(a.type),
      description: a.description ?? "",
      fieldName: a.fieldName,
      surface,
    };
    if (a.default !== undefined) {
      entry.default = JSON.stringify(coerceDefault(a.default, a.type?.text));
    }
    if (a.values?.length) {
      entry.values = a.values.map(formatValueToken).join(" | ");
    }
    api.attributes.push(entry);
  }
  for (const e of decl.events ?? []) {
    api.events.push({
      name: applyTagPlaceholder(e.name, tag),
      description: applyTagPlaceholder(e.description ?? "", tag),
      ...flattenType(e.type),
    });
  }
  for (const s of decl.slots ?? []) {
    api.slots.push({ name: s.name, description: s.description ?? "" });
  }
  for (const c of decl.cssProperties ?? []) {
    api.cssProperties.push({
      name: c.name,
      description: c.description ?? "",
      syntax: c.syntax,
      default: c.default,
    });
  }
  for (const c of decl._neutron?.cssClasses ?? []) {
    api.cssClasses.push({ name: c.name, description: c.description ?? "" });
  }
  for (const a of decl._neutron?.cssAliases ?? []) {
    api.cssAliases.push({
      name: a.name,
      selectors: a.selectors ?? [],
      kind: a.kind ?? "element",
      description: a.description ?? "",
    });
  }
  for (const l of decl._neutron?.listens ?? []) {
    api.listens.push({
      name: applyTagPlaceholder(l.name, tag),
      description: applyTagPlaceholder(l.description ?? "", tag),
      ...flattenType(l.type),
    });
  }
  for (const c of decl._neutron?.commands ?? []) {
    api.commands.push({
      name: c.name,
      description: applyTagPlaceholder(c.description ?? "", tag),
    });
  }
  for (const d of decl._neutron?.defaultActions ?? []) {
    api.defaultActions.push({
      name: applyTagPlaceholder(d.name, tag),
      description: applyTagPlaceholder(d.description ?? "", tag),
    });
  }
  for (const ld of decl._neutron?.expectedChildren ?? []) {
    api.expectedChildren.push({
      name: `${ld.relationship}:${ld.selector}`,
      relationship: ld.relationship,
      selector: ld.selector,
      required: ld.required,
      description: ld.description ?? "",
    });
  }
  for (const p of decl._neutron?.provisions ?? []) {
    const entry = {
      name: p.name,
      ...flattenType(p.type),
      description: p.description ?? "",
      fieldName: p.fieldName,
    };
    if (p.default !== undefined) {
      entry.default = JSON.stringify(coerceDefault(p.default, p.type?.text));
    }
    api.provisions.push(entry);
  }
}

/**
 * CEM `type` is `{ text, expanded? }`. Flatten to `type` (display name)
 * plus `typeExpanded` (object shape / alias body) so the docs UI can bind
 * both without walking nested objects.
 */
function flattenType(type) {
  if (!type) return {};
  const text = typeof type === "string" ? type : type.text;
  const expanded = typeof type === "object" ? type.expanded : undefined;
  const out = {};
  if (text) out.type = text;
  if (expanded) out.typeExpanded = expanded;
  return out;
}

function resolveTagForPlaceholder(preferred, decl) {
  if (preferred && preferred !== "noop-tag") return preferred;
  if (decl.tagName && decl.tagName !== "noop-tag") return decl.tagName;
  return preferred;
}

function applyTagPlaceholder(text, tag) {
  if (!tag || tag === "noop-tag") return text;
  return text.replaceAll("{tag}", tag);
}

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
  return String(v);
}

function coerceDefault(value, type) {
  if (typeof value !== "string") return value;
  if (type === "number" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return value;
}

function attachDefaultActions(api) {
  if (!api.defaultActions.length) return;
  const byName = new Map(api.defaultActions.map((d) => [d.name, d.description]));
  for (const e of api.events) {
    const action = byName.get(e.name);
    if (action) e.defaultAction = action;
  }
}

const SURFACE_ORDER = { option: 0, hybrid: 1, state: 2 };

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

function sortApiCollections(api) {
  api.attributes.sort(
    (a, b) =>
      SURFACE_ORDER[a.surface] - SURFACE_ORDER[b.surface] || byName(a, b),
  );
  api.events.sort(byName);
  api.slots.sort(byName);
  api.cssProperties.sort(byName);
  api.cssClasses.sort(byName);
  api.cssAliases.sort(byName);
  api.listens.sort(byName);
  api.commands.sort(byName);
  api.defaultActions.sort(byName);
  api.expectedChildren.sort(byName);
  api.provisions.sort(byName);
}

function mergeTransitive(api, decl, fromPackage, seen, resolveMixinCem) {
  const before = snapshot(api);
  mergeFromDeclaration(api, decl, api.tag);
  tagInherited(api, before, fromPackage);

  for (const ref of decl.mixins ?? []) {
    if (!ref.package || seen.has(ref.package)) continue;
    const next = new Set(seen).add(ref.package);
    const nested = firstDeclaration(resolveMixinCem(ref.package));
    if (!nested) continue;
    mergeTransitive(api, nested, ref.package, next, resolveMixinCem);
  }
}

const COUNTED_KEYS = [
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

function snapshot(api) {
  return Object.fromEntries(COUNTED_KEYS.map((key) => [key, api[key].length]));
}

function tagInherited(api, before, fromPackage) {
  for (const key of COUNTED_KEYS) {
    const arr = api[key];
    for (let i = before[key]; i < arr.length; i++) {
      if (!arr[i].inheritedFrom) arr[i].inheritedFrom = fromPackage;
    }
  }
}
