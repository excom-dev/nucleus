import { parse, parseSelectorList, QuarkParseError } from "../../index";
import type { Rule, Stylesheet } from "../../index";
import {
  describe,
  expect,
  it,
} from "@excom/heft-rig/profiles/default/config/test-utils";

/** Returns the parts of the first selector of the first rule. */
const sel = (selector: string): any[] => {
  const sheet: Stylesheet = parse(`${selector} { x: y; }`);
  return (sheet.body[0] as Rule).selector.selectors[0].parts as any[];
};

describe("selectors", () => {
  it("parses compound selectors with attributes", () => {
    const parts = sel("provider-fetch[api-url*='settings'][is-success]");
    expect(parts.map((p) => p.type)).toEqual([
      "type_selector",
      "attribute_selector",
      "attribute_selector",
    ]);
    expect(parts[0].name).toBe("provider-fetch");
    expect(parts[1]).toMatchObject({
      name: "api-url",
      operator: "*=",
    });
    expect(parts[1].value.value).toBe("settings");
    expect(parts[2]).toMatchObject({ name: "is-success", operator: null });
  });

  it("parses descendant combinators from whitespace", () => {
    const parts = sel("dialog[open] input");
    expect(parts.map((p) => p.type)).toEqual([
      "type_selector",
      "attribute_selector",
      "combinator",
      "type_selector",
    ]);
    expect(parts[2].value).toBe(" ");
  });

  it("parses explicit combinators", () => {
    expect(sel("ul > li").map((p: any) => p.value ?? p.name)).toEqual([
      "ul",
      ">",
      "li",
    ]);
    expect(sel("a ~ b")[1].value).toBe("~");
    expect(sel("a + b")[1].value).toBe("+");
    expect(sel("> li")[0]).toMatchObject({ type: "combinator", value: ">" });
  });

  it("parses all attribute operators and modifiers", () => {
    expect(sel('[a="v"]')[0].operator).toBe("=");
    expect(sel('[a*="v"]')[0].operator).toBe("*=");
    expect(sel('[a^="v"]')[0].operator).toBe("^=");
    expect(sel('[a$="v"]')[0].operator).toBe("$=");
    expect(sel('[a|="v"]')[0].operator).toBe("|=");
    expect(sel('[a~="v"]')[0].operator).toBe("~=");
    expect(sel('[a="v" i]')[0].modifier).toBe("i");
    expect(sel("[a=v]")[0].value).toMatchObject({
      type: "identifier",
      name: "v",
    });
  });

  it("parses :not() with a nested selector list", () => {
    const parts = sel("details:not([open])");
    const pseudo = parts[1];
    expect(pseudo.type).toBe("pseudo_class_selector");
    expect(pseudo.name).toBe("not");
    expect(pseudo.argument.type).toBe("selector_list");
    expect(pseudo.argument.selectors[0].parts[0].type).toBe(
      "attribute_selector",
    );
  });

  it("parses non-selector pseudo arguments as raw", () => {
    const parts = sel("li:nth-child(2n+1)");
    expect(parts[1].argument).toMatchObject({ type: "raw", value: "2n+1" });
  });

  it("parses pseudo-elements", () => {
    const parts = sel("a::before");
    expect(parts[1]).toMatchObject({
      type: "pseudo_element_selector",
      name: "before",
    });
  });

  it("parses classes, ids, and universal", () => {
    expect(sel(".user-icon-small")[0]).toMatchObject({
      type: "class_selector",
      name: "user-icon-small",
    });
    expect(sel("#refresh-btn")[0]).toMatchObject({
      type: "id_selector",
      name: "refresh-btn",
    });
    expect(sel("*")[0]).toMatchObject({ type: "type_selector", name: "*" });
  });

  it("parses parent selectors with and without suffixes", () => {
    expect(sel("&[is-loaded]").map((p: any) => p.type)).toEqual([
      "parent_selector",
      "attribute_selector",
    ]);
    expect(sel("&-modifier")[0]).toMatchObject({
      type: "parent_selector",
      suffix: "-modifier",
    });
  });

  it("parses selector lists", () => {
    const sheet = parse("a, b[open], .c { x: y; }") as any;
    const list = sheet.body[0].selector;
    expect(list.selectors).toHaveLength(3);
    expect(list.selectors[1].parts[0].name).toBe("b");
  });

  it("parses nested rules and resolves statements correctly", () => {
    const sheet = parse(`
      main {
        $msg: "nested-ok";
        section {
          [bind-msg] { content: $msg; }
        }
      }
    `) as any;
    const main = sheet.body[0];
    expect(main.type).toBe("rule");
    expect(main.block.body[0].type).toBe("declaration");
    const section = main.block.body[1];
    expect(section.type).toBe("rule");
    expect(section.block.body[0].selector.selectors[0].parts[0].type).toBe(
      "attribute_selector",
    );
  });

  it("parses multi-line grouped selectors with parent references", () => {
    const sheet = parse(`
      service-worker {
        &[is-ready],
        &[is-mounted]:not([is-supported]) {
          x: y;
        }
      }
    `) as any;
    const inner = sheet.body[0].block.body[0];
    expect(inner.selector.selectors).toHaveLength(2);
    expect(inner.selector.selectors[1].parts.map((p: any) => p.type)).toEqual([
      "parent_selector",
      "attribute_selector",
      "pseudo_class_selector",
    ]);
  });

  it("parses standalone selector lists via parseSelectorList", () => {
    const src = `div:not(.red) span, [bind-title]`;
    const list = parseSelectorList(src);
    expect(list.selectors).toHaveLength(2);
    expect(src.slice(list.selectors[0].start, list.selectors[0].end)).toBe(
      "div:not(.red) span",
    );
    expect(list.selectors[1].parts[0].type).toBe("attribute_selector");
    expect(() => parseSelectorList("div { x: y; }")).toThrow(QuarkParseError);
  });
});
