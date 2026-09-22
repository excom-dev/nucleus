import { describe, expect, it } from "vitest";
import { allDeclarations, firstDeclaration, flattenCem } from "../../scripts/cem-flatten.mjs";

const baseCem = (decl: object) => ({
  schemaVersion: "1.0.0",
  modules: [{ path: "base.ts", declarations: [decl] }],
});

const mixinA = baseCem({
  kind: "mixin",
  name: "MixinA",
  attributes: [
    { name: "from-a", type: { text: "string" }, fieldName: "fromA" },
    { name: "zeta", type: "number", fieldName: "zeta" },
  ],
  members: [{ kind: "field", name: "fromA", readonly: true }],
  events: [{ name: "{tag}-a-event", description: "From {tag}." }],
  mixins: [
    { name: "MixinB", package: "@excom/mixin-b" },
    { name: "Local" },
    { name: "Missing", package: "@excom/missing" },
  ],
});

const mixinB = baseCem({
  kind: "mixin",
  name: "MixinB",
  slots: [{ name: "b-slot" }],
  mixins: [{ name: "MixinA", package: "@excom/mixin-a" }],
});

const resolve = (pkg: string) =>
  ({ "@excom/mixin-a": mixinA, "@excom/mixin-b": mixinB } as Record<string, object>)[pkg];

const elementCem = {
  schemaVersion: "1.0.0",
  modules: [
    {
      path: "el.ts",
      declarations: [
        {
          kind: "class",
          customElement: true,
          tagName: "my-el",
          name: "MyEl",
          summary: "Summary.",
          attributes: [
            {
              name: "count",
              type: { text: "number" },
              description: "Count.",
              fieldName: "count",
              default: "3",
              values: [1, "", "two words", true, "1.5", "false", "a-b.c"],
            },
            { name: "on", type: { text: "boolean" }, fieldName: "on", default: "true" },
            { name: "off", type: { text: "boolean" }, fieldName: "off", default: "false" },
            { name: "odd", type: { text: "boolean" }, fieldName: "odd", default: "maybe" },
            { name: "n", type: { text: "number" }, fieldName: "n", default: "x" },
            { name: "no-field", type: { text: "string" } },
            { name: "alpha", type: { text: "string", expanded: "{ a: 1 }" }, fieldName: "alpha" },
            { name: "state-y", fieldName: "stateY", default: 7 },
            { name: "hyb", fieldName: "hyb" },
            { name: "legacy", fieldName: "legacy" },
          ],
          members: [
            { kind: "field", name: "count", _neutron: { surface: "option" } },
            { kind: "field", name: "stateY", readonly: true },
            { kind: "field", name: "hyb", _neutron: { surface: "hybrid" } },
            { kind: "method", name: "legacy" },
          ],
          events: [
            { name: "{tag}-change", description: "Changed on {tag}.", type: { text: "E", expanded: "X" } },
            { name: "a-first" },
          ],
          slots: [{ name: "z" }, { name: "a", description: "A." }],
          cssProperties: [{ name: "--b", syntax: "<color>", default: "red" }, { name: "--a" }],
          _neutron: {
            cssClasses: [{ name: "raised" }],
            cssAliases: [{ name: ":--my-el", selectors: ["my-el"] }, { name: ":--my-el--on" }],
            listens: [{ name: "{tag}-listen", description: "d", type: "string" }],
            commands: [{ name: "--z" }, { name: "--go", description: "Go, {tag}." }],
            defaultActions: [{ name: "my-el-change", description: "Applies." }, { name: "nothing" }],
            expectedChildren: [
              { relationship: "child", selector: "template", required: true },
              { relationship: "descendant", selector: "button", required: false, description: "B" },
            ],
            provisions: [
              { name: "provision", type: { text: "P", expanded: "{ p: 1 }" }, fieldName: "provision", default: "{}" },
              { name: "other", type: null },
            ],
          },
          mixins: [{ name: "MixinA", package: "@excom/mixin-a" }],
        },
      ],
    },
  ],
};

describe("declaration helpers", () => {
  it("find first / all declarations defensively", () => {
    expect(firstDeclaration(undefined)).toBeUndefined();
    expect(firstDeclaration({ modules: [] })).toBeUndefined();
    expect(allDeclarations(undefined)).toEqual([]);
    expect(allDeclarations({ modules: [{}, { declarations: [{ name: "x" }] }] })).toEqual([
      { name: "x" },
    ]);
  });
});

describe("flattenCem", () => {
  const [api] = flattenCem(elementCem, resolve);

  it("lifts declaration metadata", () => {
    expect(api.tag).toBe("my-el");
    expect(api.summary).toBe("Summary.");
    expect(api.kind).toBe("class");
  });

  it("flattens attributes with surface, coerced defaults, values and types", () => {
    const byName = Object.fromEntries(api.attributes.map((a: any) => [a.name, a]));
    expect(byName.count).toEqual({
      name: "count",
      type: "number",
      description: "Count.",
      fieldName: "count",
      surface: "option",
      default: "3",
      values: '1 | "" | two words | true | "1.5" | "false" | "a-b.c"',
    });
    expect(byName.on.default).toBe("true");
    expect(byName.off.default).toBe("false");
    expect(byName.odd.default).toBe('"maybe"');
    expect(byName.n.default).toBe('"x"');
    expect(byName["no-field"].surface).toBe("option");
    expect(byName.alpha.typeExpanded).toBe("{ a: 1 }");
    expect(byName["state-y"]).toMatchObject({ surface: "state", default: "7" });
    expect(byName["state-y"].type).toBeUndefined();
    expect(byName.hyb.surface).toBe("hybrid");
    expect(byName.legacy.surface).toBe("option");
  });

  it("orders attributes option → hybrid → state, then by name", () => {
    expect(api.attributes.map((a: any) => `${a.surface}:${a.name}`)).toEqual([
      "option:alpha",
      "option:count",
      "option:legacy",
      "option:n",
      "option:no-field",
      "option:odd",
      "option:off",
      "option:on",
      "option:zeta",
      "hybrid:hyb",
      "state:from-a",
      "state:state-y",
    ]);
  });

  it("applies the tag placeholder and attaches default actions to events", () => {
    expect(api.events).toEqual([
      { name: "a-first", description: "" },
      { name: "my-el-a-event", description: "From my-el.", inheritedFrom: "@excom/mixin-a" },
      {
        name: "my-el-change",
        description: "Changed on my-el.",
        type: "E",
        typeExpanded: "X",
        defaultAction: "Applies.",
      },
    ]);
    expect(api.listens).toEqual([{ name: "my-el-listen", description: "d", type: "string" }]);
    expect(api.commands).toEqual([
      { name: "--go", description: "Go, my-el." },
      { name: "--z", description: "" },
    ]);
    expect(api.defaultActions.map((d: any) => d.name)).toEqual(["my-el-change", "nothing"]);
  });

  it("copies slots, css collections, children and provisions sorted by name", () => {
    expect(api.slots).toEqual([
      { name: "a", description: "A." },
      { name: "b-slot", description: "", inheritedFrom: "@excom/mixin-b" },
      { name: "z", description: "" },
    ]);
    expect(api.cssProperties).toEqual([
      { name: "--a", description: "", syntax: undefined, default: undefined },
      { name: "--b", description: "", syntax: "<color>", default: "red" },
    ]);
    expect(api.cssClasses).toEqual([{ name: "raised", description: "" }]);
    expect(api.cssAliases).toEqual([
      { name: ":--my-el", selectors: ["my-el"], kind: "element", description: "" },
      { name: ":--my-el--on", selectors: [], kind: "element", description: "" },
    ]);
    expect(api.expectedChildren).toEqual([
      { name: "child:template", relationship: "child", selector: "template", required: true, description: "" },
      { name: "descendant:button", relationship: "descendant", selector: "button", required: false, description: "B" },
    ]);
    expect(api.provisions).toEqual([
      { name: "other", description: "", fieldName: undefined },
      { name: "provision", type: "P", typeExpanded: "{ p: 1 }", description: "", fieldName: "provision", default: '"{}"' },
    ]);
  });

  it("tags inherited entries with the contributing package and stops on cycles", () => {
    const inheritedA = api.attributes.filter((a: any) => a.inheritedFrom === "@excom/mixin-a");
    expect(inheritedA.map((a: any) => a.name)).toEqual(["zeta", "from-a"]);
    expect(api.attributes.find((a: any) => a.name === "from-a").surface).toBe("state");
    expect(api.attributes.find((a: any) => a.name === "zeta").type).toBe("number");
    expect(api.slots.find((s: any) => s.name === "b-slot").inheritedFrom).toBe("@excom/mixin-b");
  });

  it("uses the mixin's own tag for placeholders when the host has none", () => {
    const [mixin] = flattenCem(mixinA, () => undefined);
    expect(mixin.tag).toBeUndefined();
    expect(mixin.events[0].name).toBe("{tag}-a-event");
    expect(mixin.attributes).toHaveLength(2);
  });

  it("keeps `noop-tag` placeholders untouched", () => {
    const [noop] = flattenCem(
      baseCem({ kind: "mixin", tagName: "noop-tag", events: [{ name: "{tag}-x" }] }),
      () => undefined,
    );
    expect(noop.events[0].name).toBe("{tag}-x");
  });

  it("handles declarations without any collections", () => {
    const [empty] = flattenCem(baseCem({ kind: "class", tagName: "e-l" }), () => undefined);
    expect(empty.attributes).toEqual([]);
    expect(empty.events).toEqual([]);
    expect(flattenCem(undefined, () => undefined)).toEqual([]);
  });
});
