import { parseTree } from "../../index";
import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";

describe("parseTree", () => {
  it("gives the document a browser builds as plain data: doctype, comments, elements, text, template content", () => {
    const html = `<!doctype html><!-- top --><html lang="en"><head><title>Menu</title></head><body><p id="a" class="b">One <b>two</b></p><template><li>row</li></template></body></html>`;
    expect(parseTree(html)).toEqual([
      { doctype: "html" },
      { comment: " top " },
      {
        tag: "html",
        attributes: { lang: "en" },
        children: [
          {
            tag: "head",
            attributes: {},
            children: [{ tag: "title", attributes: {}, children: [{ text: "Menu" }] }],
          },
          {
            tag: "body",
            attributes: {},
            children: [
              {
                tag: "p",
                attributes: { id: "a", class: "b" },
                children: [{ text: "One " }, { tag: "b", attributes: {}, children: [{ text: "two" }] }],
              },
              {
                tag: "template",
                attributes: {},
                children: [{ tag: "li", attributes: {}, children: [{ text: "row" }] }],
              },
            ],
          },
        ],
      },
    ]);
    // plain data: a JSON round trip changes nothing
    expect(JSON.parse(JSON.stringify(parseTree(html)))).toEqual(parseTree(html));
  });

  it("parses as a browser does: implied elements, a block ending a <p>, SVG names and namespaced attributes", () => {
    const [html] = parseTree(`<p>a<div>b</div><svg viewBox="0 0 1 1"><use xlink:href="#x"/><foreignObject/></svg>`) as [
      { children: [unknown, { children: unknown[] }] },
    ];
    expect(html.children[1].children).toEqual([
      { tag: "p", attributes: {}, children: [{ text: "a" }] },
      { tag: "div", attributes: {}, children: [{ text: "b" }] },
      {
        tag: "svg",
        attributes: { viewBox: "0 0 1 1" },
        children: [
          { tag: "use", attributes: { "xlink:href": "#x" }, children: [] },
          { tag: "foreignObject", attributes: {}, children: [] },
        ],
      },
    ]);
  });
});
