import { afterAll, describe, expect, it } from "@excom/nucleus-test";
import { quark } from "@excom/nucleus-quark-highlighter/shiki";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHighlighter } from "shiki";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "../../public");
const sheets = (readdirSync(PUBLIC, { recursive: true }) as string[])
  .filter((file) => file.endsWith(".quark"))
  .sort();

// The grammar still names `source.sassdoc` (the editor resolves it; Shiki skips a
// rule whose include is missing). An empty stand-in makes Shiki behave like the
// editor, so a `///` rule left in the grammar would show up as a comment here.
const sassdoc = { name: "sassdoc", scopeName: "source.sassdoc", patterns: [] };
const highlighter = await createHighlighter({ themes: ["github-dark"], langs: ["css", sassdoc, quark] });
afterAll(() => highlighter.dispose());

/** The scopes of the first token of `code` that holds `text`. */
const scopesOf = (code: string, text: string): string[] => {
  const { tokens } = highlighter.codeToTokens(code, {
    lang: "quark",
    theme: "github-dark",
    includeExplanation: "scopeName",
  });
  const found = tokens
    .flat()
    .flatMap((token) => token.explanation ?? [])
    .find((part) => part.content.includes(text));
  if (!found) throw new Error(`no token holds ${text}`);
  return found.scopes.map((scope) => scope.scopeName);
};

/** `declaration` inside an `@on` block, followed by one more declaration. */
const block = (declaration: string) => `:scope {\n  @on click {\n    ${declaration}\n    data-after: 1;\n  }\n}\n`;

// The grammar the site's code blocks and the editor extension share
// (`@excom/nucleus-quark-highlighter`). A rule that never closes colours the
// rest of the file as one value: property names and event names turn into
// the colour of a function.
describe("the Quark grammar", () => {
  it.each([
    "$x: if($a: 1; else: preserve);",
    "$x: if(event.target == target: round(event.offsetX); else: preserve);",
    "data-x: if($a: round($b); else: preserve);",
    "data-x: max(0, count);",
    "data-x: if($a: (1 + small); else: 2);",
  ])("closes the value of `%s`: a word before `)` does not take the bracket", (declaration) => {
    expect(scopesOf(block(declaration), "data-after")).not.toContain("meta.property-value.scss");
  });

  it("still reads a function call and a bare word as it did", () => {
    const code = block("data-x: round(count);");
    expect(scopesOf(code, "round").at(-1)).toBe("support.function.misc.scss");
    expect(scopesOf(code, "count").at(-1)).toBe("support.function.misc.scss");
  });

  // every sheet the site serves: a selector written after it is at the top level
  it.each(sheets)("%s leaves no rule open", (file) => {
    const code = `${readFileSync(join(PUBLIC, file), "utf8")}\nend-of-sheet {\n}\n`;
    const scopes = scopesOf(code, "end-of-sheet");
    expect(scopes.filter((scope) => scope.startsWith("meta.property-"))).toEqual([]);
  });

  // Quark has no line comments: only `/* … */` is a comment
  const places: [string, (line: string) => string][] = [
    ["the top level", (line) => `${line}\n:scope {\n  data-a: 1;\n}\n`],
    ["a rule body", (line) => `:scope {\n  ${line}\n  data-a: 1;\n}\n`],
    ["an @on block", (line) => block(line)],
    ["after a declaration", (line) => `:scope {\n  data-a: 1; ${line}\n  data-b: 2;\n}\n`],
  ];
  const commentScopes = (code: string, text: string) =>
    highlighter
      .codeToTokens(code, { lang: "quark", theme: "github-dark", includeExplanation: "scopeName" })
      .tokens.flat()
      .flatMap((token) => token.explanation ?? [])
      .filter((part) => part.content.includes(text))
      .flatMap((part) => part.scopes.map((scope) => scope.scopeName))
      .filter((scope) => scope.startsWith("comment"));

  describe.each(places)("in %s", (_, wrap) => {
    it.each(["// zzline text", "/// zzline text"])("`%s` is not a comment", (line) => {
      expect(commentScopes(wrap(line), "zzline")).toEqual([]);
    });

    it.each(["/* zzline text */", "/* zzline a // b */"])("`%s` is still a block comment", (line) => {
      expect(scopesOf(wrap(line), "zzline")).toContain("comment.block.scss");
    });
  });

  it("keeps a `//` inside a string as a string", () => {
    const scopes = scopesOf(block('data-x: "https://x";'), "https://x");
    expect(scopes.some((scope) => scope.startsWith("string"))).toBe(true);
    expect(scopes.some((scope) => scope.startsWith("comment"))).toBe(false);
  });

  it.each(["//", "///"])("tokenizes the line after a `%s` line as it does without it", (marker) => {
    const withLine = scopesOf(block(`${marker} note`), "data-after");
    const without = scopesOf(block(""), "data-after");
    expect(withLine).toEqual(without);
  });
});
