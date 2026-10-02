import { HAPPY_DOM } from "./happy-dom";
import { builtin } from "./node";
import { claim, type DomWindow } from "./window";

const SHIMMED = Symbol.for("@excom/nucleus-dom/stray-markup");
const HTML = "http://www.w3.org/1999/xhtml";
// Special elements a stray end tag stops at. Not those a browser may close
// while happy-dom keeps them open: the ones a start tag closes implicitly
// (`<p>`, `<li>`, `<dd>`, `<dt>`, headings, `<button>`, `<select>`, `<head>`,
// table parts) and `<form>` (a nested form's end tag closes it); `<table>`
// stays, as the start tag that closes one opens the next. Not void or raw
// text ones: never open in a browser at an end tag. Not `search`: not special
// in parse5 8, the tests' judge.
const BOUNDARY = new Set(
  "address applet article aside blockquote body center details dir div dl fieldset figcaption figure footer frameset header hgroup html listing main marquee menu nav object ol pre section summary table template ul".split(
    " "
  )
);
// read as text by a browser, as markup by happy-dom
const RAW_TEXT =
  "iframe noembed noframes noscript plaintext textarea title xmp";
// end tags with a rule of their own (special, formatting and raw text
// elements, `dialog`, `option`, `optgroup`): only a `<template>` stops them
const OWN_RULE = new Set([
  ...BOUNDARY,
  ...`p li dd dt h1 h2 h3 h4 h5 h6 button select head form caption colgroup tbody td tfoot th thead tr search a b big code em font i nobr s small strike strong tt u dialog option optgroup script style ${RAW_TEXT}`.split(
    " "
  ),
]);
// with one open no end tag is stray: happy-dom builds MathML and raw text as
// HTML elements
const UNPARSED = new Set(["math", ...RAW_TEXT.split(" ")]);
// a stray end tag and `-->`, and how browsers read them
const PROBE = "<span><div></span>a-->";
const PROBED = "<span><div>a--&gt;</div></span>";

/** happy-dom's `HTMLParser`, the parts read here. */
interface Parser {
  nodeStack: Node[];
  readState: string;
  markupRegExp: RegExp | null;
  parse(html: string, root?: Node): Node;
  parseEndTag(tagName: string): void;
}

const fail = (reason: string) => {
  throw new Error(
    `nucleus-dom cannot correct happy-dom's parse of stray markup: ${reason} (nucleus-dom pins happy-dom ${HAPPY_DOM})`
  );
};

/** Whether end tag `name` closes nothing: its element is out of reach. */
const isStray = ({ nodeStack }: Parser, name: string) => {
  const generic = !OWN_RULE.has(name);
  for (let i = nodeStack.length - 1; i > 0; i--) {
    const { localName, namespaceURI } = nodeStack[i] as Element;
    // SVG keeps its case (`foreignObject`)
    if (localName.toLowerCase() === name) return false;
    if (
      namespaceURI === HTML &&
      (localName === "template" || (generic && BOUNDARY.has(localName)))
    )
      return !nodeStack.some((node) =>
        UNPARSED.has((node as Element).localName)
      );
  }
  return false;
};

/**
 * Makes `parser` skip, between tags, the matches that only end markup
 * (`-->` / `--!>`, `/>`, `>`): text up to the next tag, one node.
 */
const readTextRuns = (parser: Parser) => {
  let markup: RegExp | null = null;
  Object.defineProperty(parser, "markupRegExp", {
    configurable: true,
    get: () => markup,
    // `parse()` sets a new one each call
    set(regExp: RegExp) {
      regExp.exec = (html: string) => {
        let match: RegExpExecArray | null;
        do match = RegExp.prototype.exec.call(regExp, html);
        while (
          parser.readState === "any" &&
          (match?.[4] || match?.[7] || match?.[8])
        );
        return match;
      };
      markup = regExp;
    },
  });
};

/**
 * Corrects happy-dom's parse of stray markup: an end tag closes nothing past a
 * `<template>`, nor past a special element such as `<div>` when it names a
 * `<span>` or a custom element, and a `-->` or `>` between tags joins the text
 * around it (happy-dom read `&#x3C;!-- a -->` as `<!-- a <!-- a -->`).
 * happy-dom's parse stays past elements a browser may have closed (`<p>`,
 * `<li>`, headings, `<button>`, `<select>`, `<form>`, table parts), for
 * formatting end tags and inside `<math>` or raw text. Patches happy-dom's
 * parser, so it applies to every window in the process; throws when `win`'s
 * happy-dom is another copy.
 */
export function ignoreStrayMarkup(win: DomWindow | typeof globalThis): void {
  const require = builtin("node:module").createRequire(import.meta.url);
  const { default: HTMLParser } =
    require("happy-dom/lib/html-parser/HTMLParser.js") as {
      default: { prototype: Parser };
    };
  const proto = HTMLParser.prototype;
  const { parse, parseEndTag } = proto;
  const missing = ["parse", "parseEndTag"].filter(
    (name) => typeof proto[name as keyof Parser] !== "function"
  );
  if (missing.length)
    fail(`happy-dom's parser has no ${missing.join("(), ")}()`);
  if (claim(proto, SHIMMED)) {
    proto.parse = function (this: Parser, html, root) {
      readTextRuns(this);
      return parse.call(this, html, root);
    };
    proto.parseEndTag = function (this: Parser, tagName) {
      if (!isStray(this, tagName.toLowerCase()))
        parseEndTag.call(this, tagName);
    };
  }
  const probe = win.document.createElement("div");
  probe.innerHTML = PROBE;
  if (probe.innerHTML !== PROBED)
    fail("this window's happy-dom is not the copy nucleus-dom patches");
}
