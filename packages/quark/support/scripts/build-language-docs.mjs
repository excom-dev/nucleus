#!/usr/bin/env node
/**
 * Renders the language metadata in `src/language.ts` into the generated
 * regions of the doc pages under `support/docs/` (`REGION_FILES` says which
 * page holds which table).
 *
 *   node support/scripts/build-language-docs.mjs
 *
 * Regions are fenced by `<!-- generated:<name> -->` / `<!-- /generated -->`
 * markers; everything between them is replaced. `language-docs.test.ts`
 * fails when a page is out of date, so run this after editing the
 * metadata. Plain Node imports the `.ts` module (type stripping); the test
 * imports this file under Vite.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import {
  ALLOWED_METHODS,
  AT_RULES,
  BUILTIN_FUNCTIONS,
  BUILTIN_MODULES,
  COMBINATORS,
  DECLARATION_KINDS,
  PSEUDO_CLASSES,
  VALUE_KEYWORDS,
} from "../../src/language.ts";

const DOCS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../docs"
);

/** Generated region → the doc page that carries it. */
export const REGION_FILES = {
  "at-rules": "AT_RULES.md",
  "declaration-kinds": "DECLARATIONS.md",
  "value-keywords": "VALUES.md",
  "builtin-functions": "BUILTINS.md",
  "allowed-methods": "METHODS.md",
  selectors: "SELECTORS.md",
  "builtin-modules": "MODULES.md",
};

const cell = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

const table = (header, rows) =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");

const GROUP_TITLES = {
  element: "Element reads",
  loop: "Loop context",
  render: "Rendering (`content`)",
  event: "Event listeners",
  state: "State",
  util: "Utilities",
  debug: "Debugging",
};

const PSEUDO_KIND_TITLES = {
  logical: "Logical",
  relational: "Relational",
  structural: "Structural (sibling position, children)",
  attribute: "Attribute-backed",
  static: "Static",
};

const renderSelectors = () => {
  const unobserved = PSEUDO_CLASSES.filter((p) => p.kind === "unobserved");
  return [
    `**Combinators**\n\n${table(
      ["Combinator", "Observed"],
      COMBINATORS.map((c) => [`\`${c.syntax}\``, c.description])
    )}`,
    ...Object.entries(PSEUDO_KIND_TITLES).map(([kind, title]) => {
      const rows = PSEUDO_CLASSES.filter((p) => p.kind === kind);
      return `**${title}**\n\n${table(
        ["Pseudo-class", "Observed"],
        rows.map((p) => [`\`${p.syntax}\``, p.description])
      )}`;
    }),
    `**Not observed** — ${unobserved
      .map((p) => `\`${p.syntax}\``)
      .join(
        ", "
      )}: ${unobserved[0].description} Any pseudo-class not listed above is treated the same way.`,
  ].join("\n\n");
};

/** Region name → rendered markdown. */
export const renderLanguageDocs = () => ({
  "at-rules": table(
    ["At-rule", "Effect"],
    AT_RULES.map((a) => [`\`${a.syntax}\``, a.description])
  ),
  "value-keywords": table(
    ["Keyword", "Meaning"],
    VALUE_KEYWORDS.map((k) => [`\`${k.name}\``, k.description])
  ),
  "declaration-kinds": table(
    ["Key", "Effect", "Accepts"],
    DECLARATION_KINDS.map((d) => [`\`${d.key}\``, d.description, d.accepts])
  ),
  "builtin-functions": Object.entries(GROUP_TITLES)
    .map(([group, title]) => {
      const rows = BUILTIN_FUNCTIONS.filter((f) => f.group === group);
      if (!rows.length) return null;
      return `**${title}**\n\n${table(
        ["Name", "Description"],
        rows.map((f) => [`\`${f.signature}\``, f.description])
      )}`;
    })
    .filter(Boolean)
    .join("\n\n"),
  "builtin-modules": BUILTIN_MODULES.map(
    (m) =>
      `**\`quark:${m.name}\`** — ${m.description}\n\n${table(
        ["Name", "Description"],
        m.functions.map((f) => [`\`${f.signature}\``, f.description])
      )}`
  ).join("\n\n"),
  selectors: renderSelectors(),
  "allowed-methods": table(
    ["Method", "On", "Description"],
    ALLOWED_METHODS.map((m) => [
      `\`.${m.signature}\``,
      m.on.join(", "),
      m.description,
    ])
  ),
});

const START = (name) => `<!-- generated:${name} -->`;
const END = "<!-- /generated -->";

/** Replace every region of `regions` found in `markdown`; throws on a missing one. */
export const spliceLanguageDocs = (
  markdown,
  regions = renderLanguageDocs()
) => {
  let out = markdown;
  for (const [name, body] of Object.entries(regions)) {
    const start = out.indexOf(START(name));
    if (start < 0) throw new Error(`page is missing ${START(name)}`);
    const from = start + START(name).length;
    const end = out.indexOf(END, from);
    if (end < 0) throw new Error(`page is missing ${END} after ${name}`);
    out = `${out.slice(0, from)}\n${body}\n${out.slice(end)}`;
  }
  return out;
};

/** Current region bodies in `markdown`, keyed like `renderLanguageDocs`. */
export const readLanguageDocs = (markdown) => {
  const regions = {};
  for (const name of Object.keys(renderLanguageDocs())) {
    const start = markdown.indexOf(START(name));
    if (start < 0) continue;
    const from = start + START(name).length;
    const end = markdown.indexOf(END, from);
    regions[name] = markdown.slice(from, end < 0 ? undefined : end).trim();
  }
  return regions;
};

const isCli = () => {
  try {
    return (
      realpathSync(path.resolve(process.cwd(), process.argv[1] ?? "")) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
};

if (isCli()) {
  const regions = renderLanguageDocs();
  let updated = 0;
  for (const [name, file] of Object.entries(REGION_FILES)) {
    const page = path.join(DOCS_DIR, file);
    const before = await readFile(page, "utf8");
    const after = spliceLanguageDocs(before, { [name]: regions[name] });
    if (after !== before) {
      await writeFile(page, after, "utf8");
      console.log(`updated ${path.relative(process.cwd(), page)}`);
      updated++;
    }
  }
  if (!updated) console.log("language docs already up to date");
}
