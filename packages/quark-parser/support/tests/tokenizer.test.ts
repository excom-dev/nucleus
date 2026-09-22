import { tokenize } from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const types = (src: string) => tokenize(src).tokens.map((t) => t.type);
const values = (src: string) => tokenize(src).tokens.map((t) => t.value);

describe("tokenizer", () => {
  it("tokenizes identifiers, including hyphens and leading dashes", () => {
    expect(values("provider-fetch data-me -webkit-box --custom")).toEqual([
      "provider-fetch",
      "data-me",
      "-webkit-box",
      "--custom",
    ]);
    expect(types("a b")).toEqual(["ident", "ident"]);
  });

  it("tokenizes variables (hyphens and digits allowed)", () => {
    const { tokens } = tokenize("$currentUserId $max-users-2");
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ["variable", "currentUserId"],
      ["variable", "max-users-2"],
    ]);
  });

  it("tokenizes at-keywords", () => {
    const { tokens } = tokenize("@media @-webkit-keyframes");
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ["at", "media"],
      ["at", "-webkit-keyframes"],
    ]);
  });

  it("tokenizes numbers with units and exponents", () => {
    const { tokens } = tokenize("13 32.125 .5em 50% 2e3 2em");
    expect(tokens.map((t) => [t.value, t.unit ?? null])).toEqual([
      ["13", null],
      ["32.125", null],
      [".5", "em"],
      ["50", "%"],
      ["2e3", null],
      ["2", "em"],
    ]);
  });

  it("distinguishes negative numbers from subtraction", () => {
    const withUnits = (src: string) =>
      tokenize(src).tokens.map((t) => t.value + (t.unit ?? ""));
    // expression start: sign
    expect(withUnits(": -5")).toEqual([":", "-5"]);
    // `10px -5px`: whitespace before, none after: sign (list shape)
    expect(withUnits("10px -5px")).toEqual(["10px", "-5px"]);
    // whitespace on both sides: subtraction
    expect(withUnits("10 - 5")).toEqual(["10", "-", "5"]);
    // no whitespace at all after a value: subtraction
    expect(withUnits("10-5")).toEqual(["10", "-", "5"]);
  });

  it("tokenizes strings with escapes and preserves interpolation raw", () => {
    const { tokens } = tokenize(`"a \\"b\\" c" 'd #{$e} f'`);
    expect(tokens[0]).toMatchObject({
      type: "string",
      value: 'a \\"b\\" c',
      quote: '"',
    });
    expect(tokens[1]).toMatchObject({
      type: "string",
      value: "d #{$e} f",
      quote: "'",
    });
  });

  it("does not end a string on a quote inside interpolation", () => {
    const { tokens } = tokenize(`"a #{ "b" } c"`);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].value).toBe(`a #{ "b" } c`);
  });

  it("separates comments from tokens", () => {
    const { tokens, comments } = tokenize("a /* one */\n/* two */ b");
    expect(tokens.map((t) => t.value)).toEqual(["a", "b"]);
    expect(comments.map((c) => c.value)).toEqual([" one ", " two "]);
  });

  it("rejects line comments, pointing at the `//`", () => {
    expect(() => tokenize("a {\n  x: 1; // note\n}")).toThrow(
      "Line comments are not supported, use /* */ (2:9)"
    );
  });

  it("keeps `/` as division", () => {
    expect(values("$a / 2")).toEqual(["a", "/", "2"]);
  });

  it("tokenizes hashes for ids and colors", () => {
    const { tokens } = tokenize("#refresh-btn #fff");
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ["hash", "refresh-btn"],
      ["hash", "fff"],
    ]);
  });

  it("tokenizes multi-character punctuation", () => {
    expect(values("== != <= >= :: *= ~= ^= |= $= ... #{")).toEqual([
      "==",
      "!=",
      "<=",
      ">=",
      "::",
      "*=",
      "~=",
      "^=",
      "|=",
      "$=",
      "...",
      "#{",
    ]);
  });

  it("tokenizes unquoted urls as raw", () => {
    const { tokens } = tokenize("url(/img/kroger.png)");
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ["ident", "url"],
      ["punct", "("],
      ["url", "/img/kroger.png"],
      ["punct", ")"],
    ]);
  });

  it("does not raw-scan quoted or variable urls", () => {
    expect(types(`url("a.png")`)).toEqual(["ident", "punct", "string", "punct"]);
    expect(types("url($src)")).toEqual(["ident", "punct", "variable", "punct"]);
  });

  it("handles urls containing what would otherwise be comments", () => {
    const { tokens } = tokenize("url(http://example.com/a.png)");
    expect(tokens[2]).toMatchObject({
      type: "url",
      value: "http://example.com/a.png",
    });
  });

  it("sets the ws flag from preceding whitespace and comments", () => {
    const { tokens } = tokenize("a b/* c */d");
    expect(tokens.map((t) => [t.value, t.ws])).toEqual([
      ["a", false],
      ["b", true],
      ["d", true],
    ]);
  });

  it("records accurate spans", () => {
    const src = "abc  $def";
    const { tokens } = tokenize(src);
    expect(src.slice(tokens[0].start, tokens[0].end)).toBe("abc");
    expect(src.slice(tokens[1].start, tokens[1].end)).toBe("$def");
  });

  it("throws on unterminated strings and comments", () => {
    expect(() => tokenize('"abc')).toThrow(/Unterminated string/);
    expect(() => tokenize("/* abc")).toThrow(/Unterminated comment/);
  });

  it("keeps backslash escapes inside identifiers", () => {
    expect(values("a\\:b c")).toEqual(["a\\:b", "c"]);
  });

  it("tokenizes signed and multi-digit exponents", () => {
    const { tokens } = tokenize("2e-3 1e10 1E+2 2e");
    expect(tokens.map((t) => [t.value, t.unit ?? null])).toEqual([
      ["2e-3", null],
      ["1e10", null],
      ["1E+2", null],
      ["2", "e"],
    ]);
  });

  it("tokenizes a signed leading-dot number", () => {
    expect(values("-.5")).toEqual(["-.5"]);
    expect(types("-.5")).toEqual(["number"]);
  });

  it("emits lone $, @, and # as punctuation", () => {
    expect(tokenize("$ @ # x").tokens.map((t) => [t.type, t.value])).toEqual([
      ["punct", "$"],
      ["punct", "@"],
      ["punct", "#"],
      ["ident", "x"],
    ]);
  });

  it("tokenizes single-character forms of the compound operators", () => {
    expect(values("= ! < > : * ~ ^ |")).toEqual([
      "=",
      "!",
      "<",
      ">",
      ":",
      "*",
      "~",
      "^",
      "|",
    ]);
  });

  it("does not end a string on a quote or brace nested in interpolation", () => {
    expect(tokenize('"#{ {} }"').tokens).toHaveLength(1);
    const escaped = tokenize('"#{ "a\\"b" }"').tokens;
    expect(escaped).toHaveLength(1);
    expect(escaped[0].value).toBe('#{ "a\\"b" }');
  });

  it("trims whitespace around raw url contents", () => {
    const { tokens } = tokenize("url( /a.png )");
    expect(tokens[2]).toMatchObject({ type: "url", value: "/a.png" });
    expect(tokens[3]).toMatchObject({ type: "punct", value: ")" });
  });

  it("keeps escapes and interpolation inside raw urls", () => {
    expect(tokenize("url(a\\)b.png)").tokens[2]).toMatchObject({
      type: "url",
      value: "a\\)b.png",
    });
    expect(tokenize("url(/img/#{$n}.svg)").tokens[2]).toMatchObject({
      type: "url",
      value: "/img/#{$n}.svg",
    });
  });

  it("falls back to normal tokens when url contents are not raw", () => {
    // internal whitespace, nested parens, quotes, variables, unterminated
    expect(types("url(a b)")).toEqual([
      "ident",
      "punct",
      "ident",
      "ident",
      "punct",
    ]);
    expect(types("url(a(b))")).toEqual([
      "ident",
      "punct",
      "ident",
      "punct",
      "ident",
      "punct",
      "punct",
    ]);
    expect(types('url(a"b")')).toEqual([
      "ident",
      "punct",
      "ident",
      "string",
      "punct",
    ]);
    expect(types("url(a$b)")).toEqual([
      "ident",
      "punct",
      "ident",
      "variable",
      "punct",
    ]);
    expect(types("url(abc")).toEqual(["ident", "punct", "ident"]);
  });
});
