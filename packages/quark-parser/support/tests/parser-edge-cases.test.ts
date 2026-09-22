/**
 * Error branches and rarely-hit grammar shapes: every `fail()` site in the
 * parser, tolerated trailing commas / missing terminators, rare selector
 * parts, string / url interpolation splitting, and at-rule tails.
 */
import {
  parse,
  parseExpression,
  parseSelectorList,
  QuarkParseError,
} from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const first = (src: string): any => parse(src).body[0];
const expr = (src: string): any => parseExpression(src);
/** Parts of the first selector of the first rule. */
const sel = (selector: string): any[] =>
  (parse(`${selector} { x: y; }`).body[0] as any).selector.selectors[0].parts;
/** Asserts a `QuarkParseError` matching `pattern`, at `position` when given. */
const fails = (
  fn: () => unknown,
  pattern: RegExp,
  position?: number
): void => {
  expect(fn).toThrow(QuarkParseError);
  expect(fn).toThrow(pattern);
  if (position === undefined) return;
  try {
    fn();
  } catch (error) {
    expect((error as QuarkParseError).position).toBe(position);
  }
};

describe("parser edge cases: statements", () => {
  it("rejects a bare word with neither a colon nor a block", () => {
    fails(() => parse("a"), /Expected declaration or rule/);
  });

  it("rejects a property name split by whitespace", () => {
    fails(() => parse("a b: c;"), /Expected ":" but found "b"/);
  });

  it("rejects a property name that is not an identifier", () => {
    fails(() => parse("1: 2;"), /Expected property name/);
  });

  it("rejects a value followed by an at-keyword instead of a terminator", () => {
    fails(() => parse("a { b: 1 @x; }"), /Expected ";" but found "x"/);
  });

  it("rejects a brace nested inside parens in a statement head", () => {
    // the lookahead tracks the `{` at paren depth; the value parser then
    // rejects it as a token
    fails(() => parse("a:x({) { y: z; }"), /Unexpected token "\{"/);
  });

  it("reports the end of the source when input runs out", () => {
    try {
      parseExpression("");
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(QuarkParseError);
      expect(e.message).toMatch(/Unexpected end of input/);
      expect(e.position).toBe(0);
    }
  });
});

describe("parser edge cases: selectors", () => {
  it("rejects an empty selector list", () => {
    fails(() => parseSelectorList(""), /Expected selector/);
  });

  it("rejects tokens that cannot start a compound selector", () => {
    fails(() => parse('"x" { a: b; }'), /Unexpected token "x" in selector/);
    fails(() => parse("a ! { x: y; }"), /Unexpected token "!" in selector/);
  });

  it("rejects a class selector without a name", () => {
    fails(() => parse(". { x: y; }"), /Expected identifier but found "\{"/);
  });

  it("rejects pseudo selectors without a name", () => {
    fails(() => parseSelectorList("a:"), /Expected identifier \(/);
    fails(() => parse("a::{ x: y; }"), /Expected identifier but found "\{"/);
  });

  it("rejects an unclosed raw pseudo argument", () => {
    fails(() => parseSelectorList("a:nth-child(2n"), /Unexpected end of input/);
  });

  it("rejects missing or malformed attribute values", () => {
    fails(() => parseSelectorList("[a="), /Expected attribute value/);
    fails(() => parseSelectorList("[a=(]"), /Unexpected attribute value "\("/);
  });

  it("parses number attribute values", () => {
    expect(sel("[data-n=5]")[0].value).toMatchObject({
      type: "number",
      value: 5,
      unit: null,
    });
    expect(sel("[data-n=5px]")[0].value).toMatchObject({ unit: "px" });
  });

  it("parses the `s` attribute modifier", () => {
    expect(sel('[a="v" s]')[0].modifier).toBe("s");
  });

  it("parses pseudo-elements with arguments", () => {
    expect(sel("a::part(label)")[1]).toMatchObject({
      type: "pseudo_element_selector",
      name: "part",
      argument: { type: "raw", value: "label" },
    });
  });

  it("keeps nested parens and interpolation inside raw pseudo arguments", () => {
    expect(sel("li:nth-child((2n + 1))")[1].argument.value).toBe("(2n + 1)");
    expect(sel("li:nth-child(#{$n})")[1].argument.value).toBe("#{$n}");
  });
});

describe("parser edge cases: expressions", () => {
  it("rejects unclosed parens and trailing input", () => {
    fails(() => parseExpression("(1"), /Expected "\)" \(/);
    fails(() => parseExpression("1 ; 2"), /Unexpected trailing input/);
  });

  it("tolerates a trailing comma in a top-level list", () => {
    const e = expr("a, b,");
    expect(e).toMatchObject({ type: "list", separator: "," });
    expect(e.items).toHaveLength(2);
  });

  it("tolerates trailing commas in maps and paren lists", () => {
    expect(expr("(a: 1, )").entries).toHaveLength(1);
    expect(expr("(1, 2, )")).toMatchObject({ type: "list", parens: true });
    expect(expr("(1, 2, )").items).toHaveLength(2);
  });

  it("rejects a dot without a property name", () => {
    fails(() => parseExpression("$a."), /Expected property name after "\."/);
    fails(() => parseExpression('$a."x"'), /Expected property name after "\."/);
  });

  it("calls an interpolated callee", () => {
    expect(expr("#{$fn}(1)")).toMatchObject({
      type: "function",
      callee: { type: "interpolation" },
    });
  });

  it("parses non-hex hashes as identifiers", () => {
    expect(expr("#refresh-btn")).toMatchObject({
      type: "identifier",
      name: "#refresh-btn",
    });
  });

  it("rejects unclosed calls and if() arms", () => {
    fails(() => parseExpression("f(1,"), /Unclosed arguments/);
    fails(() => parseExpression("if($a, 1"), /Expected "\)"/);
    fails(() => parseExpression("if($a: 1;"), /Unclosed if\(\)/);
  });

  it("splits string interpolation at the edges", () => {
    expect(expr('"#{$a}b"').parts).toEqual([
      expect.objectContaining({ type: "interpolation" }),
      "b",
    ]);
    expect(expr('"a#{$b}"').parts).toEqual([
      "a",
      expect.objectContaining({ type: "interpolation" }),
    ]);
  });

  it("skips escapes and nested strings while splitting interpolation", () => {
    expect(expr("'it\\'s #{$x}'").parts[0]).toBe("it\\'s ");
    const nested = expr('"a #{ "b" } c"');
    expect(nested.parts[1].expression).toMatchObject({
      type: "string",
      value: "b",
    });
    expect(nested.parts[2]).toBe(" c");
    expect(expr('"#{ "b\\"c" }"').parts[0].expression.value).toBe('b\\"c');
  });

  it("records interpolation spans inside strings", () => {
    const src = '"a #{$b} c"';
    const e = expr(src);
    expect(src.slice(e.parts[1].start, e.parts[1].end)).toBe("#{$b}");
  });

  it("rejects malformed interpolation contents", () => {
    fails(
      () => parseExpression('"#{1 ; 2}"'),
      /Unexpected trailing input in interpolation/,
    );
    fails(() => parseExpression('"#{ {} }"'), /Unexpected token "\{"/);
  });

  it("splits interpolation inside unquoted urls", () => {
    expect(expr("url(/img/#{$name}.svg)").parts).toEqual([
      "/img/",
      expect.objectContaining({ type: "interpolation" }),
      ".svg",
    ]);
  });
});

describe("parser edge cases: at-rules", () => {
  it("rejects @use without a string url", () => {
    fails(() => parse("@use foo;"), /Expected string but found "foo"/);
    fails(() => parse("@use"), /Expected string \(/);
  });

  it("accepts statement at-rules without a terminator at the end of input", () => {
    expect(first('@use "x"').url).toBe("x");
    expect(first('@warn "x"').value.value).toBe("x");
  });

  it("accepts statement at-rules closed by a brace", () => {
    expect(first("a { @warn 1 }").block.body[0]).toMatchObject({
      name: "warn",
      value: { type: "number", value: 1 },
    });
  });
});

/*
 * Quark is a derivative of CSS: what the engine never ran does not parse.
 * One case per rejection message, with the reported position.
 */
describe("parser edge cases: rejected constructs", () => {
  it("rejects at-rules that are not Quark's own", () => {
    fails(
      () => parse("@media print { a { b: c; } }"),
      /@media is not a Quark at-rule/,
      0
    );
  });

  it("rejects placeholder selectors", () => {
    fails(
      () => parse("a %error { x: y; }"),
      /Placeholder selectors are not supported/,
      2
    );
  });

  it("rejects interpolation outside strings", () => {
    const selector = ".btn-#{$variant} { x: y; }";
    fails(
      () => parse(selector),
      /Interpolation is only supported inside strings/,
      selector.indexOf("#{")
    );
    const attribute = "[data-x=#{$v}] { x: y; }";
    fails(
      () => parse(attribute),
      /Interpolation is only supported inside strings/,
      attribute.indexOf("#{")
    );
    // inside a string it is the normal way to build text
    expect(() => parse('a { x: "btn-#{$variant}"; }')).not.toThrow();
  });

  it("rejects ! flags", () => {
    const src = "a { color: red !important; }";
    fails(() => parse(src), /!important is not supported/, src.indexOf("!"));
  });

  it("rejects nested property blocks", () => {
    const src = "a { font: { size: 1rem; } }";
    fails(
      () => parse(src),
      /Nested property blocks are not supported/,
      src.indexOf("font")
    );
  });

  it("rejects a @use with clause", () => {
    const src = '@use "x" with ($a: 1);';
    fails(
      () => parse(src),
      /@use does not take a with clause/,
      src.indexOf("with")
    );
  });
});
