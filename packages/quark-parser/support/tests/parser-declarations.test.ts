import { parse } from "../../index";
import type { Declaration, Rule, Stylesheet } from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

/** Parses `src` and returns the first declaration of the first rule. */
const firstDecl = (src: string): any => {
  const sheet: Stylesheet = parse(src);
  const rule = sheet.body[0] as Rule;
  return rule.block.body[0] as Declaration;
};

describe("declarations", () => {
  it("parses a simple declaration", () => {
    const d = firstDecl("span { data-name: \"my-span\"; }");
    expect(d.type).toBe("declaration");
    expect(d.property.name).toBe("data-name");
    expect(d.value).toMatchObject({ type: "string", value: "my-span" });
  });

  it("parses identifier values (none keyword stays an identifier)", () => {
    const d = firstDecl("p { content: none; }");
    expect(d.value).toMatchObject({ type: "identifier", name: "none" });
  });

  it("parses empty-string values", () => {
    const d = firstDecl('input { autofocus: ""; }');
    expect(d.value).toMatchObject({ type: "string", value: "" });
  });

  it("parses variable declarations", () => {
    const d = firstDecl("main { $fooBar: \"test-string\"; }");
    expect(d.property).toMatchObject({ type: "variable", name: "fooBar" });
    expect(d.value.type).toBe("string");
  });

  it("rejects member keys on variables ($sig.value:) with guidance", () => {
    expect(() => parse("li { $count.value: $count.value + 1; }")).toThrow(
      /Member keys \(\$count\.…:\) are not supported.*element\.quark\.setProperty/
    );
    expect(() => parse('li { $state.user.name: "Ada"; }')).toThrow(/not supported/);
    // a member chain inside a value is still an expression
    const d = firstDecl("li { $next: $count.value + 1; }");
    expect(d.property).toMatchObject({ type: "variable", name: "next" });
    expect(d.value.type).toBe("binary");
  });

  it("does not treat a whitespace-separated dot as a member key", () => {
    /* `$a .value: x` is not a member write key: the chain must be
     * whitespace-free, so this fails as a declaration. */
    expect(() => parse("li { $a .value: x; }")).toThrow();
  });

  it("parses top-level declarations (Quark extension)", () => {
    const sheet = parse("data-handlers: checkUnauth, showErrorSheet;");
    const d = sheet.body[0] as any;
    expect(d.type).toBe("declaration");
    expect(d.property.name).toBe("data-handlers");
    expect(d.value.type).toBe("list");
    expect(d.value.separator).toBe(",");
    expect(d.value.items.map((i: any) => i.name)).toEqual([
      "checkUnauth",
      "showErrorSheet",
    ]);
  });

  it("parses top-level variable declarations", () => {
    const sheet = parse('$user: prop("provision");');
    const d = sheet.body[0] as any;
    expect(d.property).toMatchObject({ type: "variable", name: "user" });
    expect(d.value.type).toBe("function");
  });

  it("rejects ! flags", () => {
    for (const flag of ["important", "default", "global"]) {
      const src = `a { $x: 1 !${flag}; }`;
      expect(() => parse(src)).toThrow(
        new RegExp(`!${flag} is not supported \\(1:${src.indexOf("!") + 1}\\)`)
      );
    }
  });

  it("parses custom properties", () => {
    const d = firstDecl("a { --primary: #fff; }");
    expect(d.property.name).toBe("--primary");
    expect(d.value).toMatchObject({ type: "color", value: "#fff" });
  });

  it("rejects interpolated property names", () => {
    const src = "a { border-#{$side}-radius: 3px; }";
    expect(() => parse(src)).toThrow(
      new RegExp(
        `Interpolation is only supported inside strings \\(1:${src.indexOf("#{") + 1}\\)`
      )
    );
  });

  it("rejects nested property blocks, keeping `a:hover {}` a rule", () => {
    for (const src of [
      "a { font: bold { family: serif; } }",
      "a { font: { family: serif; } }",
    ]) {
      expect(() => parse(src)).toThrow(
        /Nested property blocks are not supported \(1:5\)/
      );
    }
    const rule = parse("x { a:hover { b: c; } }") as any;
    expect(rule.body[0].block.body[0].type).toBe("rule");
  });

  it("allows a missing semicolon before a closing brace", () => {
    const d = firstDecl("a { content: getTitle($status) }");
    expect(d.value.type).toBe("function");
  });

  it("tolerates stray semicolons", () => {
    const sheet = parse("a { ; content: none;; } ;");
    expect((sheet.body[0] as Rule).block.body).toHaveLength(1);
  });

  it("preserves comments as nodes", () => {
    const sheet = parse(`
      /* header comment */
      a {
        /* inner */
        content: none;
      }
    `) as any;
    expect(sheet.body[0]).toMatchObject({
      type: "comment",
      text: " header comment ",
    });
    expect(sheet.body[1].block.body[0]).toMatchObject({
      type: "comment",
      text: " inner ",
    });
  });

  it("keeps colons inside string values intact", () => {
    const d = firstDecl('a { style: "text-transform: capitalize"; }');
    expect(d.value.value).toBe("text-transform: capitalize");
  });

  it("records spans covering the full declaration", () => {
    const src = "a { content: none; }";
    const d = firstDecl(src);
    expect(src.slice(d.start, d.end)).toBe("content: none;");
  });
});
