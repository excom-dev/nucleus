import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildCem } from "../../scripts/build-cem.mjs";
import { makeTempDir, packageJson, removeDir, writeFiles } from "./docs-pipeline-fixtures";

const readCem = (root: string) =>
  JSON.parse(readFileSync(path.join(root, "support/custom-elements.json"), "utf8"));

const element = (tag: string, name: string, extraDoc = "") => `
import { Neutron } from "@excom/neutron";
import { BaseEl } from "@excom/base-el";
/**
 * @summary ${name} summary.
 ${extraDoc}
 */
export const ${name} = Neutron.compose([BaseEl, Neutron({
  tag: "${tag}",
  props: {
    /**
     * @option
     * Label text.
     */
    label: String,
  },
})]);
`;

describe("buildCem", () => {
  let tmp: string;
  beforeAll(() => {
    tmp = makeTempDir("heft-rig-cem-");
  });
  afterAll(() => removeDir(tmp));

  it("analyzes root sources, merges CSS docs and sorts the primary module first", async () => {
    const root = path.join(tmp, "packages", "fx-el");
    writeFiles(root, {
      "package.json": packageJson("@excom/fx-el"),
      "fx-el.ts": element("fx-el", "FxEl", "* @cssprop --fx-el-x - From JSDoc."),
      "other-el.ts": element("other-el", "OtherEl"),
      "noop-base.ts": `export const NoopBase = Neutron({ tag: "noop-tag", props: {} });`,
      "plain.ts": `export const nothing = 1;`,
      "types.d.ts": `export const Decl = Neutron({ tag: "decl-el" });`,
      "index.ts": `export * from "./fx-el";`,
      "vite.config.ts": `export default Neutron({ tag: "vite-el" });`,
      "src/fx-el.css": `
/**
 * @element fx-el
 */
/**
 * Primary color.
 * @cssproperty
 * @default blue
 */
--fx-el-x: blue;
/**
 * Raised look.
 * @cssclass
 */
&.raised {}
/**
 * Host alias.
 * @cssalias
 */
@custom-selector :--fx-el fx-el, .fx;
@custom-selector :--fx-el--on fx-el.on;
@custom-selector :--other-el--x .other-x;
@custom-selector :--unrelated zzz, .zzz;
`,
      "src/index.css": `@custom-selector :--other-el other-el;`,
      "src/empty.css": `.nothing {}`,
      "src/zz.css": `
/**
 * Bound to the package shortname.
 * @cssproperty --zz-prop
 */
`,
      "src/nope.css": `
/**
 * @element nope-el
 */
/**
 * Falls back to every element / mixin.
 * @cssclass
 */
.fallback {}
`,
    });

    await buildCem(root);
    const cem = readCem(root);
    expect(cem.schemaVersion).toBe("1.0.0");
    expect(cem.modules.map((m: any) => m.path)).toEqual([
      "fx-el.ts",
      "noop-base.ts",
      "other-el.ts",
    ]);

    const [fx, noop, other] = cem.modules.map((m: any) => m.declarations[0]);
    expect(fx.mixins).toEqual([{ name: "BaseEl", package: "@excom/base-el" }]);
    expect(fx.cssProperties).toEqual([
      { name: "--fx-el-x", description: "Primary color.", default: "blue" },
      { name: "--zz-prop", description: "Bound to the package shortname." },
    ]);
    expect(fx._neutron.cssClasses.map((c: any) => c.name)).toEqual(["raised", "fallback"]);
    expect(fx._neutron.cssAliases.map((a: any) => a.name)).toEqual([
      ":--fx-el",
      ":--fx-el--on",
      ":--unrelated",
    ]);
    expect(fx._neutron.cssAliases[0].description).toBe("Host alias.");

    expect(other._neutron.cssAliases.map((a: any) => a.name)).toEqual([
      ":--other-el--x",
      ":--other-el",
    ]);
    expect(other._neutron.cssClasses.map((c: any) => c.name)).toEqual(["fallback"]);
    expect(other.cssProperties).toBeUndefined();

    expect(noop.kind).toBe("mixin");
    expect(noop._neutron.cssClasses.map((c: any) => c.name)).toEqual(["fallback"]);
  });

  it("falls back to index.ts when no sibling source defines an element", async () => {
    const root = path.join(tmp, "packages", "index-only");
    writeFiles(root, {
      "package.json": packageJson("@excom/index-only"),
      "index.ts": element("index-only", "IndexOnly"),
      "helper.ts": `export const helper = () => 1;`,
      "src/other.css": "/**\n * @cssclass\n */\n.other {}",
    });
    await buildCem(root);
    const cem = readCem(root);
    expect(cem.modules).toHaveLength(1);
    expect(cem.modules[0].path).toBe("index.ts");
    expect(cem.modules[0].declarations[0].tagName).toBe("index-only");
    expect(cem.modules[0].declarations[0]._neutron.cssClasses).toEqual([{ name: "other" }]);
  });

  it("moves the module matching the package shortname to the front", async () => {
    const root = path.join(tmp, "packages", "zz-el");
    writeFiles(root, {
      "package.json": packageJson("@excom/zz-el"),
      "aa-el.ts": element("aa-el", "AaEl"),
      "zz-el.ts": element("zz-el", "ZzEl"),
    });
    await buildCem(root);
    expect(readCem(root).modules.map((m: any) => m.path)).toEqual(["zz-el.ts", "aa-el.ts"]);
  });

  it("writes nothing for packages without elements", async () => {
    const root = path.join(tmp, "packages", "no-el");
    writeFiles(root, {
      "package.json": packageJson("@excom/no-el"),
      "index.ts": `export const x = 1;`,
      "src/x.css": `/**\n * @cssproperty --x\n */`,
    });
    expect(await buildCem(root)).toBeUndefined();
    expect(existsSync(path.join(root, "support/custom-elements.json"))).toBe(false);

    const bare = path.join(tmp, "packages", "bare");
    writeFiles(bare, { "package.json": packageJson("@excom/bare") });
    expect(await buildCem(bare)).toBeUndefined();
  });

  it("skips the CSS step when there is no src directory", async () => {
    const root = path.join(tmp, "packages", "no-src");
    writeFiles(root, {
      "package.json": packageJson("@excom/no-src"),
      "no-src.ts": element("no-src", "NoSrc"),
    });
    await buildCem(root);
    const decl = readCem(root).modules[0].declarations[0];
    expect(decl.cssProperties).toBeUndefined();
    expect(decl._neutron).toBeUndefined();
  });
});
