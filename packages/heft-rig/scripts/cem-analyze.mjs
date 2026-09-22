import {
  createTypeContext,
  findMatchingAngle,
  findMatchingBrace,
  resolveTypeAnnotation,
} from "./cem-types.mjs";

export { findMatchingAngle, findMatchingBrace };

/**
 * Neutron source → Custom Elements Manifest
 * (https://github.com/webcomponents/custom-elements-manifest) declaration.
 *
 * Output:
 *   - Registered element (`Neutron({ tag: "..." })` or
 *     `Neutron.compose([Base, Neutron({ tag: "..." })])`) →
 *     `{ kind: "class", customElement: true, tagName, ... }`
 *   - Composition base (`tag: "noop-tag"`) → `{ kind: "mixin" }`
 *     (never registered; don't document as an element)
 *
 * Inheritance is symbolic `mixins` only — no other package's CEM is
 * resolved here. Flattening is a render-time concern.
 *
 * Neutron tags CEM lacks (`@listens`, `@command`, `@default-action`,
 * `@child`, `@descendant`, `@provision`, stylesheet `@cssclass`) go on
 * `_neutron`.
 * CSS `@cssproperty` from `src/*.css` merges into `cssProperties` via
 * `build-cem.mjs`.
 *
 * Types: `@type` (props; also events after `@fires` / `@listens`) wins.
 * Else `ConstructorType<Name>` / aliases → `type.expanded` (`type.text`
 * stays the display name). Event `@type` is the event type (`FooEvent` or
 * `CustomEvent<Detail>`), not the detail. Workspace `@excom/*` `type` /
 * `interface` aliases expand; `class` names and lib types do not.
 * Primitives stay `{ text }`.
 *
 * Regex shim. Replacing with `@custom-elements-manifest/analyzer` later
 * would change only this file; the CEM shape is already spec-compatible.
 */

/**
 * @param {string} src - TypeScript source of the package's main module.
 * @param {object} opts
 * @param {string} opts.modulePath - Path to the module, relative to the
 *   package root. Embedded in the `path` and `module` fields of the CEM.
 * @param {string} [opts.packageRoot] - Absolute package directory. Enables
 *   workspace `@excom/*` type expansion.
 * @param {(identifier: string) => { package: string } | undefined} opts.resolveImport
 *   - Looks up where an identifier used in `Neutron.compose([...])` was
 *     imported from. Return `{ package: "@excom/foo" }` or
 *     `undefined` if we can't tell.
 * @returns {object | undefined} The CEM document, or undefined if the
 *   source doesn't define a Neutron element.
 */
export function analyzeSource(src, { modulePath, resolveImport, packageRoot }) {
  const typeCtx = createTypeContext(src, { modulePath, packageRoot });
  const def = findElementDefinition(src);
  if (!def) return undefined;

  const tag = def.tag;
  const isMixin = tag === "noop-tag";

  const declaration = {
    kind: isMixin ? "mixin" : "class",
    name: def.exportName ?? defaultExportName(modulePath),
  };

  if (!isMixin) {
    declaration.customElement = true;
    declaration.tagName = tag;
  }

  const mixins = def.composedBases
    .map((identifier) => {
      const ref = resolveImport?.(identifier);
      if (!ref) return null;
      return { name: identifier, package: ref.package };
    })
    .filter(Boolean);
  if (mixins.length) declaration.mixins = mixins;

  const jsdocTags = collectJsDocTags(typeCtx);

  if (jsdocTags.summary) declaration.summary = jsdocTags.summary;
  if (jsdocTags.description) declaration.description = jsdocTags.description;

  const { attributes, members, provisions } = extractInlineSurface(
    def.propsBody,
    typeCtx,
  );
  if (attributes.length) declaration.attributes = attributes;
  if (members.length) declaration.members = members;

  if (jsdocTags.events.length) declaration.events = jsdocTags.events;
  if (jsdocTags.slots.length) declaration.slots = jsdocTags.slots;
  if (jsdocTags.cssProperties.length) {
    declaration.cssProperties = jsdocTags.cssProperties;
  }

  const neutronExt = {};
  if (provisions.length) neutronExt.provisions = provisions;
  if (jsdocTags.listens.length) neutronExt.listens = jsdocTags.listens;
  if (jsdocTags.commands.length) neutronExt.commands = jsdocTags.commands;
  if (jsdocTags.defaultActions.length) {
    neutronExt.defaultActions = jsdocTags.defaultActions;
  }
  if (jsdocTags.expectedChildren.length) neutronExt.expectedChildren = jsdocTags.expectedChildren;
  if (Object.keys(neutronExt).length) declaration._neutron = neutronExt;

  const moduleEntry = {
    kind: "javascript-module",
    path: modulePath,
    declarations: [declaration],
    exports: [
      {
        kind: "js",
        name: declaration.name,
        declaration: { name: declaration.name, module: modulePath },
      },
    ],
  };
  if (!isMixin) {
    moduleEntry.exports.push({
      kind: "custom-element-definition",
      name: tag,
      declaration: { name: declaration.name, module: modulePath },
    });
  }

  return {
    schemaVersion: "1.0.0",
    modules: [moduleEntry],
  };
}

/*
 * --- Neutron element detection ------------------------------------------
 *
 * Three shapes:
 *   1. `export const Foo = Neutron({ tag, props })`
 *   2. `export const Foo = Neutron.compose([Base, Neutron({ tag, props })])`
 *   3. `export const Foo = Neutron.compose([A, B, Neutron({ tag, props })])`
 *      plus `.defineMethods(...)` / `.onEvent(...)` — chaining ignored;
 *      only the top-level assignment matters.
 */

function findElementDefinition(src) {
  const innerCall = findInnerNeutronCall(src);
  if (!innerCall) return undefined;

  const tag = extractTagFromPropsObject(innerCall.objectSource);
  if (!tag) return undefined;

  const propsBody = findPropsBody(innerCall.objectSource);

  const exportName = findExportNameBefore(src, innerCall.exportStatementStart);

  const composedBases = findComposedBases(src, innerCall);

  return {
    tag,
    propsBody: propsBody ?? "",
    exportName,
    composedBases,
  };
}

// Inner `Neutron({ tag: ..., props: ... })` in a composition: object-literal
// span plus enclosing `export const Foo = ...` start, if any.
function findInnerNeutronCall(src) {
  const re = /Neutron\s*\(\s*(\{)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBrace(src, openIdx);
    if (closeIdx < 0) continue;
    const objectSource = src.slice(openIdx, closeIdx + 1);
    if (!/\btag\s*:/.test(objectSource)) continue;

    const exportStatementStart = findExportStatementStart(src, m.index);
    return { objectSource, exportStatementStart, neutronCallStart: m.index };
  }
  return undefined;
}

function findExportStatementStart(src, neutronIdx) {
  const head = src.slice(0, neutronIdx);
  const m = /export\s+const\s+\w+\s*=\s*(?:[\s\S]*?)$/.exec(head);
  return m ? m.index : neutronIdx;
}

function findExportNameBefore(src, statementStart) {
  const slice = src.slice(statementStart);
  const m = /export\s+const\s+(\w+)\s*=/.exec(slice);
  return m?.[1];
}

function extractTagFromPropsObject(objectSource) {
  const m = /\btag\s*:\s*(["'`])([^"'`]+)\1/.exec(objectSource);
  return m?.[2];
}

// Identifiers before the inner `Neutron({...})` in `Neutron.compose([...])`.
function findComposedBases(src, innerCall) {
  const head = src.slice(0, innerCall.neutronCallStart);
  const m = /Neutron\s*\.\s*compose\s*\(\s*\[\s*$/.exec(head.replace(/\s+$/, "") + " ")
    // fallback: search for `.compose([` preceding the inner call
    ?? null;

  // `.exec` above won't anchor across newlines; find `Neutron.compose([`
  // by searching back instead.
  const composeIdx = head.lastIndexOf(".compose");
  if (composeIdx < 0) return [];
  const openBracketIdx = head.indexOf("[", composeIdx);
  if (openBracketIdx < 0) return [];

  const between = src.slice(openBracketIdx + 1, innerCall.neutronCallStart);

  // Comma-separated identifiers; strip comments/whitespace, then split.
  // The inner Neutron call is not in `between`.
  const cleaned = stripCommentsAndStrings(between)
    .replace(/,\s*$/, "")
    .trim();
  if (!cleaned) return [];

  return cleaned
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\w[\w$]*$/.test(s));
}

function stripCommentsAndStrings(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

// --- Props / inline attribute extraction --------------------------------

function findPropsBody(objectSource) {
  const propsIdx = objectSource.search(/\bprops\s*:\s*\{/);
  if (propsIdx < 0) return null;
  const openIdx = objectSource.indexOf("{", propsIdx);
  const closeIdx = findMatchingBrace(objectSource, openIdx);
  if (closeIdx < 0) return null;
  return objectSource.slice(openIdx + 1, closeIdx);
}

function primitiveTypeFor(name) {
  switch (name) {
    case "Boolean":
      return "boolean";
    case "String":
      return "string";
    case "Number":
      return "number";
    case "TokenList":
      return "tokenlist";
    default:
      return null;
  }
}

/*
 * Inline prop JSDoc → CEM `attributes[]` + `members[]`. `@option` / `@state`
 * (or both → hybrid) set `_neutron.surface`; only pure state is `readonly`.
 * Same description on both so `members[]`-only consumers still see it.
 */
function extractInlineSurface(propsBody, ctx) {
  if (!propsBody) return { attributes: [], members: [], provisions: [] };
  const attributes = [];
  const members = [];
  const provisions = [];
  for (const entry of parsePropsEntries(propsBody)) {
    const built = entryToSurface(entry, ctx);
    if (!built) continue;
    members.push(built.field);
    if (built.provision) provisions.push(built.provision);
    else attributes.push(built.attribute);
  }
  return { attributes, members, provisions };
}

function parsePropsEntries(body) {
  const entries = [];
  let i = 0;
  let pendingComment = null;

  while (i < body.length) {
    const c = body[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && body[i + 1] === "*" && body[i + 2] === "*") {
      const end = body.indexOf("*/", i);
      if (end < 0) break;
      pendingComment = body.slice(i + 3, end);
      i = end + 2;
      continue;
    }
    if (c === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i);
      i = end < 0 ? body.length : end + 2;
      continue;
    }
    if (c === "/" && body[i + 1] === "/") {
      const end = body.indexOf("\n", i);
      i = end < 0 ? body.length : end + 1;
      continue;
    }
    const nameMatch = /^(\w+)/.exec(body.slice(i));
    if (nameMatch) {
      const name = nameMatch[1];
      i += name.length;
      while (i < body.length && /\s/.test(body[i])) i++;
      if (body[i] !== ":") {
        pendingComment = null;
        continue;
      }
      i++;
      const valueStart = i;
      let depth = 0;
      while (i < body.length) {
        const ch = body[i];
        // Treat `=>` as one token so `>` does not close a bracket and
        // swallow later props.
        if (ch === "=" && body[i + 1] === ">") {
          i += 2;
          continue;
        }
        // Skip strings at any depth — a `>` in `":scope > template"` would
        // flip depth and drop every later prop.
        if (ch === '"' || ch === "'" || ch === "`") {
          let j = i + 1;
          while (j < body.length && body[j] !== ch) {
            if (body[j] === "\\") j++;
            j++;
          }
          i = j + 1;
          continue;
        }
        if (ch === "{" || ch === "[" || ch === "(" || ch === "<") depth++;
        else if (ch === "}" || ch === "]" || ch === ")" || ch === ">") depth--;
        else if (ch === "," && depth === 0) break;
        i++;
      }
      entries.push({
        name,
        value: body.slice(valueStart, i).trim(),
        comment: pendingComment,
      });
      pendingComment = null;
      if (body[i] === ",") i++;
      continue;
    }
    i++;
  }
  return entries;
}

function entryToSurface(entry, ctx) {
  if (!entry.comment) return null;
  if (entry.name.startsWith("_")) return null;

  const value = entry.value;
  if (/^\{/.test(value) && /\battr\s*:\s*false\b/.test(value)) return null;

  /*
   * `@option` / `@state` (or both → hybrid) set surface; tags stripped
   * from the description.
   *   option — writable config
   *   state  — read-only, element-managed
   *   hybrid — writable and live state (CSS / Quark)
   */
  const hasOption = /(^|\n)\s*\*?\s*@option\b/.test(entry.comment);
  const hasState = /(^|\n)\s*\*?\s*@state\b/.test(entry.comment);
  const hasProvision = /(^|\n)\s*\*?\s*@provision\b/.test(entry.comment);
  const surface =
    hasOption && hasState ? "hybrid" : hasState ? "state" : "option";

  const type = resolvePropType(entry, ctx);
  if (!type) return null;

  const description = cleanJsDocBody(stripKindTags(entry.comment));
  // Manual `@values` / `@default` beat `isValid: […].includes(…)` / `defaultValue: () => …`.
  const values =
    extractJsDocValues(entry.comment) ?? extractEnumValues(value);
  const defaultValue =
    extractJsDocDefault(entry.comment) ?? extractDefaultValue(value);

  const attribute = {
    name: camelToKebab(entry.name),
    type,
    description,
    fieldName: entry.name,
  };
  if (defaultValue !== undefined) attribute.default = defaultValue;
  // Enumerated values (not first-class CEM yet; see #51). Docs/tooling
  // use this for a Values column.
  if (values?.length) attribute.values = values;

  return {
    ...(hasProvision
      ? {
          provision: {
            name: entry.name,
            type,
            description,
            fieldName: entry.name,
            ...(defaultValue !== undefined ? { default: defaultValue } : {}),
          },
        }
      : { attribute }),
    field: {
      kind: "field",
      name: entry.name,
      type,
      privacy: "public",
      // Only pure state is readonly in CEM; hybrid stays assignable.
      readonly: surface === "state",
      description,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      _neutron: { surface },
    },
  };
}

/**
 * Prop type: `@type` > `ConstructorType<…>` / alias > widened constructor
 * (`Boolean` → `boolean`, `Object` → `object`). Richer aliases go on
 * `type.expanded`.
 */
function resolvePropType(entry, ctx) {
  const jsdocRaw = extractJsDocType(entry.comment);
  if (jsdocRaw) {
    const t = resolveTypeAnnotation(jsdocRaw, ctx);
    if (t) return t;
  }
  const ctorArg = extractConstructorTypeArg(entry.value);
  if (ctorArg) {
    const t = resolveTypeAnnotation(ctorArg, ctx);
    if (t) return t;
  }
  let typeName = null;
  const value = entry.value;
  if (/^\{/.test(value)) {
    const typeMatch = /\btype\s*:\s*(\w+)/.exec(value);
    if (typeMatch) typeName = typeMatch[1];
  } else {
    const m = /^(\w+)/.exec(value);
    if (m) typeName = m[1];
  }
  if (!typeName) return { text: "object" };
  const mapped = primitiveTypeFor(typeName);
  if (mapped) return { text: mapped };
  if (typeName === "Object") return { text: "object" };
  return { text: typeName };
}

/** `@type Name` or `@type { … }` on a prop JSDoc. Manual always wins. */
function extractJsDocType(comment) {
  const re = /(?:^|\n)\s*\*?\s*@type\b[ \t]*/;
  const m = re.exec(comment);
  if (!m) return undefined;
  return comment.slice(m.index + m[0].length);
}

/**
 * Generic arg of `ConstructorType<Name>` / `as ConstructorType<Name>`
 * (union or inline object ok).
 */
function extractConstructorTypeArg(value) {
  const idx = value.search(/ConstructorType\s*</);
  if (idx < 0) return undefined;
  const open = value.indexOf("<", idx);
  const close = findMatchingAngle(value, open);
  if (close < 0) return undefined;
  return value.slice(open + 1, close).trim();
}

/**
 * Literal from `defaultValue: () => …` (simple arrow bodies only).
 */
function extractDefaultValue(propValue) {
  const m =
    /\bdefaultValue\s*:\s*\(\s*\)\s*=>\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|-?\d+(?:\.\d+)?|true|false)/.exec(
      propValue,
    );
  if (!m) return undefined;
  return parseLiteral(m[1]);
}

/**
 * Array in `.includes(...)` on an `isValid` arrow:
 *   isValid: (v) => ["", "eager", "idle", "lazy"].includes(v)
 */
function extractEnumValues(propValue) {
  const isValidIdx = propValue.search(/\bisValid\s*:/);
  if (isValidIdx < 0) return undefined;
  const slice = propValue.slice(isValidIdx);
  const m =
    /\[\s*((?:(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|-?\d+(?:\.\d+)?|true|false)\s*,\s*)*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|-?\d+(?:\.\d+)?|true|false))\s*\]\s*\.includes/.exec(
      slice,
    );
  if (!m) return undefined;
  return m[1].split(",").map((part) => parseLiteral(part.trim()));
}

/**
 * JS literal → JSON-typed value so CEM `default` / `values` keep
 * number/boolean identity (`JSON.stringify(0)` stays `0`, not `"0"`).
 */
function parseLiteral(raw) {
  const q = raw[0];
  if (q === '"' || q === "'" || q === "`") {
    return raw
      .slice(1, -1)
      .replace(/\\([\\'"`nrt])/g, (_, ch) =>
        ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch,
      );
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * `@values <token> | <token> | …` for the Values column. Quotes stripped.
 */
function extractJsDocValues(comment) {
  const rest = extractJsDocTagRest(comment, "values");
  if (rest === undefined) return undefined;
  const parts = rest
    .split("|")
    .map((p) => {
      const t = p.trim();
      if (!t) return undefined;
      const q = t[0];
      if (
        (q === '"' || q === "'" || q === "`") &&
        t.length >= 2 &&
        t[t.length - 1] === q
      ) {
        return parseLiteral(t);
      }
      return t;
    })
    .filter((p) => p !== undefined);
  return parts.length ? parts : undefined;
}

/** `@default <value>`, rest of the line (quotes stripped when present). */
function extractJsDocDefault(comment) {
  // `(?!-)` so `@default-action` is not treated as `@default`.
  const rest = extractJsDocTagRest(comment, "default(?!-)");
  if (rest === undefined || rest === "") return undefined;
  return parseLiteral(rest);
}

function extractJsDocTagRest(comment, tagPattern) {
  const re = new RegExp(
    `(?:^|\\n)\\s*\\*?\\s*@${tagPattern}\\b[ \\t]*([^\\n]*)`,
  );
  const m = re.exec(comment);
  if (!m) return undefined;
  return m[1].trim();
}

function stripKindTags(comment) {
  // `(?!-)` keeps `@default-action` out of the `@default` strip.
  return comment.replace(
    /^[ \t]*\*?[ \t]*@(?:option|state|provision|values|default(?!-)|type)\b[^\n]*\n?/gm,
    "",
  );
}

/*
 * --- JSDoc tag collection -----------------------------------------------
 *
 * Every JSDoc block in the file; recognized @-tags contribute.
 * `@summary` from the first block that has one. Unknown tags ignored.
 */

function collectJsDocTags(ctx) {
  const result = {
    summary: undefined,
    description: undefined,
    events: [],
    listens: [],
    commands: [],
    defaultActions: [],
    slots: [],
    cssProperties: [],
    expectedChildren: [],
  };

  for (const body of findAllJsDocBodies(ctx.src)) {
    // `@type` binds the preceding `@fires` / `@listens` / `@default-action`
    // in *this* block only — prop `@type` must not leak onto a class event.
    result._lastTyped = undefined;
    if (!result.summary) {
      const s = /@summary\s+([^\n]+)/.exec(body);
      if (s) result.summary = s[1].trim();
    }
    if (!result.description) {
      const maybe = extractLeadingDescription(body);
      if (maybe) result.description = maybe;
    }
    for (const block of splitByAt(body)) {
      consumeTagBlock(block, result, ctx);
    }
  }
  delete result._lastTyped;
  return result;
}

function extractLeadingDescription(body) {
  const beforeFirstTag = body.split(/\n(?=@\w+)/)[0];
  const trimmed = beforeFirstTag
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // Description only if it's a real sentence (has a letter); skip one-word prop docs.
  if (trimmed.length >= 20 && /[A-Za-z]/.test(trimmed) && !/^@/.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function consumeTagBlock(block, api, ctx) {
  if (/^@type\b/.test(block)) {
    const last = api._lastTyped;
    if (!last) return;
    const cemType = resolveTypeAnnotation(block.replace(/^@type\b/, ""), ctx);
    if (cemType) last.type = cemType;
    return;
  }
  const m =
    /^@(default-action|fires|listens|command|slot|cssprop|child|descendant)\b(.*)$/s.exec(
      block,
    );
  if (!m) return;
  const [, kind, rest] = m;
  const collapsed = rest.replace(/\s+/g, " ").trim();
  if (kind === "command") {
    // `@command --verb - desc`: a custom command the element handles (`onCommand`)
    const cm = /^(--\S+)\s*-?\s*(.*)$/.exec(collapsed);
    if (cm) api.commands.push({ name: cm[1], description: cm[2] || "" });
  } else if (kind === "fires" || kind === "listens" || kind === "default-action") {
    const em = /^([^\s]+)\s*-?\s*(.*)$/.exec(collapsed);
    if (em) {
      const bucket =
        kind === "fires"
          ? api.events
          : kind === "listens"
            ? api.listens
            : api.defaultActions;
      const entry = { name: em[1], description: em[2] || "" };
      bucket.push(entry);
      api._lastTyped = entry;
    }
  } else if (kind === "slot") {
    const sm = /^([^\s]+)\s*-?\s*(.*)$/.exec(collapsed);
    if (sm) api.slots.push({ name: sm[1], description: sm[2] || "" });
  } else if (kind === "cssprop") {
    const cm = /^([^\s]+)\s*-?\s*(.*)$/.exec(collapsed);
    if (cm) api.cssProperties.push({ name: cm[1], description: cm[2] || "" });
  } else if (kind === "child" || kind === "descendant") {
    /*
     * @child <selector> - desc      required immediate child
     * @child ?<selector> - desc     optional
     * @descendant <selector> / @descendant ?<selector> - desc
     * Leading `?` = optional (no CSS selector starts with `?`).
     */
    const ldm = /^(\?)?(\S+)\s*-?\s*(.*)$/.exec(collapsed);
    if (ldm) {
      api.expectedChildren.push({
        relationship: kind,
        selector: ldm[2],
        required: !ldm[1],
        description: ldm[3] || "",
      });
    }
  }
}

function findAllJsDocBodies(src) {
  const bodies = [];
  const re = /\/\*\*([\s\S]*?)\*\//g;
  let m;
  while ((m = re.exec(src)) !== null) {
    bodies.push(
      m[1]
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, ""))
        .join("\n"),
    );
  }
  return bodies;
}

function splitByAt(body) {
  const blocks = [];
  let current = "";
  for (const line of body.split("\n")) {
    if (/^@\w+/.test(line)) {
      if (current) blocks.push(current.trim());
      current = line;
    } else if (current) {
      current += "\n" + line;
    }
  }
  if (current) blocks.push(current.trim());
  return blocks;
}

// --- Shared utilities ---------------------------------------------------

function camelToKebab(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function cleanJsDocBody(raw) {
  return raw
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultExportName(modulePath) {
  const base = modulePath
    .replace(/\.[cm]?[jt]sx?$/, "")
    .split("/")
    .pop();
  return base
    .split(/[^A-Za-z0-9]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

// --- Import resolution helpers (used by the CLI) ------------------------

/**
 * `resolveImport(identifier)` from top-level `import`s. Only `@excom/*`;
 * other packages are opaque.
 */
export function makeImportResolver(src) {
  const importMap = new Map();
  const importRe = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+(["'])(@excom\/[^"']+)\3/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const [, named, def, , pkg] = m;
    if (named) {
      for (const raw of named.split(",")) {
        const id = raw.trim().split(/\s+as\s+/).pop();
        if (id) importMap.set(id, { package: pkg });
      }
    } else if (def) {
      importMap.set(def, { package: pkg });
    }
  }
  return (identifier) => importMap.get(identifier);
}
