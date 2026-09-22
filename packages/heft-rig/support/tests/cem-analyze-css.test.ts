import { describe, expect, it } from "vitest";
import {
  aliasKind,
  analyzeCss,
  extractMixinCustomProperties,
  mergeCssDocsIntoDeclaration,
  parseCustomSelectors,
  splitSelectorList,
} from "../../scripts/cem-analyze-css.mjs";

const CSS = `
/**
 * @element super-input
 */
/**
 * Accent color for the control chrome.
 * @cssproperty
 * @syntax <color>
 * @default var(--v-primary, blue)
 * @summary Accent
 */
--super-input-primary: var(--v-primary, blue);

/**
 * Inferred from the next declaration.
 * @cssprop
 */
// line comment
/* block comment */
--super-input-gap: 4px;

/**
 * Named explicitly, no next decl.
 * @cssproperty --explicit
 * @default
 */
.something { }

/**
 * @cssproperty
 */
.no-name-here { }

/**
 * Floating-label appearance.
 * @cssclass
 */
&.raised { }

/**
 * Named class.
 * @cssclass .named
 */
--unused: 1;

/**
 * @cssclass
 */
super-input.host-class, .other { }

/**
 * @cssclass
 */
&:has(.x) .via-has { }

/**
 * @cssclass
 */
--no-class-name: 1;

/**
 * Hidden.
 * @internal
 * @cssclass
 */
&.secret { }

/**
 * Ignored too.
 * @ignore
 * @cssproperty
 */
--secret: 1;

/**
 * Host alias — style without registering the element.
 * @cssalias
 * @summary Host
 */
@custom-selector :--super-input super-input, .tag-super-input;

/**
 * @cssalias
 */
.not-a-selector { }

/**
 * @element other-element
 */
@custom-selector :--super-input--raised :--super-input.raised;
@custom-selector :--empty ;
@custom-selector :--nested :is(a, b), [data-x="1,2"], .c;
@custom-selector :--braces :where({ , }), .d;

/**
 * Tag with no body.
 * @unknown
 */
`;

describe("analyzeCss", () => {
  const api = analyzeCss(CSS);

  it("binds the stylesheet to the first `@element`", () => {
    expect(api.element).toBe("super-input");
  });

  it("collects css properties from tags and following declarations", () => {
    expect(api.cssProperties).toEqual([
      {
        name: "--super-input-primary",
        description: "Accent color for the control chrome.",
        summary: "Accent",
        syntax: "<color>",
        default: "var(--v-primary, blue)",
      },
      { name: "--super-input-gap", description: "Inferred from the next declaration.", default: "4px" },
      { name: "--explicit", description: "Named explicitly, no next decl." },
    ]);
  });

  it("collects css classes from `&.`, `.name`, tag and `:has()` forms", () => {
    expect(api.cssClasses).toEqual([
      { name: "raised", description: "Floating-label appearance." },
      { name: "named", description: "Named class." },
      { name: "host-class" },
      { name: "via-has" },
    ]);
  });

  it("collects documented aliases first, then auto-parsed ones", () => {
    expect(api.cssAliases).toEqual([
      {
        name: ":--super-input",
        selectors: ["super-input", ".tag-super-input"],
        kind: "element",
        description: "Host alias — style without registering the element.",
        summary: "Host",
      },
      { name: ":--super-input--raised", selectors: [":--super-input.raised"], kind: "state" },
      { name: ":--nested", selectors: [":is(a, b)", '[data-x="1,2"]', ".c"], kind: "element" },
      { name: ":--braces", selectors: [":where({ , })", ".d"], kind: "element" },
    ]);
  });

  it("omits `element` when no stylesheet binds one", () => {
    expect(analyzeCss("/**\n * @cssclass\n */\n.x {}")).toEqual({
      cssProperties: [],
      cssClasses: [{ name: "x" }],
      cssAliases: [],
    });
    expect(analyzeCss("")).toEqual({ cssProperties: [], cssClasses: [], cssAliases: [] });
  });

  it("prefixes `--` on tag-named properties and handles unterminated comments", () => {
    const api2 = analyzeCss("/**\n * @cssproperty --x\n */\n/* never closed\n.y {}");
    expect(api2.cssProperties).toEqual([{ name: "--x" }]);
    const api3 = analyzeCss("/** @cssproperty */\n// only a line comment");
    expect(api3.cssProperties).toEqual([]);
  });
});

describe("selector helpers", () => {
  it("splits on top-level commas only", () => {
    expect(splitSelectorList("a, :is(b, c), [x=\"1,2\"], {d,e} , ,")).toEqual([
      "a",
      ":is(b, c)",
      '[x="1,2"]',
      "{d,e}",
    ]);
    expect(splitSelectorList(") ] } a")).toEqual([") ] } a"]);
    expect(splitSelectorList("")).toEqual([]);
  });

  it("parses custom selectors and infers alias kinds", () => {
    expect(parseCustomSelectors("@custom-selector :--a a; @custom-selector :--a--b .b;")).toEqual([
      { name: ":--a", selectors: ["a"], kind: "element" },
      { name: ":--a--b", selectors: [".b"], kind: "state" },
    ]);
    expect(aliasKind("plain")).toBe("element");
    expect(aliasKind("plain--state")).toBe("state");
  });
});

describe("extractMixinCustomProperties", () => {
  const css = `
    @define-mixin scheme-constants { --a: 1; --b: 2; }
    @define-mixin scheme-light { --a: light; --c: 3; }
    @define-mixin scheme-dark { --a: dark; }
    @define-mixin scheme-broken { --z: 9;
    @define-mixin other-thing { --o: 1; }
  `;

  it("harvests later-wins tokens and skips dark schemes", () => {
    expect(extractMixinCustomProperties(css)).toEqual([
      { name: "--a", default: "light" },
      { name: "--b", default: "2" },
      { name: "--c", default: "3" },
    ]);
  });

  it("supports a custom prefix (regex-escaped)", () => {
    expect(extractMixinCustomProperties(css, "other-")).toEqual([{ name: "--o", default: "1" }]);
    expect(extractMixinCustomProperties(css, "(none")).toEqual([]);
  });
});

describe("mergeCssDocsIntoDeclaration", () => {
  it("is a no-op without inputs or without css docs", () => {
    expect(mergeCssDocsIntoDeclaration(undefined, {})).toBeUndefined();
    const decl: any = { name: "x" };
    mergeCssDocsIntoDeclaration(decl, { cssProperties: [], cssClasses: [], cssAliases: [] });
    expect(decl).toEqual({ name: "x" });
    mergeCssDocsIntoDeclaration(decl, undefined);
    expect(decl).toEqual({ name: "x" });
  });

  it("merges by name with CSS entries winning", () => {
    const decl: any = {
      cssProperties: [{ name: "--a", description: "from jsdoc" }],
    };
    mergeCssDocsIntoDeclaration(decl, {
      cssProperties: [{ name: "--a", default: "1" }, { name: "--b" }],
      cssClasses: [{ name: "c" }],
      cssAliases: [{ name: ":--x", selectors: ["x"], kind: "element" }],
    });
    expect(decl.cssProperties).toEqual([
      { name: "--a", description: "from jsdoc", default: "1" },
      { name: "--b" },
    ]);
    expect(decl._neutron.cssClasses).toEqual([{ name: "c" }]);
    expect(decl._neutron.cssAliases).toEqual([{ name: ":--x", selectors: ["x"], kind: "element" }]);

    mergeCssDocsIntoDeclaration(decl, {
      cssClasses: [{ name: "c", description: "desc" }],
      cssAliases: [{ name: ":--x", description: "d" }],
    });
    expect(decl._neutron.cssClasses).toEqual([{ name: "c", description: "desc" }]);
    expect(decl._neutron.cssAliases).toEqual([
      { name: ":--x", selectors: ["x"], kind: "element", description: "d" },
    ]);
  });
});
