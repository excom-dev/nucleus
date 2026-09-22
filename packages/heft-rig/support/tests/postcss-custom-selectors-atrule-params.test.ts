import postcss from "postcss";
import { describe, expect, it } from "vitest";
import postcssCustomSelectorsAtRuleParams from "../../scripts/postcss-custom-selectors-atrule-params.mjs";

const run = async (css: string) =>
  (await postcss([postcssCustomSelectorsAtRuleParams()]).process(css, { from: undefined }))
    .css;

describe("postcss-custom-selectors-atrule-params", () => {
  it("is flagged as a postcss plugin", () => {
    expect(postcssCustomSelectorsAtRuleParams.postcss).toBe(true);
    expect(postcssCustomSelectorsAtRuleParams().postcssPlugin).toBe(
      "postcss-custom-selectors-atrule-params",
    );
  });

  it("expands custom selectors inside @scope and @container params", async () => {
    const out = await run(`
@custom-selector :--dialog dialog, [role="dialog"];
@custom-selector :--article article, .tag-article;
@scope (:--dialog) to (:not(.contents, :--article)) { p { color: red } }
@CONTAINER card (:--article) { p { color: blue } }
`);
    expect(out).toContain(
      '@scope (:is(dialog, [role="dialog"])) to (:not(.contents, :is(article, .tag-article)))',
    );
    expect(out).toContain("@CONTAINER card (:is(article, .tag-article))");
    // Definitions are left for the stock plugin to drop.
    expect(out).toContain("@custom-selector :--dialog");
  });

  it("leaves unknown tokens, other at-rules and plain params alone", async () => {
    const src = `
@custom-selector :--dialog dialog;
@media (:--dialog) { p { color: red } }
@scope (.plain) to (.other) { p { color: red } }
@scope (:--unknown) { p { color: red } }
@scope :--dialog { p { color: red } }
`;
    const out = await run(src);
    expect(out).toContain("@media (:--dialog)");
    expect(out).toContain("@scope (.plain) to (.other)");
    expect(out).toContain("@scope (:--unknown)");
    // Only top-level parenthesised groups are expanded.
    expect(out).toContain("@scope :--dialog {");
  });

  it("does nothing when no custom selectors are defined", async () => {
    const out = await run(`@scope (:--dialog) { p { color: red } }`);
    expect(out).toBe(`@scope (:--dialog) { p { color: red } }`);
  });

  it("ignores malformed @custom-selector definitions", async () => {
    const out = await run(`
@custom-selector :--only-name;
@custom-selector garbage here;
@scope (:--only-name) { p { color: red } }
`);
    expect(out).toContain("@scope (:--only-name)");
  });

  it("handles nested parentheses and unterminated groups", async () => {
    const out = await run(`
@custom-selector :--x .x;
@scope (:not(:is(.a, :--x))) to (.b { p { color: red } }
`);
    expect(out).toContain("(:not(:is(.a, :is(.x))))");
  });
});
