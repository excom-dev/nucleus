/**
 * Locks `support/docs/README.md` (the language reference) to the parser:
 * every `quark` code block must parse (blocks marked `invalid` must not),
 * and the hand-written precedence / table sections must agree with the
 * exported grammar tables.
 */
import {
  ATTR_OPERATORS,
  BINARY_BP,
  NOT_BP,
  parse,
  QUARK_AT_RULES,
  SELECTOR_PSEUDOS,
} from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const README = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../docs/README.md"
  ),
  "utf8"
);

interface Fence {
  lang: string;
  info: string;
  code: string;
  line: number;
}

const fences = (markdown: string): Fence[] => {
  const out: Fence[] = [];
  const re = /^```([^\s`]*)([^\n]*)\n([\s\S]*?)^```/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    out.push({
      lang: match[1],
      info: match[2].trim(),
      code: match[3],
      line: markdown.slice(0, match.index).split("\n").length,
    });
  }
  return out;
};

const section = (markdown: string, heading: string): string => {
  const start = markdown.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`Heading not found: ${heading}`);
  const level = heading.match(/^#+/)![0];
  const rest = markdown.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`^#{1,${level.length}} `, "m"));
  return next < 0 ? rest : rest.slice(0, next);
};

describe("language reference (README)", () => {
  const quarkFences = fences(README).filter((f) => f.lang === "quark");

  it("contains parse-checked examples", () => {
    expect(quarkFences.length).toBeGreaterThan(10);
  });

  for (const fence of quarkFences) {
    const invalid = /\binvalid\b/.test(fence.info);
    it(`${invalid ? "rejects" : "parses"} the block at line ${fence.line}`, () => {
      if (invalid) {
        expect(() => parse(fence.code)).toThrow();
      } else {
        expect(() => parse(fence.code)).not.toThrow();
      }
    });
  }

  it("documents the operator precedence table", () => {
    const rows = section(README, "#### Precedence")
      .split("\n")
      .map((line) => line.match(/^\| (\d+) \| (.+) \|$/))
      .filter((m): m is RegExpMatchArray => m !== null);
    const documented: Record<string, number> = {};
    for (const [, level, cell] of rows) {
      for (const op of cell.match(/`([^`]+)`/g) ?? []) {
        documented[op.slice(1, -1)] = Number(level);
      }
    }
    expect(documented).toEqual({ ...BINARY_BP, not: NOT_BP });
  });

  it("documents every attribute operator", () => {
    const line = section(README, "### Selectors").match(/^attr-op\s*=.*$/m)![0];
    for (const op of ATTR_OPERATORS) expect(line).toContain(`"${op}"`);
  });

  it("documents every selector-taking pseudo-class", () => {
    const text = section(README, "### Selectors");
    for (const name of SELECTOR_PSEUDOS) expect(text).toContain(`:${name}`);
  });

  it("documents every Quark at-rule", () => {
    const text = section(README, "### At-rules");
    for (const name of QUARK_AT_RULES) expect(text).toContain(`"@${name}"`);
  });
});
