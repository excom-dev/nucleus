import { parseExpression, QuarkParseError, parse } from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const expr = (src: string): any => parseExpression(src);

describe("expressions", () => {
  describe("literals", () => {
    it("parses numbers with units", () => {
      expect(expr("13")).toMatchObject({ type: "number", value: 13, unit: null });
      expect(expr("32.125px")).toMatchObject({ value: 32.125, unit: "px" });
      expect(expr("50%")).toMatchObject({ value: 50, unit: "%" });
      expect(expr("-27.835")).toMatchObject({ value: -27.835 });
    });

    it("parses strings, booleans, null, colors, identifiers", () => {
      expect(expr('"hello"')).toMatchObject({ type: "string", value: "hello" });
      expect(expr("true")).toMatchObject({ type: "boolean", value: true });
      expect(expr("false")).toMatchObject({ type: "boolean", value: false });
      expect(expr("null")).toMatchObject({ type: "null" });
      expect(expr("#0af")).toMatchObject({ type: "color", value: "#0af" });
      expect(expr("solid")).toMatchObject({ type: "identifier", name: "solid" });
    });

    it("parses string interpolation", () => {
      const s = expr('"ID is #{$todo.id}!"');
      expect(s.value).toBeNull();
      expect(s.parts[0]).toBe("ID is ");
      expect(s.parts[1].type).toBe("interpolation");
      expect(s.parts[1].expression).toMatchObject({
        type: "member",
        property: "id",
      });
      expect(s.parts[2]).toBe("!");
    });

    it("parses unquoted and quoted urls", () => {
      expect(expr("url(/img/kroger.png)")).toMatchObject({
        type: "url",
        parts: ["/img/kroger.png"],
      });
      const quoted = expr('url("a.png")');
      expect(quoted.type).toBe("function");
      expect(quoted.callee.name).toBe("url");
    });
  });

  describe("accessors (Quark deviations)", () => {
    it("parses dot accessor chains", () => {
      const e = expr("item.coordinate.lng");
      expect(e).toMatchObject({
        type: "member",
        property: "lng",
        object: {
          type: "member",
          property: "coordinate",
          object: { type: "identifier", name: "item" },
        },
      });
    });

    it("parses dot access on variables and calls", () => {
      expect(expr("$packageMeta.elementApis")).toMatchObject({
        type: "member",
        property: "elementApis",
        object: { type: "variable", name: "packageMeta" },
      });
      expect(expr("prop(\"provision\").body")).toMatchObject({
        type: "member",
        property: "body",
        object: { type: "function" },
      });
    });

    it("parses namespaced variables (math.$pi)", () => {
      expect(expr("math.$pi")).toMatchObject({
        type: "member",
        property: "pi",
        variable: true,
      });
    });

    it("parses bracket accessors", () => {
      expect(expr('$myObj["myField"]')).toMatchObject({
        type: "index",
        object: { type: "variable", name: "myObj" },
        index: { type: "string", value: "myField" },
      });
      expect(expr("$selectedTags[$tagIndex]").index).toMatchObject({
        type: "variable",
        name: "tagIndex",
      });
      expect(expr("prop(\"provision\").body.message[0]")).toMatchObject({
        type: "index",
        index: { type: "number", value: 0 },
      });
    });

    it("parses method calls on members", () => {
      const e = expr("item.status.toLowerCase()");
      expect(e.type).toBe("function");
      expect(e.callee).toMatchObject({
        type: "member",
        property: "toLowerCase",
      });
      expect(e.args).toEqual([]);
    });

    it("distinguishes index access from bracket lists by adjacency", () => {
      expect(expr("$a[0]").type).toBe("index");
      const list = expr("$a [0]");
      expect(list.type).toBe("list");
      expect(list.items[1]).toMatchObject({ type: "list", brackets: true });
    });
  });

  describe("functions", () => {
    it("parses calls with mixed arguments", () => {
      const e = expr('iterate($items, ":scope > template", "id")');
      expect(e.callee.name).toBe("iterate");
      expect(e.args).toHaveLength(3);
      expect(e.args[0].value).toMatchObject({ type: "variable", name: "items" });
      expect(e.args[1].value.value).toBe(":scope > template");
    });

    it("parses & as an argument (fn(&))", () => {
      expect(expr("fn(&)").args[0].value.type).toBe("parent_reference");
    });

    it("parses nested calls", () => {
      const e = expr("reverse(prop(\"provision\"))");
      expect(e.args[0].value.type).toBe("function");
    });

    it("parses named arguments and spreads", () => {
      const named = expr("corner($radius: 3px, $style: solid)");
      expect(named.args[0]).toMatchObject({ name: "radius", spread: false });
      expect(named.args[0].value).toMatchObject({ unit: "px" });
      expect(expr("apply($args...)").args[0].spread).toBe(true);
    });

    it("parses namespaced calls (math.div)", () => {
      const e = expr("math.div($a, $b)");
      expect(e.callee).toMatchObject({ type: "member", property: "div" });
    });
  });

  describe("operators", () => {
    it("applies arithmetic precedence", () => {
      const e = expr("1 + 2 * 3");
      expect(e).toMatchObject({
        type: "binary",
        operator: "+",
        right: { type: "binary", operator: "*" },
      });
    });

    it("parses string concatenation chains left-associatively", () => {
      const e = expr('"Index: " + index + ". ID: " + item.id');
      expect(e.operator).toBe("+");
      expect(e.right).toMatchObject({ type: "member", property: "id" });
      expect(e.left.operator).toBe("+");
    });

    it("parses comparisons and equality", () => {
      expect(expr("$maxUsers == 1").operator).toBe("==");
      expect(expr("$a != $b").operator).toBe("!=");
      expect(expr("$i < 5").operator).toBe("<");
      expect(expr("$i >= 5").operator).toBe(">=");
    });

    it("parses and/or/not with SCSS precedence", () => {
      const e = expr("$a == 1 or $b == 2 and not $c");
      expect(e.operator).toBe("or");
      expect(e.right.operator).toBe("and");
      expect(e.right.right).toMatchObject({ type: "unary", operator: "not" });
    });

    it("binds not looser than comparison", () => {
      const e = expr("not $a == $b");
      expect(e).toMatchObject({
        type: "unary",
        operator: "not",
        argument: { type: "binary", operator: "==" },
      });
    });

    it("parses unary minus on non-literals", () => {
      expect(expr("-$offset")).toMatchObject({
        type: "unary",
        operator: "-",
        argument: { type: "variable", name: "offset" },
      });
    });

    it("parses division and modulo", () => {
      expect(expr("(10 / 2)").operator).toBe("/");
      expect(expr("$i % 3").operator).toBe("%");
    });

    it("respects parentheses for grouping", () => {
      const e = expr("(1 + 2) * 3");
      expect(e.operator).toBe("*");
      expect(e.left.operator).toBe("+");
    });
  });

  describe("lists and maps", () => {
    it("parses space-separated lists", () => {
      const e = expr("10px 20px 30px");
      expect(e).toMatchObject({ type: "list", separator: " " });
      expect(e.items).toHaveLength(3);
    });

    it("parses space lists with signed numbers", () => {
      const e = expr("10px -5px");
      expect(e.items.map((i: any) => i.value)).toEqual([10, -5]);
    });

    it("sign spacing decides list vs addition ($x +1 is a list, $x + 1 adds)", () => {
      /* Whitespace before the sign but not after = a signed list item
       * (CSS `margin: 10px -5px`). Easy to trip over with `$sig.value + 1`. */
      expect(expr("$x +1")).toMatchObject({ type: "list", separator: " " });
      expect(expr("$x + 1")).toMatchObject({ type: "binary", operator: "+" });
      expect(expr("$x+1")).toMatchObject({ type: "binary", operator: "+" });
    });

    it("parses comma-separated lists", () => {
      const e = expr("first, second");
      expect(e).toMatchObject({ type: "list", separator: "," });
      expect(e.items).toHaveLength(2);
    });

    it("widens grouping spans to include the parens", () => {
      /* Consumers slice source by spans; `(1 + 2) * 3` must not become
       * `1 + 2) * 3`. */
      const src = "(1 + 2) * 3";
      const e = expr(src);
      expect(e).toMatchObject({ type: "binary", operator: "*" });
      expect(src.slice(e.left.start, e.left.end)).toBe("(1 + 2)");
    });

    it("parses parenthesized and bracketed lists", () => {
      expect(expr("(1, 2, 3)")).toMatchObject({
        type: "list",
        separator: ",",
        parens: true,
      });
      expect(expr("[1, 2, 3]")).toMatchObject({
        type: "list",
        brackets: true,
      });
      expect(expr("()")).toMatchObject({ type: "list", items: [] });
    });

    it("parses maps", () => {
      const e = expr('(key1: "value1", key2: 10px 20px)');
      expect(e.type).toBe("map");
      expect(e.entries).toHaveLength(2);
      expect(e.entries[0].key).toMatchObject({ name: "key1" });
      expect(e.entries[1].value.type).toBe("list");
    });

    it("parses nested maps", () => {
      const e = expr("(a: (b: 1))");
      expect(e.entries[0].value.type).toBe("map");
    });
  });

  describe("interpolation", () => {
    it("parses standalone interpolation", () => {
      expect(expr("#{$x + 1}")).toMatchObject({
        type: "interpolation",
        expression: { type: "binary", operator: "+" },
      });
    });
  });

  describe("CSS-style if()", () => {
    it("parses a condition arm and an else arm", () => {
      const e = expr('if($isOpen: "open"; else: "closed")');
      expect(e.type).toBe("if");
      expect(e.arms).toHaveLength(2);
      expect(e.arms[0].condition).toMatchObject({
        type: "variable",
        name: "isOpen",
      });
      expect(e.arms[0].value).toMatchObject({ type: "string", value: "open" });
      expect(e.arms[1].condition).toBeNull();
      expect(e.arms[1].value).toMatchObject({
        type: "string",
        value: "closed",
      });
    });

    it("parses multiple arms with complex conditions", () => {
      const e = expr(
        'if($count == 0: "none"; $count > 3 and $isActive: "many"; else: "few")',
      );
      expect(e.arms).toHaveLength(3);
      expect(e.arms[0].condition).toMatchObject({
        type: "binary",
        operator: "==",
      });
      expect(e.arms[1].condition).toMatchObject({
        type: "binary",
        operator: "and",
      });
      expect(e.arms[2].condition).toBeNull();
    });

    it("parses without an else arm and with a trailing semicolon", () => {
      const e = expr('if($x: 1;)');
      expect(e.arms).toHaveLength(1);
      expect(e.arms[0].condition).toMatchObject({ type: "variable" });
    });

    it("parses list values and nested if() in arms", () => {
      const list = expr("if($x: 1px solid, 2px dashed; else: none)");
      expect(list.arms[0].value).toMatchObject({
        type: "list",
        separator: ",",
      });
      const nested = expr('if($a: if($b: 1; else: 2); else: 3)');
      expect(nested.arms[0].value.type).toBe("if");
    });

    it("allows dot access on the if() result", () => {
      const e = expr("if($a: $x; else: $y).name");
      expect(e).toMatchObject({
        type: "member",
        property: "name",
        object: { type: "if" },
      });
    });

    it("parses colon-less if(...) as a regular function call", () => {
      const e = expr('if($cond, "yes", "no")');
      expect(e.type).toBe("function");
      expect(e.callee).toMatchObject({ type: "identifier", name: "if" });
      expect(e.args).toHaveLength(3);
    });

    it("ignores colons nested inside maps when detecting arms", () => {
      const e = expr("if((a: 1), 2, 3)");
      expect(e.type).toBe("function");
    });

    it("rejects arms after else", () => {
      expect(() => expr('if(else: 1; $x: 2)')).toThrow(QuarkParseError);
      expect(() => expr('if(else: 1; $x: 2)')).toThrow(/last arm/);
    });
  });

  describe("rejected JS-style syntax", () => {
    const bad = (src: string) =>
      expect(() => parse(src)).toThrow(QuarkParseError);

    it("rejects ternaries", () => {
      bad('a { b: $x ? "yes" : "no"; }');
    });

    it("rejects optional chaining", () => {
      bad("a { b: $x?.y; }");
    });

    it("rejects nullish coalescing", () => {
      bad("a { b: $x ?? 1; }");
    });

    it("rejects strict equality", () => {
      bad("a { b: $x === 1; }");
    });

    it("rejects logical || and &&", () => {
      bad('a { b: $x || "fallback"; }');
      bad("a { b: $x && $y; }");
    });

    it("rejects arrow functions", () => {
      bad("a { b: $list.filter(s => s.active); }");
    });

    it("mentions the unsupported syntax in the ternary error", () => {
      try {
        parse("a { b: $x ? 1 : 2; }");
        throw new Error("should have thrown");
      } catch (e: any) {
        expect(e.message).toMatch(/not supported/);
      }
    });
  });

  describe("errors", () => {
    it("reports line and column", () => {
      try {
        parse("a {\n  b: ?;\n}");
        throw new Error("should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(QuarkParseError);
        expect(e.line).toBe(2);
        expect(e.column).toBe(6);
      }
    });

    it("throws on unclosed blocks", () => {
      expect(() => parse("a { b: c;")).toThrow(/Unclosed block/);
    });
  });
});
