/**
 * Parse a package stylesheet for Custom Elements Manifest documentation.
 *
 * Document CSS custom properties and host classes with JSDoc-style blocks
 * immediately above the declaration / selector:
 *
 *   /**
 *    * Accent color for the control chrome.
 *    * @cssproperty
 *    * @syntax <color>
 *    * @default var(--v-primary, blue)
 *    *\/
 *   --super-input-primary: var(--v-primary, blue);
 *
 *   /**
 *    * Floating-label / raised-border appearance.
 *    * @cssclass
 *    *\/
 *   &.raised { … }
 *
 * `@custom-selector` rules are parsed automatically into `cssAliases`
 * (optional `@cssalias` JSDoc above the rule adds a description):
 *
 *   /**
 *    * Host alias — style without registering the element.
 *    * @cssalias
 *    *\/
 *   @custom-selector :--content-drawer content-drawer, .tag-content-drawer;
 *
 * Recognized tags:
 *   @cssproperty / @cssprop  — public CSS custom property (CEM `cssProperties`)
 *   @cssclass                — host/utility class (emitted under `_neutron.cssClasses`;
 *                              CEM has no first-class field for CSS classes)
 *   @cssalias                — optional description for a following `@custom-selector`
 *   @syntax                  — CSS Properties and Values API syntax string
 *   @default                 — default value (falls back to the declaration value)
 *   @summary                 — short listing summary
 *   @internal / @ignore      — omit from the manifest
 *   @element <tag>           — bind this stylesheet to a tag (file-level or once)
 *
 * Property / class names may be given on the tag (`@cssproperty --foo`) or
 * inferred from the following `--foo:` / `.foo` / `&.foo` construct.
 *
 * Alias kinds follow the Valence.css convention:
 *   `:--{element}`              → kind `"element"`
 *   `:--{element}--{state}`     → kind `"state"`
 */

/**
 * @param {string} src
 * @returns {{
 *   element?: string,
 *   cssProperties: Array<{
 *     name: string,
 *     description?: string,
 *     summary?: string,
 *     syntax?: string,
 *     default?: string,
 *   }>,
 *   cssClasses: Array<{
 *     name: string,
 *     description?: string,
 *     summary?: string,
 *   }>,
 *   cssAliases: Array<{
 *     name: string,
 *     selectors: string[],
 *     kind: "element" | "state",
 *     description?: string,
 *     summary?: string,
 *   }>,
 * }}
 */
export function analyzeCss(src) {
  const cssProperties = [];
  const cssClasses = [];
  const cssAliases = [];
  let element;

  const re = /\/\*\*([\s\S]*?)\*\//g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = stripStars(m[1]);
    const tags = parseTags(body);
    const description = leadingDescription(body);

    if (tags.element && !element) element = tags.element;

    if (tags.internal) continue;

    const after = src.slice(m.index + m[0].length);
    const nextDecl = peekNextConstruct(after);

    if (tags.cssproperty) {
      const name =
        tags.csspropertyName ||
        (nextDecl?.kind === "custom-property" ? nextDecl.name : null);
      if (!name) continue;
      const entry = {
        name: name.startsWith("--") ? name : `--${name}`,
      };
      if (description) entry.description = description;
      if (tags.summary) entry.summary = tags.summary;
      if (tags.syntax) entry.syntax = tags.syntax;
      const defaultValue =
        tags.defaultValue ??
        (nextDecl?.kind === "custom-property" ? nextDecl.value : undefined);
      if (defaultValue) entry.default = defaultValue;
      cssProperties.push(entry);
    }

    if (tags.cssclass) {
      const name =
        tags.cssclassName ||
        (nextDecl?.kind === "class" ? nextDecl.name : null);
      if (!name) continue;
      const entry = { name: name.replace(/^\./, "") };
      if (description) entry.description = description;
      if (tags.summary) entry.summary = tags.summary;
      cssClasses.push(entry);
    }

    if (tags.cssalias && nextDecl?.kind === "custom-selector") {
      const entry = {
        name: nextDecl.name,
        selectors: nextDecl.selectors,
        kind: aliasKind(nextDecl.name),
      };
      if (description) entry.description = description;
      if (tags.summary) entry.summary = tags.summary;
      cssAliases.push(entry);
    }
  }

  // Auto-parse every `@custom-selector` (docs comments optional).
  for (const alias of parseCustomSelectors(src)) {
    if (cssAliases.some((a) => a.name === alias.name)) continue;
    cssAliases.push(alias);
  }

  return {
    ...(element ? { element } : {}),
    cssProperties,
    cssClasses,
    cssAliases,
  };
}

/**
 * Split a selector list on top-level commas (ignores commas inside
 * `()`, `[]`, or `{}`).
 * @param {string} list
 * @returns {string[]}
 */
export function splitSelectorList(list) {
  const out = [];
  let current = "";
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  for (const ch of list) {
    if (ch === "(") depthParen++;
    else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
    else if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);

    if (
      ch === "," &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthBrace === 0
    ) {
      const trimmed = current.replace(/\s+/g, " ").trim();
      if (trimmed) out.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.replace(/\s+/g, " ").trim();
  if (trimmed) out.push(trimmed);
  return out;
}

/**
 * @param {string} src
 * @returns {Array<{
 *   name: string,
 *   selectors: string[],
 *   kind: "element" | "state",
 * }>}
 */
export function parseCustomSelectors(src) {
  const out = [];
  const re = /@custom-selector\s+(:--[\w-]+)\s+([\s\S]*?);/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const selectors = splitSelectorList(m[2]);
    if (!selectors.length) continue;
    out.push({ name, selectors, kind: aliasKind(name) });
  }
  return out;
}

/**
 * `:--el` → element; `:--el--state` → state (double-hyphen separator).
 * @param {string} name
 * @returns {"element" | "state"}
 */
export function aliasKind(name) {
  const bare = name.startsWith(":--") ? name.slice(3) : name;
  return bare.includes("--") ? "state" : "element";
}

function stripStars(raw) {
  return raw
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n");
}

function leadingDescription(body) {
  const beforeFirstTag = body.split(/\n(?=@\w+)/)[0];
  const trimmed = beforeFirstTag
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed || /^@/.test(trimmed)) return undefined;
  return trimmed;
}

function parseTags(body) {
  const out = {
    cssproperty: false,
    csspropertyName: undefined,
    cssclass: false,
    cssclassName: undefined,
    cssalias: false,
    syntax: undefined,
    defaultValue: undefined,
    summary: undefined,
    element: undefined,
    internal: false,
  };

  for (const block of splitByAt(body)) {
    const m =
      /^@(cssproperty|cssprop|cssclass|cssalias|syntax|default|summary|element|internal|ignore)\b(.*)$/s.exec(
        block,
      );
    if (!m) continue;
    const [, kind, rest] = m;
    const collapsed = rest.replace(/\s+/g, " ").trim();

    if (kind === "cssproperty" || kind === "cssprop") {
      out.cssproperty = true;
      const nm = /^(--[\w-]+)/.exec(collapsed);
      if (nm) out.csspropertyName = nm[1];
    } else if (kind === "cssclass") {
      out.cssclass = true;
      const nm = /^(\.?[\w-]+)/.exec(collapsed);
      if (nm) out.cssclassName = nm[1].replace(/^\./, "");
    } else if (kind === "cssalias") {
      out.cssalias = true;
    } else if (kind === "syntax") {
      out.syntax = collapsed || undefined;
    } else if (kind === "default") {
      out.defaultValue = collapsed || undefined;
    } else if (kind === "summary") {
      out.summary = collapsed || undefined;
    } else if (kind === "element") {
      const em = /^([\w-]+)/.exec(collapsed);
      if (em) out.element = em[1];
    } else if (kind === "internal" || kind === "ignore") {
      out.internal = true;
    }
  }
  return out;
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

/**
 * Peek at the next meaningful CSS construct after a comment.
 * Skips whitespace and `//` / `/* *\/` comments.
 */
function peekNextConstruct(after) {
  let i = 0;
  while (i < after.length) {
    if (/\s/.test(after[i])) {
      i++;
      continue;
    }
    if (after.startsWith("//", i)) {
      const nl = after.indexOf("\n", i);
      i = nl < 0 ? after.length : nl + 1;
      continue;
    }
    if (after.startsWith("/*", i)) {
      const end = after.indexOf("*/", i + 2);
      i = end < 0 ? after.length : end + 2;
      continue;
    }
    break;
  }
  const slice = after.slice(i);

  const customSel = /^@custom-selector\s+(:--[\w-]+)\s+([\s\S]*?);/.exec(slice);
  if (customSel) {
    return {
      kind: "custom-selector",
      name: customSel[1],
      selectors: splitSelectorList(customSel[2]),
    };
  }

  const prop = /^(--[\w-]+)\s*:\s*([^;]+);/.exec(slice);
  if (prop) {
    return {
      kind: "custom-property",
      name: prop[1],
      value: prop[2].replace(/\s+/g, " ").trim(),
    };
  }

  // `&:has(...) .raised`, `&.raised`, `.raised`, `super-input.raised`
  const classMatch =
    /^&?\.([\w-]+)\b/.exec(slice) ||
    /^[^\{;]*?\.([\w-]+)\s*[,\{]/.exec(slice);
  if (classMatch) {
    return { kind: "class", name: classMatch[1] };
  }

  return null;
}

/**
 * Extract `--name: value` custom properties from `@define-mixin scheme-*`
 * (or any mixin matching `mixinPrefix`) bodies. Used for CSS libraries
 * whose theme tokens are defined in mixins rather than `@cssproperty` docs.
 *
 * Later mixins win on name conflict (so `scheme-light` overrides
 * `scheme-constants` defaults). Prefer calling with light/constants only
 * if dark-scheme values should not replace defaults.
 *
 * @param {string} src
 * @param {string} [mixinPrefix="scheme-"]
 * @returns {Array<{ name: string, default: string }>}
 */
export function extractMixinCustomProperties(src, mixinPrefix = "scheme-") {
  const byName = new Map();
  const re = new RegExp(
    `@define-mixin\\s+(${escapeRegExp(mixinPrefix)}[\\w-]*)\\s*\\{`,
    "g",
  );
  let m;
  while ((m = re.exec(src)) !== null) {
    const mixinName = m[1];
    // Dark scheme values are alternatives, not the documented default.
    if (/-dark\b/.test(mixinName)) continue;
    const body = sliceBalancedBlock(src, m.index + m[0].length - 1);
    if (!body) continue;
    for (const prop of extractCustomPropertyDecls(body)) {
      byName.set(prop.name, prop);
    }
  }
  return [...byName.values()];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string} src @param {number} openBraceIndex */
function sliceBalancedBlock(src, openBraceIndex) {
  if (src[openBraceIndex] !== "{") return null;
  let depth = 0;
  for (let i = openBraceIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openBraceIndex + 1, i);
    }
  }
  return null;
}

/** @param {string} body */
function extractCustomPropertyDecls(body) {
  const out = [];
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({
      name: m[1],
      default: m[2].replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/**
 * Merge CSS-derived docs onto a CEM declaration.
 * CSS entries win on name conflict with existing `cssProperties`.
 */
export function mergeCssDocsIntoDeclaration(decl, cssApi) {
  if (!decl || !cssApi) return;

  if (cssApi.cssProperties?.length) {
    const byName = new Map(
      (decl.cssProperties ?? []).map((p) => [p.name, { ...p }]),
    );
    for (const p of cssApi.cssProperties) {
      byName.set(p.name, { ...(byName.get(p.name) ?? {}), ...p });
    }
    decl.cssProperties = [...byName.values()];
  }

  if (cssApi.cssClasses?.length) {
    decl._neutron = decl._neutron ?? {};
    const byName = new Map(
      (decl._neutron.cssClasses ?? []).map((c) => [c.name, { ...c }]),
    );
    for (const c of cssApi.cssClasses) {
      byName.set(c.name, { ...(byName.get(c.name) ?? {}), ...c });
    }
    decl._neutron.cssClasses = [...byName.values()];
  }

  if (cssApi.cssAliases?.length) {
    decl._neutron = decl._neutron ?? {};
    const byName = new Map(
      (decl._neutron.cssAliases ?? []).map((a) => [a.name, { ...a }]),
    );
    for (const a of cssApi.cssAliases) {
      byName.set(a.name, { ...(byName.get(a.name) ?? {}), ...a });
    }
    decl._neutron.cssAliases = [...byName.values()];
  }
}
