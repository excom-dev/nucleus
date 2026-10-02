import { sameTree } from "../../index";
import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";

const PAGE = (body: string, doctype = "<!doctype html>") =>
  `${doctype}<html lang="en"><head><title>Menu</title></head><body>${body}</body></html>`;

describe("sameTree", () => {
  it("tells documents apart by attribute values, text, nodes and their order, but not by the order of attributes in a tag", () => {
    const route = `<spa-route is-active="" did-load="" n-tpl="html#1" document-title="Menu" n-ssr="1"><h1>Menu</h1><!-- note --></spa-route><script type="application/json" id="nucleus-hydration">{"v":1}</script>`;
    const page = PAGE(route);
    // the same attributes, written in another order
    expect(
      sameTree(
        page,
        PAGE(
          route.replace(
            `is-active="" did-load="" n-tpl="html#1" document-title="Menu"`,
            `is-active="" document-title="Menu" did-load="" n-tpl="html#1"`
          )
        )
      )
    ).toBe(true);
    expect(sameTree(page, page)).toBe(true);
    for (const other of [
      PAGE(route.replace(`document-title="Menu"`, `document-title="Menus"`)),
      PAGE(route.replace(` did-load=""`, "")),
      PAGE(route.replace(`<h1>Menu</h1>`, `<h1>Menu </h1>`)),
      PAGE(route.replace(`<!-- note -->`, `<!-- other -->`)),
      PAGE(route.replace(`{"v":1}`, `{"v":2}`)),
      PAGE(route.replace(`<h1>Menu</h1>`, `<h2>Menu</h2>`)),
      PAGE(route.replace(`<h1>Menu</h1>`, `<h1>Menu</h1><p></p>`)),
      PAGE(`<template><p>a</p></template>`),
      PAGE(route, ""),
      PAGE(route, `<!doctype html public "-//W3C//DTD HTML 4.01//EN">`),
    ])
      expect(sameTree(page, other), other).toBe(false);
    // template content and SVG attributes too
    const inert = PAGE(`<template><p a="1" b="2">a</p></template><svg viewBox="0 0 1 1" xlink:href="#x"></svg>`);
    expect(
      sameTree(inert, inert.replace(`a="1" b="2"`, `b="2" a="1"`).replace(`viewBox="0 0 1 1" xlink:href="#x"`, `xlink:href="#x" viewBox="0 0 1 1"`))
    ).toBe(true);
    expect(sameTree(inert, inert.replace(`<p a="1" b="2">a</p>`, `<p a="1" b="2">b</p>`))).toBe(false);
  });
});
