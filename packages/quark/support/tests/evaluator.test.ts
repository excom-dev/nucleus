/**
 * Expression evaluator, exercised directly against a hand-built scope so
 * every node type, operator and error path is reachable without a sheet.
 */
import { VALUE_MAP } from "../../src/constants";
import {
  collectAttrCalls,
  collectPropCalls,
  collectVariableNames,
  evaluateExpression,
  getExpressionAst,
  QuarkEvalError,
} from "../../src/evaluator";
import {
  describe,
  expect,
  it,
  vi,
} from "@excom/heft-rig/profiles/default/config/test-utils";

const element = document.createElement("div");

/** Evaluate `src` with `$vars` and bare `names` resolved from plain objects. */
const ev = (
  src: string,
  vars: Record<string, unknown> = {},
  names: Record<string, unknown> = {}
) =>
  evaluateExpression(getExpressionAst(src), {
    element,
    scope: {
      lookup(name) {
        if (name in VALUE_MAP) return VALUE_MAP[name];
        if (name.startsWith("$")) return vars[name.slice(1)];
        if (name in names) return names[name];
        throw new QuarkEvalError(`"${name}" is not defined`);
      },
    },
  });

describe("evaluator", () => {
  describe("literals", () => {
    it("caches parsed expressions per source string", () => {
      expect(getExpressionAst("1 + 1")).toBe(getExpressionAst("1 + 1"));
    });

    it("unescapes string literals", () => {
      expect(ev('"a\\nb\\tc\\rd\\"e"')).toBe('a\nb\tc\rd"e');
      expect(ev('"plain"')).toBe("plain");
    });

    it("interpolates strings, rendering null as empty", () => {
      expect(ev('"a #{$b} c\\n"', { b: 1 })).toBe("a 1 c\n");
      expect(ev('"[#{$missing}]"')).toBe("[]");
    });

    it("keeps units on numbers", () => {
      expect(ev("10px")).toBe("10px");
      expect(ev("3")).toBe(3);
    });

    it("evaluates colors, booleans and null", () => {
      expect(ev("#ccc")).toBe("#ccc");
      expect(ev("true")).toBe(true);
      expect(ev("false")).toBe(false);
      expect(ev("null")).toBeNull();
    });

    it("resolves identifiers and variables through the scope", () => {
      expect(ev("name", {}, { name: "n" })).toBe("n");
      expect(ev("$x", { x: 2 })).toBe(2);
      expect(ev("$unbound")).toBeUndefined();
      expect(() => ev("nope")).toThrow('"nope" is not defined');
    });

    it("resolves & to the element's tag name", () => {
      expect(ev("&")).toBe("div");
    });

    it("evaluates interpolations and unquoted urls", () => {
      expect(ev("#{$a}", { a: 7 })).toBe(7);
      expect(ev("url(/a/#{$b}/c)", { b: "x" })).toBe("/a/x/c");
      expect(ev("url(/a/#{$none}/c)")).toBe("/a//c");
    });

    it("builds lists and maps", () => {
      expect(ev("[1, 2]")).toEqual([1, 2]);
      expect(ev("(1, 2)")).toEqual([1, 2]);
      expect(ev('(a: 1, "b": 2, #{$k}: 3)', { k: "kk" })).toEqual({
        a: 1,
        b: 2,
        kk: 3,
      });
    });
  });

  describe("accessors", () => {
    it("reads members, namespaced $members and indexes", () => {
      expect(ev("$o.x", { o: { x: 1 } })).toBe(1);
      expect(ev("math.$pi", {}, { math: { $pi: 3 } })).toBe(3);
      expect(ev("$a[1]", { a: ["p", "q"] })).toBe("q");
      expect(ev('$o["x"]', { o: { x: "v" } })).toBe("v");
    });

    it("propagates null through members, indexes and method calls", () => {
      expect(ev("$n.x")).toBeUndefined();
      expect(ev("$n[0]")).toBeUndefined();
      expect(ev("$n.toUpperCase()")).toBeUndefined();
      expect(ev("null.x")).toBeUndefined();
    });
  });

  describe("calls", () => {
    it("calls module functions with spread and plain arguments", () => {
      const f = vi.fn((...args: unknown[]) => args);
      expect(ev("f($xs..., 1)", { xs: [1, 2] }, { f })).toEqual([1, 2, 1]);
      // a non-array spread is passed through as one argument
      expect(ev("f($x..., 1)", { x: "solo" }, { f })).toEqual(["solo", 1]);
      expect(ev("#{$g}(4)", { g: (n: number) => n * 2 })).toBe(8);
    });

    it("rejects non-function callees with a descriptive message", () => {
      expect(() => ev("nofn(1)", {}, { nofn: 3 })).toThrow(
        '"nofn" is not a function'
      );
      expect(() => ev("#{$g}(1)", { g: 3 })).toThrow(
        '"<expression>" is not a function'
      );
    });

    it("calls own-property functions on module namespaces", () => {
      expect(ev("api.version()", {}, { api: { version: () => "v2" } })).toBe(
        "v2"
      );
    });

    it("allows allowlisted prototype methods only", () => {
      expect(ev("$s.toUpperCase()", { s: "ab" })).toBe("AB");
      expect(ev('$l.join("-")', { l: ["a", "b"] })).toBe("a-b");
      expect(() => ev("$s.splice(0)", { s: "ab" })).toThrow(
        'Method "splice" is not allowed'
      );
      // allowlisted name that is not a function on this value
      expect(() => ev("$o.trim()", { o: { trim: 5 } })).toThrow(
        '"trim" is not a function'
      );
    });
  });

  describe("if()", () => {
    it("returns the first truthy arm, the else arm, or undefined", () => {
      expect(ev("if($a: 1; $b: 2; else: 3)", { a: 0, b: 1 })).toBe(2);
      expect(ev("if($a: 1; else: 3)", { a: 0 })).toBe(3);
      expect(ev("if($a: 1; $b: 2)", { a: 0, b: 0 })).toBeUndefined();
    });
  });

  describe("operators", () => {
    it("applies unary operators", () => {
      expect(ev("-$x", { x: 2 })).toBe(-2);
      expect(ev("+$x", { x: "3" })).toBe(3);
      expect(ev("not $x", { x: 0 })).toBe(true);
      expect(ev("not $x", { x: 1 })).toBe(false);
    });

    it("short-circuits and / or", () => {
      const boom = () => {
        throw new Error("evaluated");
      };
      expect(ev("$a and boom()", { a: 0 }, { boom })).toBe(0);
      expect(ev("$a and $b", { a: 1, b: "r" })).toBe("r");
      expect(ev("$a or boom()", { a: "l" }, { boom })).toBe("l");
      expect(ev("$a or $b", { a: 0, b: "r" })).toBe("r");
    });

    it("applies arithmetic", () => {
      expect(ev("1 + 2")).toBe(3);
      expect(ev("5 - 2")).toBe(3);
      expect(ev("2 * 3")).toBe(6);
      expect(ev("6 / 3")).toBe(2);
      expect(ev("7 % 3")).toBe(1);
    });

    it("applies comparisons (loose equality)", () => {
      expect(ev('1 == "1"')).toBe(true);
      expect(ev("1 != 2")).toBe(true);
      expect(ev("1 < 2")).toBe(true);
      expect(ev("2 <= 2")).toBe(true);
      expect(ev("3 > 2")).toBe(true);
      expect(ev("3 >= 4")).toBe(false);
    });
  });

  describe("malformed ASTs", () => {
    it("rejects unknown operators and unsupported node types", () => {
      const num = { type: "number", value: 1, unit: null, start: 0, end: 1 };
      const badOp = {
        type: "binary",
        operator: "**",
        left: num,
        right: num,
        start: 0,
        end: 1,
      } as any;
      expect(() =>
        evaluateExpression(badOp, { element, scope: { lookup: () => 0 } })
      ).toThrow('Unknown operator "**"');
      expect(() =>
        evaluateExpression({ type: "bogus" } as any, {
          element,
          scope: { lookup: () => 0 },
        })
      ).toThrow('Unsupported expression node "bogus"');
    });
  });

  describe("static analysis", () => {
    it("collects $variable names once each, through nested nodes", () => {
      expect(
        collectVariableNames(getExpressionAst("f($a, [$b, $a], (k: $c.$d))"))
      ).toEqual(["$a", "$b", "$c"]);
    });

    it("collects literal attr() / prop() names and flags dynamic ones", () => {
      expect(collectAttrCalls(null)).toEqual({
        names: [],
        hasNonLiteral: false,
      });
      expect(
        collectAttrCalls(getExpressionAst('attr("x") + attr($y)'))
      ).toEqual({ names: ["x"], hasNonLiteral: true });
      expect(
        collectPropCalls(getExpressionAst('prop("value").length'))
      ).toEqual({ names: ["value"], hasNonLiteral: false });
    });
  });
});
