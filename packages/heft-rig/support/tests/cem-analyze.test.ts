import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  analyzeSource,
  findMatchingAngle,
  findMatchingBrace,
  makeImportResolver,
} from "../../scripts/cem-analyze.mjs";

const FULL_SRC = `
import { ConstructorType, Neutron, TokenList } from "@excom/neutron";
import { BaseA } from "@excom/base-a";
import BaseB from "@excom/base-b";
import type { Opaque } from "some-lib";

export type Shape = { a: string; b: number };
export type FooEvent = CustomEvent & { type: "foo"; detail: Shape };
export type Thunk = () => void;

/**
 * A demo element that exercises every tag the analyzer knows about.
 *
 * @summary Demo element.
 *
 * @fires foo - Fired when foo happens.
 * @type FooEvent
 * @fires {tag}-bar
 * @listens submit - Listens for a submit.
 * @type SubmitEvent
 * @command --go - Goes there.
 * @command --stop
 * @command stop - not a custom command, ignored
 * @default-action foo - Does the foo thing.
 * @slot - Default slot.
 * @slot footer - Footer content.
 * @cssprop --demo-color - The color.
 * @child template - A template child.
 * @child ?option - An optional child.
 * @descendant button - Any button.
 * @unknown-tag ignored
 */
export const Demo = Neutron.compose([
  BaseA, // comment
  /* block */ BaseB,
  Opaque,
  "not-an-identifier",
  Neutron({
    tag: "demo-el",
    props: {
      /** short */
      undocumentedSummary: String,
      /**
       * @option
       * Plain string option.
       * @default hello
       */
      label: String,
      /**
       * @option
       * Inline object prop with inferred enum and default.
       */
      mode: {
        type: String,
        defaultValue: () => "eager",
        isValid: (v) => ["", "eager", "lazy"].includes(v),
      },
      /**
       * @option
       * Numeric default.
       */
      count: { type: Number, defaultValue: () => 3 },
      /**
       * @option
       * Boolean default.
       */
      flag: { type: Boolean, defaultValue: () => true },
      /**
       * @option
       * @state
       * Hybrid token list.
       */
      tokens: TokenList,
      /**
       * @state
       * Read-only state.
       */
      busy: Boolean,
      /**
       * @option
       * Manual values and default win.
       * @values "a" | b | 'c d' | \`e\`
       * @default "z"
       */
      pick: { type: String, isValid: (v) => ["x"].includes(v), defaultValue: () => "x" },
      /**
       * @option
       * Constructor generic.
       */
      shape: Object as ConstructorType<Shape>,
      /**
       * @option
       * Inline JSDoc type.
       * @type { x: number }
       */
      point: Object,
      /**
       * @option
       * Object without recognised ctor.
       */
      raw: Object,
      /**
       * @option
       * Unknown constructor stays a name.
       */
      custom: MyCtor,
      /**
       * @option
       * Inline object with no type key.
       */
      untyped: { defaultValue: () => ":scope > template" },
      /**
       * @option
       * Weird value with no leading identifier.
       */
      weird: (() => String)(),
      /**
       * @provision
       * Provision payload.
       * @type Shape
       * @default {}
       */
      provision: Object as unknown as ConstructorType<Shape>,
      /**
       * @option
       * Not an attribute.
       */
      hidden: { type: String, attr: false },
      /** private-ish */
      _internal: String,
      // line comment
      /* plain block comment */
      noComment: String,
      /**
       * @option
       * Arrow default containing =>.
       */
      cb: { type: Object, defaultValue: () => () => 1 },
      /**
       * @option
       * Multi-line tag body with default-action lookalike.
       * @default-action nope
       */
      last: String
    },
  }),
]).defineMethods({});
`;

const resolveImport = makeImportResolver(FULL_SRC);

describe("analyzeSource — full surface", () => {
  const cem = analyzeSource(FULL_SRC, { modulePath: "demo-el.ts", resolveImport });
  const decl = cem!.modules[0].declarations[0];
  const attr = (name: string) => decl.attributes.find((a: any) => a.name === name);
  const field = (name: string) => decl.members.find((m: any) => m.name === name);

  it("emits a spec-shaped module with class + definition exports", () => {
    expect(cem!.schemaVersion).toBe("1.0.0");
    const mod = cem!.modules[0];
    expect(mod.kind).toBe("javascript-module");
    expect(mod.path).toBe("demo-el.ts");
    expect(mod.exports).toEqual([
      { kind: "js", name: "Demo", declaration: { name: "Demo", module: "demo-el.ts" } },
      {
        kind: "custom-element-definition",
        name: "demo-el",
        declaration: { name: "Demo", module: "demo-el.ts" },
      },
    ]);
    expect(decl.kind).toBe("class");
    expect(decl.customElement).toBe(true);
    expect(decl.tagName).toBe("demo-el");
    expect(decl.name).toBe("Demo");
  });

  it("records only resolvable composed bases as mixins", () => {
    expect(decl.mixins).toEqual([
      { name: "BaseA", package: "@excom/base-a" },
      { name: "BaseB", package: "@excom/base-b" },
    ]);
  });

  it("collects summary and description", () => {
    expect(decl.summary).toBe("Demo element.");
    expect(decl.description).toBe(
      "A demo element that exercises every tag the analyzer knows about.",
    );
  });

  it("collects events with `@type` attached only to the preceding `@fires`", () => {
    expect(decl.events).toEqual([
      {
        name: "foo",
        description: "Fired when foo happens.",
        type: { text: "FooEvent", expanded: 'CustomEvent & { type: "foo"; detail: { a: string; b: number } }' },
      },
      { name: "{tag}-bar", description: "" },
    ]);
  });

  it("collects listens, default actions, slots, css props and children", () => {
    expect(decl._neutron.listens).toEqual([
      { name: "submit", description: "Listens for a submit.", type: { text: "SubmitEvent" } },
    ]);
    expect(decl._neutron.commands).toEqual([
      { name: "--go", description: "Goes there." },
      { name: "--stop", description: "" },
    ]);
    expect(decl._neutron.defaultActions).toEqual([
      { name: "foo", description: "Does the foo thing." },
      { name: "nope", description: "" },
    ]);
    expect(decl.slots).toEqual([
      { name: "-", description: "Default slot." },
      { name: "footer", description: "Footer content." },
    ]);
    expect(decl.cssProperties).toEqual([{ name: "--demo-color", description: "The color." }]);
    expect(decl._neutron.expectedChildren).toEqual([
      { relationship: "child", selector: "template", required: true, description: "A template child." },
      { relationship: "child", selector: "option", required: false, description: "An optional child." },
      { relationship: "descendant", selector: "button", required: true, description: "Any button." },
    ]);
  });

  it("maps primitive constructors and reads `@default`", () => {
    expect(attr("label")).toEqual({
      name: "label",
      type: { text: "string" },
      description: "Plain string option.",
      fieldName: "label",
      default: "hello",
    });
    expect(attr("tokens").type).toEqual({ text: "tokenlist" });
    expect(attr("busy").type).toEqual({ text: "boolean" });
  });

  it("infers enum values and typed defaults from inline objects", () => {
    expect(attr("mode")).toMatchObject({
      type: { text: "string" },
      default: "eager",
      values: ["", "eager", "lazy"],
    });
    expect(attr("count").default).toBe(3);
    expect(attr("flag").default).toBe(true);
  });

  it("lets manual `@values` / `@default` win over inferred ones", () => {
    expect(attr("pick").values).toEqual(["a", "b", "c d", "e"]);
    expect(attr("pick").default).toBe("z");
  });

  it("resolves `ConstructorType<…>`, `@type {…}`, and widened fallbacks", () => {
    expect(attr("shape").type).toEqual({
      text: "Shape",
      expanded: "{ a: string; b: number }",
    });
    expect(attr("point").type).toEqual({ text: "object", expanded: "{ x: number }" });
    expect(attr("raw").type).toEqual({ text: "object" });
    expect(attr("custom").type).toEqual({ text: "MyCtor" });
    expect(attr("untyped").type).toEqual({ text: "object" });
    expect(attr("untyped").default).toBe(":scope > template");
    expect(attr("weird").type).toEqual({ text: "object" });
    expect(attr("cb")).toMatchObject({ type: { text: "object" } });
    expect(attr("cb").default).toBeUndefined();
  });

  it("does not treat `@default-action` as `@default`", () => {
    expect(attr("last").default).toBeUndefined();
    expect(attr("last").description).toBe(
      "Multi-line tag body with default-action lookalike. @default-action nope",
    );
  });

  it("kebab-cases attribute names", () => {
    expect(attr("undocumented-summary")).toBeDefined();
  });

  it("moves `@provision` props out of attributes into `_neutron.provisions`", () => {
    expect(attr("provision")).toBeUndefined();
    expect(decl._neutron.provisions).toEqual([
      {
        name: "provision",
        type: { text: "Shape", expanded: "{ a: string; b: number }" },
        description: "Provision payload.",
        fieldName: "provision",
        default: "{}",
      },
    ]);
    expect(field("provision").default).toBe("{}");
  });

  it("skips undocumented, private, and `attr: false` props", () => {
    for (const name of ["hidden", "_internal", "noComment", "no-comment"]) {
      expect(attr(name)).toBeUndefined();
      expect(field(name)).toBeUndefined();
    }
  });

  it("records surfaces on members and marks pure state readonly", () => {
    expect(field("label")).toMatchObject({
      kind: "field",
      privacy: "public",
      readonly: false,
      _neutron: { surface: "option" },
    });
    expect(field("tokens")._neutron.surface).toBe("hybrid");
    expect(field("tokens").readonly).toBe(false);
    expect(field("busy")._neutron.surface).toBe("state");
    expect(field("busy").readonly).toBe(true);
    expect(field("undocumentedSummary")._neutron.surface).toBe("option");
  });
});

describe("analyzeSource — element detection edge cases", () => {
  it("returns undefined when there is no Neutron call or no tag", () => {
    expect(analyzeSource("export const x = 1;", { modulePath: "x.ts" })).toBeUndefined();
    expect(
      analyzeSource("const A = Neutron({ props: { a: String } });", { modulePath: "x.ts" }),
    ).toBeUndefined();
    expect(analyzeSource("Neutron({ tag: ", { modulePath: "x.ts" })).toBeUndefined();
    expect(
      analyzeSource("Neutron({ tag: 'a-b', props: { a: String }", { modulePath: "x.ts" }),
    ).toBeUndefined();
  });

  it("emits a mixin declaration for `noop-tag` without a definition export", () => {
    const cem = analyzeSource(
      `/** Base element that adds routing. */\nexport const RoutableElement = Neutron({ tag: "noop-tag", props: {} });`,
      { modulePath: "routable-element.ts" },
    );
    const mod = cem!.modules[0];
    expect(mod.declarations[0]).toEqual({
      kind: "mixin",
      name: "RoutableElement",
      description: "Base element that adds routing.",
    });
    expect(mod.exports).toHaveLength(1);
  });

  it("derives a name from the module path when nothing is exported", () => {
    const cem = analyzeSource(`const el = Neutron({ tag: "my-thing" });`, {
      modulePath: "src/my-thing.element.ts",
    });
    expect(cem!.modules[0].declarations[0].name).toBe("MyThingElement");
  });

  it("handles a bare compose without bases and unbalanced props", () => {
    const cem = analyzeSource(
      `export const X = Neutron.compose([ Neutron({ tag: "x-y", props: { /** @option doc */ a: String } }) ]);`,
      { modulePath: "x-y.ts", resolveImport: () => undefined },
    );
    expect(cem!.modules[0].declarations[0].mixins).toBeUndefined();
    expect(cem!.modules[0].declarations[0].attributes).toHaveLength(1);

    const noProps = analyzeSource(`Neutron({ tag: "x-y", props: { a: String })`, {
      modulePath: "x.ts",
    });
    expect(noProps).toBeUndefined();
  });

  it("ignores `.compose(` without an opening bracket", () => {
    const cem = analyzeSource(`const X = Neutron.compose(Neutron({ tag: "x-y" }));`, {
      modulePath: "x.ts",
      resolveImport: () => ({ package: "p" }),
    });
    expect(cem!.modules[0].declarations[0].mixins).toBeUndefined();
  });

  it("widens an unclosed `ConstructorType<` to the plain constructor", () => {
    const cem = analyzeSource(
      `Neutron({ tag: "x-y", props: { /** @option doc */ a: Object as ConstructorType<Shape } })`,
      { modulePath: "x.ts" },
    );
    expect(cem!.modules[0].declarations[0].attributes[0].type).toEqual({ text: "object" });
  });

  it("skips prop-like tokens that are not followed by a colon", () => {
    const cem = analyzeSource(
      `Neutron({ tag: "x-y", props: { /** @option doc */ a: String, get, /* c */ b: Number } })`,
      { modulePath: "x.ts" },
    );
    expect(cem!.modules[0].declarations[0].attributes.map((a: any) => a.name)).toEqual(["a"]);
  });

  it("ignores a `@type` that has no preceding event tag", () => {
    const cem = analyzeSource(
      `/**\n * Some long enough description here.\n * @type Foo\n * @fires x\n */\nNeutron({ tag: "x-y" })`,
      { modulePath: "x.ts" },
    );
    expect(cem!.modules[0].declarations[0].events).toEqual([{ name: "x", description: "" }]);
  });

  it("does not leak a prop `@type` onto the last class-level event", () => {
    const src = `
      /**
       * @fires ping - ping
       */
      Neutron({ tag: "x-y", props: {
        /**
         * @option
         * @type Foo
         */
        a: Object,
      } })`;
    const decl = analyzeSource(src, { modulePath: "x.ts" })!.modules[0].declarations[0];
    expect(decl.events[0].type).toBeUndefined();
    expect(decl.attributes[0].type).toEqual({ text: "Foo" });
  });

  it("only uses the first summary and a sufficiently long description", () => {
    const src = `
      /** tiny */
      /** @summary First */
      /** @summary Second */
      /** This description is long enough to count. */
      Neutron({ tag: "x-y" })`;
    const decl = analyzeSource(src, { modulePath: "x.ts" })!.modules[0].declarations[0];
    expect(decl.summary).toBe("First");
    expect(decl.description).toBe("This description is long enough to count.");
  });

  it("drops unresolved `@type` on events and empty `@values`", () => {
    const src = `
      /**
       * @fires foo
       * @type
       */
      Neutron({ tag: "x-y", props: {
        /**
         * @option
         * @values
         */
        a: String,
        /**
         * @option
         * @default
         */
        b: { type: Number, defaultValue: () => -1.5 },
      } })`;
    const decl = analyzeSource(src, { modulePath: "x.ts" })!.modules[0].declarations[0];
    expect(decl.events[0].type).toBeUndefined();
    expect(decl.attributes[0].values).toBeUndefined();
    expect(decl.attributes[1].default).toBe(-1.5);
  });

  it("parses escaped string literals in defaults", () => {
    const src = `Neutron({ tag: "x-y", props: {
      /** @option esc */
      a: { type: String, defaultValue: () => "a\\"b\\n" },
      /** @option raw */
      b: { type: String, defaultValue: () => 'it\\'s' },
    } })`;
    const decl = analyzeSource(src, { modulePath: "x.ts" })!.modules[0].declarations[0];
    expect(decl.attributes[0].default).toBe('a"b\n');
    expect(decl.attributes[1].default).toBe("it's");
  });
});

describe("makeImportResolver", () => {
  it("maps named, aliased and default workspace imports only", () => {
    const resolve = makeImportResolver(`
      import { A, B as Bee } from "@excom/one";
      import type { T } from '@excom/two';
      import Def from "@excom/three";
      import { X } from "other";
      import { } from "@excom/empty";
    `);
    expect(resolve("A")).toEqual({ package: "@excom/one" });
    expect(resolve("Bee")).toEqual({ package: "@excom/one" });
    expect(resolve("B")).toBeUndefined();
    expect(resolve("T")).toEqual({ package: "@excom/two" });
    expect(resolve("Def")).toEqual({ package: "@excom/three" });
    expect(resolve("X")).toBeUndefined();
  });
});

describe("re-exported brace helpers", () => {
  it("are the cem-types implementations", () => {
    expect(findMatchingBrace("{ { } }", 0)).toBe(6);
    expect(findMatchingAngle("<a<b>>", 0)).toBe(5);
  });
});

describe("real workspace: spa-route", () => {
  const root = path.resolve(__dirname, "../../../spa-route");
  const src = readFileSync(path.join(root, "spa-route.ts"), "utf8");
  const cem = analyzeSource(src, {
    modulePath: "spa-route.ts",
    packageRoot: root,
    resolveImport: makeImportResolver(src),
  });
  const decl = cem!.modules[0].declarations[0];

  it("registers the element with its composed bases", () => {
    expect(decl.tagName).toBe("spa-route");
    expect(decl.mixins).toEqual([
      { name: "RenderableElement", package: "@excom/renderable-element" },
      { name: "RoutableElement", package: "@excom/routable-element" },
    ]);
  });

  it("expands the event type through the neutron barrel", () => {
    const evt = decl.events.find((e: any) => e.name === "spa-route-provision");
    expect(evt.type.text).toBe("SpaRouteProvisionEvent");
    expect(evt.type.expanded).toBe(
      'CustomEvent & { type: "spa-route-provision"; detail: () => void; bubbles: true; cancelable: true; composed: true }',
    );
  });

  it("routes the provision prop into provisions with an expanded workspace type", () => {
    expect(decl.attributes.some((a: any) => a.fieldName === "provision")).toBe(false);
    const prov = decl._neutron.provisions[0];
    expect(prov.name).toBe("provision");
    expect(prov.type.text).toBe("SpaRouteProvision");
    expect(prov.type.expanded).toContain("routeHref: string");
    expect(prov.type.expanded).toContain("active: {");
  });
});
