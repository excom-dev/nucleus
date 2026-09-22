import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LIB_TYPES,
  compactType,
  createTypeContext,
  findMatchingAngle,
  findMatchingBrace,
  resolveTypeAnnotation,
} from "../../scripts/cem-types.mjs";
import {
  linkNodeModule,
  makeTempDir,
  packageJson,
  removeDir,
  writeFiles,
} from "./docs-pipeline-fixtures";

const ctxOf = (src: string, opts: Record<string, unknown> = {}) =>
  createTypeContext(src, opts);

describe("createTypeContext", () => {
  it("seeds the file cache only when packageRoot + modulePath are given", () => {
    const bare = createTypeContext("x");
    expect(bare.filePath).toBe("");
    expect(bare.packageRoot).toBe("");
    expect(bare.fileCache.size).toBe(0);

    const full = createTypeContext("src", { packageRoot: "/pkg", modulePath: "el.ts" });
    expect(full.filePath).toBe(path.resolve("/pkg", "el.ts"));
    expect(full.fileCache.get(full.filePath)).toBe("src");
  });
});

describe("resolveTypeAnnotation — primitives and lib types", () => {
  const ctx = ctxOf("");

  it("returns undefined for empty input", () => {
    expect(resolveTypeAnnotation("", ctx)).toBeUndefined();
    expect(resolveTypeAnnotation(null, ctx)).toBeUndefined();
    expect(resolveTypeAnnotation("  \n * \n", ctx)).toBeUndefined();
  });

  it("maps constructor names to TS primitives", () => {
    expect(resolveTypeAnnotation("String", ctx)).toEqual({ text: "string" });
    expect(resolveTypeAnnotation("Number", ctx)).toEqual({ text: "number" });
    expect(resolveTypeAnnotation("Boolean", ctx)).toEqual({ text: "boolean" });
  });

  it("keeps TS primitives and DOM lib identifiers as-is", () => {
    expect(resolveTypeAnnotation("string", ctx)).toEqual({ text: "string" });
    expect(resolveTypeAnnotation("HTMLElement", ctx)).toEqual({ text: "HTMLElement" });
    expect(LIB_TYPES.has("CustomEvent")).toBe(true);
  });

  it("keeps unknown identifiers as names", () => {
    expect(resolveTypeAnnotation("Whatever", ctx)).toEqual({ text: "Whatever" });
  });

  it("treats inline objects as `object` with an expanded shape", () => {
    expect(resolveTypeAnnotation("{ a: string; b?: number }", ctx)).toEqual({
      text: "object",
      expanded: "{ a: string; b?: number }",
    });
  });

  it("strips JSDoc stars and stops at the next tag", () => {
    expect(resolveTypeAnnotation(" * {\n *   a: string\n * }\n * @default x", ctx)).toEqual({
      text: "object",
      expanded: "{ a: string }",
    });
    expect(resolveTypeAnnotation("string | number\n@default 1", ctx)).toEqual({
      text: "string | number",
    });
  });

  it("falls back to the whole text for an unbalanced inline object", () => {
    expect(resolveTypeAnnotation("{ a: string", ctx)).toEqual({
      text: "object",
      expanded: "{ a: string",
    });
  });

  it("returns a plain text for unions of primitives", () => {
    expect(resolveTypeAnnotation("string | null", ctx)).toEqual({ text: "string | null" });
  });
});

describe("resolveTypeAnnotation — same-file aliases", () => {
  const src = `
    export type Shape = { a: string; b: number };
    type Prim = string;
    type lower = string;
    export type Union = Shape | null;
    export type Fn = (x: number) => void;
    export type Paren = (typeof x)[];
    interface Plain { detail: Fn; count: number }
    export interface Evt extends CustomEvent<number> { detail: Fn }
    class Klass { x = 1; }
    class EvKlass extends Event implements Plain {
      kind: string;
      /* comment */ level: number;
    }
    type TBase = CustomEvent & { bubbles: true; cancelable: true; composed: true };
    export type FooEvent = TBase & { type: "foo"; detail: Shape };
    type ArrowEvent = TBase & { type: "arrow"; detail: () => void; };
    type ArrowFirst = { cb: (a: number) => void } & { a: 1 };
    type Single = Named & { a: 1 };
    type NoObj = Named & Other;
    type Recursive = { next: Recursive | null };
    type A1 = A2; type A2 = A3; type A3 = A4; type A4 = A5; type A5 = { deep: true };
    type WithComments = "a;b" | /* ; */ Shape; // trailing
    type Generic = Map<string, () => void>;
    type Unterminated = { last: true }
  `;
  const ctx = ctxOf(src);

  it("expands object aliases onto `expanded`", () => {
    expect(resolveTypeAnnotation("Shape", ctx)).toEqual({
      text: "Shape",
      expanded: "{ a: string; b: number }",
    });
  });

  it("collapses a primitive alias to its display name when capitalized", () => {
    expect(resolveTypeAnnotation("Prim", ctx)).toEqual({ text: "Prim" });
  });

  it("collapses a lowercase primitive alias to the primitive", () => {
    expect(resolveTypeAnnotation("lower", ctx)).toEqual({ text: "string" });
  });

  it("expands aliases nested inside unions and keeps the union as text", () => {
    expect(resolveTypeAnnotation("Union", ctx)).toEqual({
      text: "Union",
      expanded: "{ a: string; b: number } | null",
    });
    expect(resolveTypeAnnotation("Shape | undefined", ctx)).toEqual({
      text: "Shape | undefined",
      expanded: "{ a: string; b: number } | undefined",
    });
  });

  it("expands function aliases", () => {
    expect(resolveTypeAnnotation("Fn", ctx)).toEqual({
      text: "Fn",
      expanded: "(x: number) => void",
    });
    expect(resolveTypeAnnotation("Paren", ctx)).toEqual({
      text: "Paren",
      expanded: "(typeof x)[]",
    });
  });

  it("expands plain interfaces including function-typed members", () => {
    expect(resolveTypeAnnotation("Plain", ctx)).toEqual({
      text: "Plain",
      expanded: "{ detail: (x: number) => void; count: number }",
    });
  });

  it("keeps heritage and function alias names on event-like interfaces", () => {
    expect(resolveTypeAnnotation("Evt", ctx)).toEqual({
      text: "Evt",
      expanded: "CustomEvent<number> & { detail: Fn }",
    });
  });

  it("keeps non-event classes as names", () => {
    expect(resolveTypeAnnotation("Klass", ctx)).toEqual({ text: "Klass" });
  });

  it("expands event-like classes to heritage plus fields, dropping `implements`", () => {
    expect(resolveTypeAnnotation("EvKlass", ctx)).toEqual({
      text: "EvKlass",
      expanded: "Event & { kind: string; level: number }",
    });
  });

  it("flattens intersected objects, author fields first", () => {
    expect(resolveTypeAnnotation("FooEvent", ctx)).toEqual({
      text: "FooEvent",
      expanded:
        'CustomEvent & { type: "foo"; detail: { a: string; b: number }; bubbles: true; cancelable: true; composed: true }',
    });
  });

  it("does not let `=>` unbalance field splitting inside intersections", () => {
    expect(resolveTypeAnnotation("ArrowEvent", ctx)).toEqual({
      text: "ArrowEvent",
      expanded:
        'CustomEvent & { type: "arrow"; detail: () => void; bubbles: true; cancelable: true; composed: true }',
    });
    expect(resolveTypeAnnotation("ArrowFirst", ctx)).toEqual({
      text: "ArrowFirst",
      expanded: "{ a: 1; cb: (a: number) => void }",
    });
  });

  it("leaves intersections with one or zero object parts alone", () => {
    expect(resolveTypeAnnotation("Single", ctx)).toEqual({
      text: "Single",
      expanded: "Named & { a: 1 }",
    });
    expect(resolveTypeAnnotation("NoObj", ctx)).toEqual({
      text: "NoObj",
      expanded: "Named & Other",
    });
  });

  it("stops on recursive aliases", () => {
    expect(resolveTypeAnnotation("Recursive", ctx)).toEqual({
      text: "Recursive",
      expanded: "{ next: Recursive | null }",
    });
  });

  it("stops expanding at the depth limit", () => {
    expect(resolveTypeAnnotation("A1", ctx)).toEqual({ text: "A1", expanded: "A5" });
  });

  it("reads alias right-hand sides across comments, strings and generics", () => {
    expect(resolveTypeAnnotation("WithComments", ctx)).toEqual({
      text: "WithComments",
      expanded: '"a;b" | { a: string; b: number }',
    });
    expect(resolveTypeAnnotation("Generic", ctx)).toEqual({
      text: "Generic",
      expanded: "Map<string, () => void>",
    });
    expect(resolveTypeAnnotation("Unterminated", ctx)).toEqual({
      text: "Unterminated",
      expanded: "{ last: true }",
    });
  });

  it("caches declaration lookups", () => {
    const fresh = ctxOf(src);
    resolveTypeAnnotation("Shape", fresh);
    const size = fresh.declCache.size;
    resolveTypeAnnotation("Shape", fresh);
    expect(fresh.declCache.size).toBe(size);
  });
});

describe("resolveTypeAnnotation — indexed access", () => {
  const src = `
    export interface Data { params: Params; name: string; nested: { k: number }; klass: K }
    export type Params = { id: string };
    class K { x = 1 }
    type Alias = { inner: Params };
  `;
  const ctx = ctxOf(src);

  it("resolves `T[\"key\"]` on interfaces and aliases", () => {
    expect(resolveTypeAnnotation('Data["params"]', ctx)).toEqual({
      text: 'Data["params"]',
      expanded: "{ id: string }",
    });
    expect(resolveTypeAnnotation('Alias["inner"]', ctx)).toEqual({
      text: 'Alias["inner"]',
      expanded: "{ id: string }",
    });
  });

  it("chains keys through named members", () => {
    expect(resolveTypeAnnotation('Data["params"]["id"]', ctx)).toEqual({
      text: 'Data["params"]["id"]',
    });
  });

  it("leaves lib / class / unknown indexed access as written", () => {
    expect(resolveTypeAnnotation('Window["name"]', ctx)).toEqual({ text: 'Window["name"]' });
    expect(resolveTypeAnnotation('K["x"]', ctx)).toEqual({ text: 'K["x"]' });
    expect(resolveTypeAnnotation('Nope["x"]', ctx)).toEqual({ text: 'Nope["x"]' });
  });

  it("gives up on missing keys, inline intermediates and class intermediates", () => {
    const missing = resolveTypeAnnotation('Data["missing"]', ctx);
    expect(missing?.text).toBe('Data["missing"]');
    const inline = resolveTypeAnnotation('Data["nested"]["k"]', ctx);
    expect(inline?.text).toBe('Data["nested"]["k"]');
    const klass = resolveTypeAnnotation('Data["klass"]["x"]', ctx);
    expect(klass?.text).toBe('Data["klass"]["x"]');
  });
});

describe("resolveTypeAnnotation — cross-file and workspace lookups", () => {
  let tmp: string;
  let elRoot: string;

  beforeAll(() => {
    tmp = makeTempDir("heft-rig-types-");
    const packages = path.join(tmp, "packages");
    elRoot = path.join(packages, "el");
    writeFiles(packages, {
      "el/package.json": packageJson("@excom/el"),
      "el/el.ts": `
        import { Local as Renamed } from "./types";
        import type { Missing } from "./missing";
        import Def from "./def";
        import { TEvent, Renamed2, Deep } from "@excom/dep";
        import { Sub } from "@excom/dep/src/sub";
        import { Gone } from "@excom/nope";
        import { Outside } from "@excom/outside";
        import { BareType } from "@excom/bare";
        import { Shorty } from "@excom/shorty";
        import { Broken } from "@excom/broken";
        import { Empty } from "@excom/empty";
        import { Lodash } from "lodash";
        export type LocalEvent = TEvent & { type: "local"; detail: Renamed };
      `,
      "el/types.ts": `export type Local = { id: number };`,
      "el/def.ts": `type Def = { isDefault: true }; export default Def;`,
      "dep/package.json": packageJson("@excom/dep", {
        types: "./dist/index.d.ts",
        main: "./dist/index.js",
      }),
      "dep/index.ts": `
        export * from "./src/types";
        export type { Other as Renamed2 } from "./src/other";
        export * from "./src/nothing";
      `,
      "dep/src/types.ts": `
        export type TEvent = CustomEvent & { bubbles: true; cancelable: true; composed: true };
        export type Deep = { a: A }; type A = { b: B }; type B = { c: C }; type C = { d: D }; type D = { e: 1 };
      `,
      "dep/src/other.ts": `export type Other = { other: true };`,
      "dep/src/sub.ts": `export type Sub = { sub: true };`,
      "bare/index.ts": `export type BareType = { bare: true };`,
      "shorty/package.json": packageJson("@excom/shorty"),
      "shorty/shorty.ts": `export type Shorty = { short: true };`,
      "broken/package.json": "{ not json",
      "broken/index.ts": `export type Broken = { broken: true };`,
      "empty/package.json": packageJson("@excom/empty"),
    });
    writeFiles(tmp, {
      "outside-pkg/package.json": packageJson("@excom/outside"),
      "outside-pkg/index.ts": `export type Outside = { outside: true };`,
    });
    linkNodeModule(elRoot, "@excom/dep", path.join(packages, "dep"));
    linkNodeModule(elRoot, "@excom/bare", path.join(packages, "bare"));
    linkNodeModule(elRoot, "@excom/shorty", path.join(packages, "shorty"));
    linkNodeModule(elRoot, "@excom/broken", path.join(packages, "broken"));
    linkNodeModule(elRoot, "@excom/empty", path.join(packages, "empty"));
    linkNodeModule(elRoot, "@excom/outside", path.join(tmp, "outside-pkg"));
  });

  afterAll(() => removeDir(tmp));

  const makeCtx = () => {
    const src = readFileSync(path.join(elRoot, "el.ts"), "utf8");
    return createTypeContext(src, { modulePath: "el.ts", packageRoot: elRoot });
  };

  it("follows relative named / aliased / default imports", () => {
    const ctx = makeCtx();
    expect(resolveTypeAnnotation("Renamed", ctx)).toEqual({
      text: "Renamed",
      expanded: "{ id: number }",
    });
    expect(resolveTypeAnnotation("Def", ctx)).toEqual({
      text: "Def",
      expanded: "{ isDefault: true }",
    });
    expect(resolveTypeAnnotation("Missing", ctx)).toEqual({ text: "Missing" });
  });

  it("follows workspace barrels (`export *` and `export { X as Y }`)", () => {
    const ctx = makeCtx();
    expect(resolveTypeAnnotation("TEvent", ctx)).toEqual({
      text: "TEvent",
      expanded: "CustomEvent & { bubbles: true; cancelable: true; composed: true }",
    });
    expect(resolveTypeAnnotation("Renamed2", ctx)).toEqual({
      text: "Renamed2",
      expanded: "{ other: true }",
    });
    expect(resolveTypeAnnotation("LocalEvent", ctx)).toEqual({
      text: "LocalEvent",
      expanded:
        'CustomEvent & { type: "local"; detail: { id: number }; bubbles: true; cancelable: true; composed: true }',
    });
  });

  it("stops at the depth limit across files", () => {
    const ctx = makeCtx();
    expect(resolveTypeAnnotation("Deep", ctx)).toEqual({
      text: "Deep",
      expanded: "{ a: { b: { c: { d: D } } } }",
    });
  });

  it("resolves workspace subpath imports", () => {
    expect(resolveTypeAnnotation("Sub", makeCtx())).toEqual({
      text: "Sub",
      expanded: "{ sub: true }",
    });
  });

  it("resolves package entries without package.json, by short name, or with broken json", () => {
    const ctx = makeCtx();
    expect(resolveTypeAnnotation("BareType", ctx)).toEqual({
      text: "BareType",
      expanded: "{ bare: true }",
    });
    expect(resolveTypeAnnotation("Shorty", ctx)).toEqual({
      text: "Shorty",
      expanded: "{ short: true }",
    });
    expect(resolveTypeAnnotation("Broken", ctx)).toEqual({
      text: "Broken",
      expanded: "{ broken: true }",
    });
  });

  it("keeps names for unresolvable imports", () => {
    const ctx = makeCtx();
    expect(resolveTypeAnnotation("Gone", ctx)).toEqual({ text: "Gone" });
    expect(resolveTypeAnnotation("Outside", ctx)).toEqual({ text: "Outside" });
    expect(resolveTypeAnnotation("Empty", ctx)).toEqual({ text: "Empty" });
    expect(resolveTypeAnnotation("Lodash", ctx)).toEqual({ text: "Lodash" });
  });

  it("does not chase workspace packages without a packageRoot", () => {
    const src = `import { TEvent } from "@excom/dep";`;
    expect(resolveTypeAnnotation("TEvent", ctxOf(src))).toEqual({ text: "TEvent" });
    const rel = `import { Local } from "./types";`;
    expect(resolveTypeAnnotation("Local", ctxOf(rel))).toEqual({ text: "Local" });
  });

  it("returns names when the module file does not exist on disk", () => {
    const ctx = createTypeContext("", {
      modulePath: "ghost.ts",
      packageRoot: path.join(tmp, "packages", "ghost"),
    });
    ctx.fileCache.clear();
    expect(resolveTypeAnnotation("Anything", ctx)).toEqual({ text: "Anything" });
  });
});

describe("real workspace: spa-route TEvent expansion", () => {
  it("inlines TEvent through the neutron barrel", () => {
    const root = path.resolve(__dirname, "../../../spa-route");
    const src = readFileSync(path.join(root, "spa-route.ts"), "utf8");
    const ctx = createTypeContext(src, { modulePath: "spa-route.ts", packageRoot: root });
    const t = resolveTypeAnnotation("SpaRouteProvisionEvent", ctx);
    expect(t?.text).toBe("SpaRouteProvisionEvent");
    expect(t?.expanded).toBe(
      'CustomEvent & { type: "spa-route-provision"; detail: () => void; bubbles: true; cancelable: true; composed: true }',
    );
    expect(t?.expanded).toContain("bubbles: true");
  });
});

describe("compactType / findMatchingBrace / findMatchingAngle", () => {
  it("compacts whitespace and strips comments", () => {
    expect(compactType(null)).toBe("");
    expect(compactType(" a /* x */ b // tail\n c ")).toBe("a b c");
  });

  it("matches braces across comments, strings and nesting", () => {
    const s = `{ a: "}" ; /* } */ b: { c: 1 } // }\n }`;
    expect(findMatchingBrace(s, 0)).toBe(s.length - 1);
    expect(findMatchingBrace("{ open", 0)).toBe(-1);
    expect(findMatchingBrace("{ 'x\\'}' }", 0)).toBe(9);
    expect(findMatchingBrace("{ /* never", 0)).toBe(-1);
    expect(findMatchingBrace("{ // never", 0)).toBe(-1);
  });

  it("matches angle brackets, ignoring `=>` arrows", () => {
    const s = `<Map<string, () => void>>`;
    expect(findMatchingAngle(s, 0)).toBe(s.length - 1);
    expect(findMatchingAngle("<open", 0)).toBe(-1);
    expect(findMatchingAngle(`<"a>" /* > */ // >\n>`, 0)).toBe(19);
    expect(findMatchingAngle("< /* never", 0)).toBe(-1);
    expect(findMatchingAngle("< // never", 0)).toBe(-1);
  });
});
