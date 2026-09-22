import { format } from "prettier";
import { describe, expect, it } from "vitest";
import * as plugin from "../../profiles/default/config/prettier-plugin-preserve-custom-selector.mjs";

const fmt = (css: string, parser = "css") =>
  format(css, { parser, plugins: [plugin as never], printWidth: 40 });

describe("prettier-plugin-preserve-custom-selector", () => {
  it("wraps every postcss parser and printer", () => {
    expect(Object.keys(plugin.parsers)).toEqual(
      expect.arrayContaining(["css", "scss", "less"]),
    );
    expect(Object.keys(plugin.printers)).toEqual(["postcss"]);
  });

  it("prints @custom-selector verbatim", async () => {
    const src = `@custom-selector :--article article,[role="article"],.tag-article;\n@custom-selector   :--dialog   dialog\n`;
    const out = await fmt(src);
    expect(out).toContain(
      `@custom-selector :--article article,[role="article"],.tag-article;`,
    );
    // A definition without a trailing semicolon gets exactly one.
    expect(out).toContain(`@custom-selector   :--dialog   dialog;`);
    expect(out).not.toContain("dialog;;");
  });

  it("glues :--ident tokens in @mixin and @define-mixin params", async () => {
    const src = `@define-mixin module-table $sel: :--data-table { $(sel) { color: red } }\n.a { @mixin module-table :--data-table; }\n.b{@mixin other-mixin :--x, :--y;}\n`;
    const out = await fmt(src);
    expect(out).toContain(":--data-table");
    expect(out).not.toContain(": --data-table");
    expect(out).not.toContain("module-table: --");
    expect(out).toContain("@mixin other-mixin :--x, :--y;");
    // Mixin bodies still format.
    expect(out).toContain("color: red;");
  });

  it("glues tokens in any at-rule prelude containing :--", async () => {
    const out = await fmt(`@custom-media --wide (min-width: 40rem);\n@supports selector(:--foo) { .a { color: red } }\n`);
    expect(out).toContain("@custom-media --wide (min-width: 40rem);");
    expect(out).toContain("selector(:--foo)");
  });

  it("does not glue declaration values or ordinary rules", async () => {
    const out = await fmt(`.a{anchor-name: --foo; color:red}\n@media (min-width:1px){.b{color:blue}}\n`);
    expect(out).toContain("anchor-name: --foo;");
    expect(out).toContain("@media (min-width: 1px)");
  });

  it("works through the scss parser too", async () => {
    const out = await fmt(`@custom-selector :--x a,b;\n.a { @mixin m :--x; }\n`, "scss");
    expect(out).toContain("@custom-selector :--x a,b;");
    expect(out).toContain("@mixin m :--x;");
  });

  it("handles every prelude shape without touching non-custom tokens", async () => {
    const out = await fmt(
      `@scope (:--dialog) to (.end) { p { color: red } }\n.a { @mixin foo :bar; @mixin bar url(x.css) :--x; @mixin baz : --y; }\n`,
    );
    expect(out).toContain("@scope (:--dialog) to (.end)");
    // Only `--ident` tokens are glued; a plain word still gets Prettier's colon treatment.
    expect(out).toContain("@mixin foo: bar;");
    expect(out).toContain("@mixin bar url(x.css) :--x;");
    expect(out).toContain("@mixin baz :--y;");
    // A colon followed by a group (no word) is left to Prettier as well.
    expect(await fmt(`.a { @mixin foo :(a b); }\n`)).toContain("@mixin foo: (a b);");
  });

  it("glues tokens in the AST the wrapped parser returns", async () => {
    type Node = { type?: string; name?: string; value?: unknown; nodes?: Node[] };
    const ast = (await plugin.parsers.less.parse(
      `@r: { a: b }\n.a { @mixin m :--x; }\n`,
      {} as never,
    )) as Node;
    const atRules: Node[] = [];
    const walk = (n: Node) => {
      if (n.type === "css-atrule") atRules.push(n);
      n.nodes?.forEach(walk);
    };
    walk(ast);
    // Bare-option parsing exposes the detached ruleset's params as a string value.
    expect(atRules.find((n) => n.name === "r")!.value).toEqual(expect.any(String));
    const mixin = atRules.find((n) => n.name === "mixin")! as {
      value: { group: { group: { groups: { type: string; value: string }[] } } };
    };
    expect(mixin.value.group.group.groups.map((g) => [g.type, g.value])).toEqual([
      ["value-word", "m"],
      ["value-word", ":--x"],
    ]);
  });

  it("leaves Less detached rulesets alone", async () => {
    const out = await fmt(`@detached: { color: red; }\n.a { @mixin m :--x; @detached(); }\n`, "less");
    expect(out).toContain("@detached: {");
    expect(out).toContain("@mixin m :--x;");
  });

  it("prints a tagged node from either AstPath shape", () => {
    const tagged = { __preserveCustomSelector: "@custom-selector :--x a;" };
    const print = plugin.printers.postcss.print as (p: object, o: object, pr: () => void) => unknown;
    expect(print({ node: tagged }, {}, () => {})).toBe("@custom-selector :--x a;");
    expect(print({ getValue: () => tagged }, {}, () => {})).toBe("@custom-selector :--x a;");
  });
});
