import { createDom, findParseDifference, type ParseDifference } from "../../index";
import { afterAll, describe, expect, it } from "@excom/heft-rig/node_modules/vitest";

const { window, dispose } = createDom();
afterAll(() => dispose());

/** Markup a browser parses into other elements than happy-dom, with where. */
const DIFFERENT: [string, string, ParseDifference][] = [
  [
    "a block element in a <p>: the browser closes it, and the stray </p> opens an empty one",
    `<!doctype html>
<html><body>
<p>Intro</p>
<p><section>Block</section></p>
</body></html>`,
    { path: "html > body", here: "nothing", browser: "<p>", line: 4, column: 28 },
  ],
  [
    "a block element in a <p>, through a custom element",
    `<main id="content">
  <p><x-host><b>Today</b><section>Block</section></x-host></p>
</main>`,
    { path: "html > body > main#content > p > x-host", here: "<section>", browser: "nothing", line: 2, column: 26 },
  ],
  [
    "a <title> in a custom element's text: the rest of the page is its text",
    `<body>
<quark-sheet>/* sets the <title> */</quark-sheet>
<main><p>Hi</p></main>
</body>`,
    { path: "html > body", here: "<main>", browser: "nothing", line: 2, column: 26, unclosed: "<title>" },
  ],
  [
    "a <textarea> in a custom element's text",
    `<x-docs>Write in a <textarea>.</x-docs>
<p>More</p>`,
    { path: "html > body", here: "<p>", browser: "nothing", line: 1, column: 20, unclosed: "<textarea>" },
  ],
  [
    "a tag in a <textarea>'s text: it ends at </textarea>",
    `<label>Note <textarea>Use <b>bold</b></textarea></label>`,
    { path: "html > body > label > textarea", here: "<b>", browser: "nothing", line: 1, column: 38 },
  ],
  [
    "a nested <a>",
    `<nav><a href="/docs"><div><a href="/docs/start">Start</a></div></a></nav>`,
    { path: "html > body > nav > a", here: "<div>", browser: "nothing", line: 1, column: 27 },
  ],
  [
    "a nested <form>, which a browser drops",
    `<form><fieldset><form><input name="q"></form></fieldset></form>`,
    { path: "html > body > form > fieldset", here: "<form>", browser: "<input>", line: 1, column: 23 },
  ],
  [
    "a <div> directly in a <table>",
    `<table>
  <div><b>Prices</b></div>
  <tr><td>1</td></tr>
</table>`,
    { path: "html > body > div", here: "nothing", browser: "<b>", line: 2, column: 8 },
  ],
  [
    "a <table> in a <table>: the <tbody> a browser implies starts with its first row",
    `<table>
  <tr><td>1</td></tr><tr><td>2</td></tr>
  <table><tr><td>3</td></tr></table>
</table>`,
    { path: "html > body > table", here: "nothing", browser: "<tbody>", line: 2, column: 3 },
  ],
  [
    "a stray </br>, a <br> to a browser, where its parent's start tag ends",
    `<div></br></div>`,
    { path: "html > body > div", here: "nothing", browser: "<br>", line: 1, column: 6 },
  ],
  [
    "a stray </br> with no markup before it",
    `</br>`,
    { path: "html > body", here: "nothing", browser: "<br>", line: 1, column: 1 },
  ],
  [
    "a <frame> outside a <frameset>, which a browser drops",
    `<frame src="/nav.html">`,
    { path: "html > body", here: "<frame>", browser: "nothing", line: 1, column: 1 },
  ],
  [
    "a <frame> at the end of a <body> left open, which closes after its content",
    `<body><p>Hi</p><frame src="/nav.html">`,
    { path: "html > body", here: "<frame>", browser: "nothing", line: 1, column: 16 },
  ],
  [
    "a <frame> at the end of a page whose <title> and <svg> are closed",
    `<p>Hi</p><title>Docs</title><svg><title>Logo</title></svg><frame src="/nav.html">`,
    { path: "html > body", here: "<frame>", browser: "nothing", line: 1, column: 59 },
  ],
  [
    "an unquoted attribute value holding =",
    `<a href=/docs?page=2>Next</a>`,
    {
      path: "html > body",
      here: '<a href="/docs?page" 2="">',
      browser: '<a href="/docs?page=2">',
      line: 1,
      column: 1,
    },
  ],
  [
    "template content",
    `<main><template><p><x-card><div>Card</div></x-card></p></template></main>`,
    { path: "html > body > main > template > p > x-card", here: "<div>", browser: "nothing", line: 1, column: 28 },
  ],
  [
    "a metadata element before <head>, which a browser puts there",
    `<title>Home</title><p>Hi</p>`,
    { path: "html > head", here: "nothing", browser: "<title>", line: 1, column: 1 },
  ],
  [
    "a <noscript> whose end tag never comes: a scripting browser reads the rest of the page as its text",
    `<!doctype html><body><noscript><p>Enable JS</p><main id="m">content</main></body></html>`,
    { path: "html > body > noscript", here: "<p>", browser: "nothing", line: 1, column: 22, unclosed: "<noscript>" },
  ],
  [
    "a <select> whose end tag never comes: it takes the rest of the page",
    `<!doctype html><body><select><option>A<main>content</main></body></html>`,
    { path: "html > body > select > option", here: "<main>", browser: "nothing", line: 1, column: 22, unclosed: "<select>" },
  ],
  [
    "a <select> left open where happy-dom ends it at its parent's end tag",
    `<div><select><option>A</div><main>content</main>`,
    { path: "html > body", here: "<main>", browser: "nothing", line: 1, column: 6, unclosed: "<select>" },
  ],
  [
    "a <select> an <input> closes, which is no unclosed one",
    `<select><option>A</option><input name="q">`,
    { path: "html > body", here: "nothing", browser: "<input>", line: 1, column: 27 },
  ],
];

/** Documents both parsers read into the same elements. */
const AGREED: Record<string, string> = {
  "a page": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Wren Café</title>
    <link rel="icon" href="/favicon.ico">
    <script type="module">if (1 < 2 && "</div>") import("/app.js");</script>
    <style>main > p::before { content: "<p>"; }</style>
  </head>
  <body>
    <!-- <section> in a comment -->
    <nav><a href="/">Home</a> <a href="/menu?day=1&amp;meal=2&copy=3">Menu</a></nav>
    <main id="content">
      <h1>Menu</h1>
      <p>Today: <strong>soup</strong> &lt;hot&gt; <x-price data-value="4">4 €</x-price></p>
      <ul><li>Soup<li>Pie</ul>
      <dl><dt>Soup<dd>Hot</dl>
      <table><tr><th>Dish<th>Price<tr><td>Soup<td>4</table>
      <x-icon/>
    </main>
  </body>
</html>`,
  "templates, in tables too": `<ul><template><li><b>name</b></li></template></ul>
<table><tbody><template><tr><td>cell</td></tr></template></tbody></table>`,
  "SVG and MathML, whose names parse5 adjusts": `<svg viewbox="0 0 10 10"><a xlink:href="#a"><path d="M0 0"/></a><foreignobject><div>x</div></foreignobject></svg>
<math><mi>x</mi><mo>+</mo></math>`,
  "what a <noscript> or <select> holds": `<body><noscript><p><div>Enable JavaScript</div></p></noscript>
<select><button><selectedcontent></selectedcontent></button><option><span>A</span></option></select></body>`,
  "an empty document": "",
  "CR LF in an attribute, which a browser reads as LF": `<img alt="Two\r\nlines" src="/a.png"><p title="a\rb">x</p>`,
};

/** A document `build` renders through the DOM, and the markup it is written as: `doctype`, then its `outerHTML`. */
const written = (build: (body: HTMLElement, document: Document) => void, doctype = "<!doctype html>") => {
  const document = window.document.implementation.createHTMLDocument();
  build(document.body, document);
  return [document, `${doctype}${document.documentElement.outerHTML}`] as const;
};

/** Trees scripts build that no markup gives a browser, with where. */
const BUILT: [string, (body: HTMLElement, document: Document) => void, ParseDifference][] = [
  [
    "a <div> appended to a <p>",
    (body, document) => {
      const paragraph = document.createElement("p");
      paragraph.append(document.createElement("div"));
      body.append(paragraph);
    },
    { path: "html > body > p", here: "<div>", browser: "nothing", line: 1, column: 44 },
  ],
  [
    "an <a> appended to an <a>",
    (body, document) => {
      const outer = Object.assign(document.createElement("a"), { href: "/a" });
      outer.append(Object.assign(document.createElement("a"), { href: "/b", textContent: "B" }));
      body.append(outer);
    },
    { path: "html > body > a", here: "<a>", browser: "nothing", line: 1, column: 54 },
  ],
  [
    "rows appended straight to a <table>, which a browser puts in a <tbody>",
    (body, document) => {
      const row = document.createElement("tr");
      row.append(Object.assign(document.createElement("td"), { textContent: "1" }));
      body.append(document.createElement("table"));
      body.firstElementChild!.append(row);
    },
    { path: "html > body > table", here: "<tr>", browser: "<tbody>", line: 1, column: 48 },
  ],
];

describe("findParseDifference", () => {
  it.each(DIFFERENT)("finds %s", (_, html, difference) => {
    expect(findParseDifference(window, html)).toEqual(difference);
  });

  it.each(BUILT)("finds %s in the document the markup was written from", (_, build, difference) => {
    expect(findParseDifference(...written(build))).toEqual(difference);
  });

  it("finds nothing in a built document a browser parses back the same, and keeps it whole", () => {
    const [document, html] = written((body) => {
      body.innerHTML = `<main id="menu"><h1>Menu</h1><ul><li>Soup</li><li>Pie</li></ul></main>`;
    });
    expect(findParseDifference(document, html)).toBeNull();
    expect(html).toBe(`<!doctype html>${document.documentElement.outerHTML}`);
  });

  it("reads markup without a doctype in quirks mode, as a browser does: a <table> stays in a <p>", () => {
    const build = (body: HTMLElement, document: Document) => {
      const paragraph = document.createElement("p");
      paragraph.append(document.createElement("table"));
      body.append(paragraph);
    };
    expect(findParseDifference(...written(build))).toEqual({
      path: "html > body > p",
      here: "<table>",
      browser: "nothing",
      line: 1,
      column: 44,
    });
    expect(findParseDifference(...written(build, ""))).toBeNull();
  });

  it("finds nothing in the `is` markup spells out for a customized built-in", () => {
    const [document, html] = written((body, document) => {
      body.append(document.createElement("button", { is: "wren-button" }));
    });
    expect(html).toContain(`<button is="wren-button">`);
    expect(findParseDifference(document, html)).toBeNull();
    // an `is` attribute both trees have still compares
    document.body.firstElementChild!.setAttribute("is", "wren-button");
    expect(findParseDifference(document, html.replace("wren-button", "other-button"))).toMatchObject({
      here: `<button is="wren-button">`,
      browser: `<button is="other-button">`,
    });
  });

  it.each(Object.entries(AGREED))("finds nothing in %s", (_, html) => {
    expect(findParseDifference(window, html)).toBeNull();
  });

  // happy-dom names the window after each id it parses, keeping the whole page
  it("leaves no element of the page on the window", () => {
    findParseDifference(window, `<main id="parsed-main"><p id="parsed-intro">Hi</p></main>`);
    expect(["parsed-main", "parsed-intro"].filter((id) => id in window)).toEqual([]);
  });
});
