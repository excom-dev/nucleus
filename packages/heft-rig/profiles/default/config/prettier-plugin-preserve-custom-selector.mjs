/**
 * Prettier plugin: keep `:--custom-selector` tokens intact.
 *
 * Wraps the built-in CSS/SCSS/Less parsers and printer.
 *
 * 1. `@custom-selector` at-rules: print the exact source slice (Prettier
 *    would reflow them).
 * 2. `@mixin` / `@define-mixin` params (and any at-rule prelude with `:--`)
 *    glue `:` to `--ident` so `:--data-table` does not become `: --data-table`
 *    or `@mixin module-table: --data-table`. Mixin *bodies* still format.
 */

import * as postcssPlugin from "prettier/plugins/postcss";

const MARK = "__preserveCustomSelector";

const MIXIN_AT_RULES = new Set(["mixin", "define-mixin"]);

function walk(node, visit) {
  visit(node);
  for (const child of node.nodes ?? []) walk(child, visit);
}

function isAtRule(node) {
  return (
    node && (node.type === "css-atrule" || node.type === "atrule")
  );
}

function isCustomSelectorAtRule(node) {
  return isAtRule(node) && node.name === "custom-selector";
}

function atruleValueText(node) {
  const value = node.value;
  if (typeof value === "string") return value;
  if (value && typeof value.text === "string") return value.text;
  if (typeof node.params === "string") return node.params;
  return "";
}

function shouldGlueAtRule(node) {
  if (!isAtRule(node) || isCustomSelectorAtRule(node)) return false;
  if (MIXIN_AT_RULES.has(node.name)) return true;
  return /:--/.test(atruleValueText(node));
}

function walkValue(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  if (node.value && typeof node.value === "object") walkValue(node.value, visit);
  if (node.group) walkValue(node.group, visit);
  if (node.groups) {
    for (const group of node.groups) walkValue(group, visit);
  }
}

/** Glue `:` + `--foo` into `:--foo` so the printer cannot split them. */
function glueCustomSelectorTokens(node) {
  const groups = node.groups;
  if (!Array.isArray(groups)) return;
  for (let i = 0; i < groups.length - 1; i++) {
    const a = groups[i];
    const b = groups[i + 1];
    if (a?.value !== ":" || !String(b?.value ?? "").startsWith("--")) continue;
    groups.splice(i, 2, {
      ...b,
      type: "value-word",
      value: `:${b.value}`,
      raws: {
        before: a.raws?.before ?? "",
        after: b.raws?.after ?? "",
      },
    });
    i--;
  }
}

function getOffsetRange(node) {
  const start = node?.source?.start?.offset;
  const end = node?.source?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return [start, end];
}

function wrapParser(originalParser) {
  return {
    ...originalParser,
    async parse(text, options) {
      const ast = await originalParser.parse(text, options);
      walk(ast, (node) => {
        if (isCustomSelectorAtRule(node)) {
          const range = getOffsetRange(node);
          if (!range) return;
          const [start, end] = range;
          // postcss `end.offset` is inclusive or exclusive by version.
          // Try both, trim, end with exactly one semicolon.
          const candidates = [text.slice(start, end), text.slice(start, end + 1)];
          let raw =
            candidates.find((c) => c.trimEnd().endsWith(";")) ?? candidates[1];
          raw = raw.trimEnd();
          if (!raw.endsWith(";")) raw += ";";
          node[MARK] = raw;
          return;
        }
        if (shouldGlueAtRule(node) && node.value && typeof node.value === "object") {
          walkValue(node.value, glueCustomSelectorTokens);
        }
      });
      return ast;
    },
  };
}

function wrapPrinter(originalPrinter) {
  return {
    ...originalPrinter,
    print(path, options, print) {
      const node =
        typeof path.getValue === "function" ? path.getValue() : path.node;
      if (node && node[MARK]) return node[MARK];
      return originalPrinter.print(path, options, print);
    },
  };
}

const wrappedParsers = {};
for (const [name, parser] of Object.entries(postcssPlugin.parsers ?? {})) {
  wrappedParsers[name] = wrapParser(parser);
}

const wrappedPrinters = {};
for (const [name, printer] of Object.entries(postcssPlugin.printers ?? {})) {
  wrappedPrinters[name] = wrapPrinter(printer);
}

export const parsers = wrappedParsers;
export const printers = wrappedPrinters;
