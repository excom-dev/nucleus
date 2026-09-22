/**
 * Keeps `src/language.ts` (the language metadata) in step with the engine
 * and with the generated tables on the doc pages (`support/docs/*.md`).
 */
import {
  ALLOWED_METHODS,
  AT_RULES,
  BUILTIN_FUNCTIONS,
  DECLARATION_KINDS,
  PSEUDO_CLASSES,
  VALUE_KEYWORDS,
} from "../../src/language";
import {
  ALLOWED_METHOD_NAMES,
  METHOD_ALLOWLIST,
  PSEUDO_CLASS_SUPPORT,
} from "../../src/language-tables";
import * as languageEntry from "../../language";
import { VALUE_MAP } from "../../src/constants";
import { FIELD_RESOLVERS } from "../../src/resolvers";
import { BUILTIN_NAMES } from "../../src/variables";
import {
  readLanguageDocs,
  renderLanguageDocs,
} from "../scripts/build-language-docs.mjs";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { parse } from "@excom/quark-parser";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../docs"
);

/** Every consumer doc page (README + topic pages; INTERNAL.md is contributor notes). */
const README = readdirSync(DOCS_DIR)
  .filter((f) => f.endsWith(".md") && f !== "INTERNAL.md")
  .sort()
  .map((f) => readFileSync(path.join(DOCS_DIR, f), "utf8"))
  .join("\n");

const names = (entries: readonly { name: string }[]) =>
  [...entries.map((e) => e.name)].sort();

describe("language metadata", () => {
  it("documents exactly the built-in names the scope resolves", () => {
    expect(names(BUILTIN_FUNCTIONS)).toEqual([...BUILTIN_NAMES].sort());
  });

  it("documents exactly the value keywords", () => {
    expect(names(VALUE_KEYWORDS)).toEqual(Object.keys(VALUE_MAP).sort());
  });

  it("documents exactly the runtime method allowlist", () => {
    expect([...METHOD_ALLOWLIST].sort()).toEqual(names(ALLOWED_METHODS));
    expect([...ALLOWED_METHOD_NAMES].sort()).toEqual(names(ALLOWED_METHODS));
    expect(new Set(names(ALLOWED_METHODS)).size).toBe(ALLOWED_METHODS.length);
  });

  it("documents exactly the pseudo-classes the runtime classifies", () => {
    expect(names(PSEUDO_CLASSES)).toEqual(
      Object.keys(PSEUDO_CLASS_SUPPORT).sort()
    );
    for (const doc of PSEUDO_CLASSES) {
      const support = PSEUDO_CLASS_SUPPORT[doc.name];
      expect(doc.kind, doc.name).toBe(support.kind);
      expect(doc.attributes, doc.name).toEqual(support.attributes);
      expect(doc.syntax.startsWith(":")).toBe(true);
      expect(doc.description.length).toBeGreaterThan(0);
    }
  });

  it("ships the documented metadata on the language entry, not the main one", async () => {
    expect(languageEntry.PSEUDO_CLASSES).toBe(PSEUDO_CLASSES);
    expect(languageEntry.METHOD_ALLOWLIST).toBe(METHOD_ALLOWLIST);
    const main = await import("../../index");
    expect("QuarkLanguage" in main).toBe(false);
  });

  it("documents the listener at-rules the resolver executes", () => {
    const syntaxes = AT_RULES.map((a) => a.syntax);
    expect(syntaxes.some((s) => s.startsWith("@on "))).toBe(true);
    expect(syntaxes.some((s) => s.startsWith("@on <event> (option"))).toBe(true);
    expect(syntaxes.some((s) => s.startsWith("@dispatch "))).toBe(true);
    expect(syntaxes.some((s) => s.startsWith("@command "))).toBe(true);
    expect(syntaxes.some((s) => s.startsWith("@off "))).toBe(false);
    expect(syntaxes.some((s) => s.startsWith("@use "))).toBe(true);
    expect(syntaxes.some((s) => s.startsWith("@scope"))).toBe(true);
    expect(syntaxes.some((s) => s.startsWith("@view-transition "))).toBe(true);
    expect(
      syntaxes.some((s) => s.startsWith("@view-transition (option"))
    ).toBe(true);
    expect(Object.keys(FIELD_RESOLVERS)).toContain("listener");
  });

  it("documents every named field resolver as a declaration kind", () => {
    const keys = DECLARATION_KINDS.map((d) => d.key);
    for (const resolver of Object.keys(FIELD_RESOLVERS)) {
      // `variable` / `listener` / `styleProperty` / `attribute` are key-shape
      // dispatches documented under their shapes
      if (
        ["variable", "listener", "styleProperty", "attribute"].includes(
          resolver
        )
      ) {
        continue;
      }
      expect(keys).toContain(resolver);
    }
    expect(keys).toEqual(
      expect.arrayContaining([
        "$name",
        "--name",
        "<anything else>",
      ])
    );
  });
});

describe("doc pages language reference", () => {
  it("has every generated region up to date (run support/scripts/build-language-docs.mjs)", () => {
    const current = readLanguageDocs(README);
    const expected = renderLanguageDocs();
    for (const name of Object.keys(expected)) {
      expect(current[name], `region ${name}`).toBe(expected[name]);
    }
  });

  it("parses every quark example", () => {
    const re = /^```quark[^\n]*\n([\s\S]*?)^```/gm;
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = re.exec(README))) {
      // tutorial blocks elide bodies with `…`; those are not meant to parse
      if (match[1].includes("\u2026")) continue;
      count++;
      expect(() => parse(match![1])).not.toThrow();
    }
    expect(count).toBeGreaterThan(5);
  });
});
