import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import { createDom, ignoreStrayMarkup, parseTree, type TreeNode } from "../../index";
import { dependencies } from "../../package.json";
import { originalPrototype } from "./helpers/happy-dom-original";

type Parent = Extract<TreeNode, { children: TreeNode[] }>;

interface Parser {
  parse?: unknown;
  parseEndTag?: unknown;
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/stray-markup");
const { default: HTMLParser } = createRequire(import.meta.url)("happy-dom/lib/html-parser/HTMLParser.js") as {
  default: { prototype: Parser };
};
const original = await originalPrototype<Parser>("html-parser/HTMLParser.js");

const { window, document } = createDom();

/** A happy-dom node in `parseTree()`'s shape. */
const treeOf = (node: Node): TreeNode =>
  node instanceof window.Element
    ? {
        tag: node.localName,
        attributes: Object.fromEntries([...node.attributes].map(({ name, value }) => [name, value])),
        children: [...(node instanceof window.HTMLTemplateElement ? node.content : node).childNodes].map(treeOf),
      }
    : node.nodeType === node.COMMENT_NODE
      ? { comment: (node as Comment).data }
      : { text: (node as Text).data };

/** `html` read as `include-content` reads a view (a `<template>`'s `innerHTML`), and as a browser reads it (parse5). */
const parsed = (html: string) => {
  const template = document.createElement("template");
  template.innerHTML = html;
  const [, root] = parseTree(`<!doctype html><template>${html}</template>`) as [unknown, Parent];
  const [head] = root.children as [Parent];
  const [browser] = head.children as [Parent];
  return { here: (treeOf(template) as Parent).children, browser: browser.children };
};

/** Runs `read` with happy-dom's own parser methods, as a second happy-dom copy would parse. */
const unshimmed = <T>(read: () => T): T => {
  const proto = HTMLParser.prototype;
  const patched = { parse: proto.parse, parseEndTag: proto.parseEndTag };
  Object.assign(proto, { parse: original.parse, parseEndTag: original.parseEndTag });
  try {
    return read();
  } finally {
    Object.assign(proto, patched);
  }
};

describe("ignoreStrayMarkup", () => {
  it("reads a `-->` outside a comment as text, once: an HTML comment highlighted by shiki", () => {
    const html = "<span>&#x3C;!-- SPA routing --></span>";
    expect(parsed(html).here).toEqual([{ tag: "span", attributes: {}, children: [{ text: "<!-- SPA routing -->" }] }]);
    expect(parsed(html).here).toEqual(parsed(html).browser);
  });

  it.each(["a -->", "a --!> b", "<!-- c --> a --> b", "a --->b", "a > b", "a /> b <i>c</i> => d"])(
    "reads a `-->` or `>` between tags as a browser does, one text node: %s",
    (html) => {
      const { here, browser } = parsed(html);
      expect(here).toEqual(browser);
    },
  );

  it.each([
    ["</span> past a <div>", "<span><div></span>x</div>y</span>"],
    ["a custom element's end tag past a list", "<x-row><ul><li></x-row>x</li></ul>y</x-row>"],
    ["</div> past a <template>", "<div><template></div><p></p></template>x</div>"],
    ["</span> past a <template>", "<span><template></span><b></b></template>x</span>"],
    ["</span> past a <table>", "<span><table><tbody><tr><td>a</span></td></tr></tbody></table>c</span>"],
  ])("ignores an end tag a browser ignores: %s", (_, html) => {
    const { here, browser } = parsed(html);
    expect(here).toEqual(browser);
  });

  it.each([
    "<div><span>a</div>b",
    "<x-a><x-b></x-a>c",
    "<p><span>a</p>b",
    "<ul><li>a</ul>b",
    "<span><x-b>a</span>b",
    "<template><div></template>x",
    "<table><tbody><tr><td><div>a</td></tr></tbody></table>",
    "<svg><g></svg>x",
    // an upper-case end tag; an SVG name in capitals
    "<div><p></DIV>x",
    '<div><svg><use href="#a"/><linearGradient></lineargradient><stop/></svg></div>',
    // `</dialog>` has a rule of its own: it closes past a <div>
    "<dialog><div></dialog>x",
    // not special in parse5 8, though the standard lists it
    "<span><search>a</span>b",
    // happy-dom builds MathML as HTML: a <template> there is no boundary
    "<math><template>a</math>b",
    // an SVG <template> is no boundary either
    "<svg><g><template><circle></g>x</svg>",
  ])("closes what a browser closes: %s", (html) => {
    const { here, browser } = parsed(html);
    expect(here).toEqual(browser);
  });

  it.each([
    // a browser closed the <p>, the outer <li>, the <h1>, the outer <button> / <select>, the <td>, the outer <form>
    '<include-content><p><a href="#">Read <div>more</div></a></include-content><footer>x</footer>',
    "<x-a><p><span>a<div>b</div></span></x-a>c",
    "<x-a><li><span>a<li>b</li></span></x-a>c",
    "<x-a><h1>a<h2>b</h2></x-a>c",
    "<x-a><button>a<button>b</button></x-a>c",
    "<x-a><select>a<select>b</select></x-a>c",
    "<span><td>a</span>b</td>",
    "<x-a><form>a<form>b</form></x-a>c",
    // a formatting end tag past a block (the adoption agency)
    "<b><div></b>x</div>",
    // what happy-dom reads as markup, a browser as text
    "<textarea><template>a</textarea>b",
    "<title><template>a</title>b",
  ])("leaves happy-dom's parse where its open elements may differ from a browser's: %s", (html) => {
    expect(parsed(html).here).toEqual(unshimmed(() => parsed(html).here));
  });

  it("parses the docs site's API reference view as it was: a stray </span> in a popover <template>", () => {
    const view = readFileSync(join(FIXTURES, "api-reference.html"), "utf8");
    const { here, browser } = parsed(view);
    expect(here).toEqual(browser);
    expect(unshimmed(() => parsed(view).here)).not.toEqual(browser);
  });

  it("patches happy-dom's parser once", () => {
    const { parse, parseEndTag } = HTMLParser.prototype;
    ignoreStrayMarkup(window);
    expect([HTMLParser.prototype.parse, HTMLParser.prototype.parseEndTag]).toEqual([parse, parseEndTag]);
  });

  it("throws, naming the pin, when the window's parser is not the patched copy", () => {
    expect(() => unshimmed(() => ignoreStrayMarkup(window))).toThrow(
      `nucleus-dom cannot correct happy-dom's parse of stray markup: this window's happy-dom is not the copy nucleus-dom patches (nucleus-dom pins happy-dom ${dependencies["happy-dom"]})`,
    );
  });

  it("throws when happy-dom's parser is laid out otherwise", () => {
    const proto = HTMLParser.prototype;
    const { parseEndTag } = proto;
    delete proto.parseEndTag;
    try {
      expect(() => ignoreStrayMarkup(window)).toThrow("happy-dom's parser has no parseEndTag()");
    } finally {
      proto.parseEndTag = parseEndTag;
    }
  });
});
