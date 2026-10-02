import type { DomWindow } from "./window";
import { type DefaultTreeAdapterTypes as Parse5, parse } from "parse5";

/** Where a browser builds a different element tree from the same markup. */
export type ParseDifference = {
  /** The parent both trees agree on, as tag names: `html > body > article > p`, with `#id` where it has one. */
  path: string;
  /** What `here`'s tree has there: a tag such as `<section>` (with the attributes that differ, when only they do), or `nothing`. */
  here: string;
  /** What a browser puts there, in the same form. */
  browser: string;
  /**
   * Where the browser's tree departs in the markup, 1-based: its node's
   * start, or where it closed the parent when it has nothing there (where
   * the `unclosed` element starts, when that is why). A node it implied (no
   * tag in the markup) starts with its content, else where the markup
   * before it ends.
   */
  line: number;
  column: number;
  /**
   * The element a browser never closed, reading the rest of the file into
   * it, when that is why it has nothing there: `<title>` or `<noscript>`
   * (as its text), `<select>`.
   */
  unclosed?: string;
};

type Parent = Parse5.ParentNode;
type Child = Parse5.ChildNode;
type Position = Pick<ParseDifference, "line" | "column" | "unclosed">;

// not compared within, unless a browser never closes them: a scripting
// browser reads a <noscript>'s content as text; parse5 8 drops what a
// <select> holds, as browsers did before customizable selects (2025)
const UNCOMPARED = ["noscript", "select"];
const HTML = "http://www.w3.org/1999/xhtml";
// elements whose content a browser reads as text
const TEXT_ONLY = [
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
];

const at = (line: number, column: number): Position => ({ line, column });

/** A parse5 parent's child nodes: a template's are in its content. */
const nodesOf = (parent: Parent): Child[] =>
  ("content" in parent ? parent.content : parent).childNodes;

const lastLocation = (nodes: Child[]) =>
  nodes.findLast(({ sourceCodeLocation }) => sourceCodeLocation)
    ?.sourceCodeLocation;

/** Lower-cased names (parse5 adjusts the case of some SVG ones) to values. */
const attributesOf = (attributes: { name: string; value: string }[]) =>
  new Map(attributes.map(({ name, value }) => [name.toLowerCase(), value]));

// a browser reads CR LF and CR in markup as LF before it parses
const ownAttributes = (element: Element) =>
  attributesOf(
    Array.from(element.attributes, ({ name, value }) => ({
      name,
      value: value.replace(/\r\n?/g, "\n"),
    }))
  );

const browserAttributes = ({ attrs }: Parse5.Element) =>
  attributesOf(
    attrs.map(({ prefix, name, value }) => ({
      name: prefix ? `${prefix}:${name}` : name,
      value,
    }))
  );

/** Where `node` starts; one the browser implied (no tag) starts with its content. */
const startOf = (node: Child): Position | undefined => {
  const location = node.sourceCodeLocation;
  if (location) return at(location.startLine, location.startCol);
  // only an implied element has no location
  return nodesOf(node as Parent).reduce<Position | undefined>(
    (found, child) => found ?? startOf(child),
    undefined
  );
};

/** Where the markup before `node`, a child of the last of `ancestors`, ends. */
const endBefore = (ancestors: Parent[], node: Child): Position => {
  const parent = ancestors.at(-1)!;
  const siblings = nodesOf(parent);
  const previous = lastLocation(siblings.slice(0, siblings.indexOf(node)));
  const tag = (parent as Parse5.Element).sourceCodeLocation?.startTag;
  if (previous) return at(previous.endLine, previous.endCol);
  if (tag) return at(tag.endLine, tag.endCol);
  return ancestors.length > 1
    ? endBefore(ancestors.slice(0, -1), parent as Child)
    : at(1, 1);
};

/** `parent`'s last node, that one's last, and so on: what reaches the end of the file when `parent` is the document. */
const lastNodes = (parent: Parent): Child[] => {
  const last = nodesOf(parent).at(-1);
  return last ? [last, ...("childNodes" in last ? lastNodes(last) : [])] : [];
};

/**
 * Whether a browser never closed `element` of the document `root`, reading
 * the rest of the file into it: a text-only one with no end tag, or a
 * `<select>` with none that reaches the end (another tag may close one).
 */
const runsToEnd = (element: Parse5.Element, root: Parent): boolean =>
  element.namespaceURI === HTML &&
  !element.sourceCodeLocation?.endTag &&
  (TEXT_ONLY.includes(element.tagName) ||
    (element.tagName === "select" && lastNodes(root).includes(element)));

/** The element last in `parent`'s last ones that runs to the end of the file. */
const unclosedIn = (
  parent: Parent,
  root: Parent
): Parse5.Element | undefined => {
  const last = nodesOf(parent).at(-1);
  if (!last || !("tagName" in last)) return undefined;
  return runsToEnd(last, root) ? last : unclosedIn(last, root);
};

/** Where the browser closed the last of `ancestors`: its end tag, the token that did, or the element that ran to the end of the file. */
const closeOf = (ancestors: Parent[]): Position => {
  const parent = ancestors.at(-1) as Parse5.Element;
  const location = parent.sourceCodeLocation;
  if (location?.endTag)
    return at(location.endTag.startLine, location.endTag.startCol);
  const unclosed = unclosedIn(parent, ancestors[0]);
  if (unclosed)
    return { ...startOf(unclosed)!, unclosed: `<${unclosed.tagName}>` };
  // the later: one it implied, and a <body> left open in an <html> it
  // implied, keep no end of their own, but close after their content
  const end = [location, lastLocation(nodesOf(parent))].reduce((later, next) =>
    next && (!later || next.endOffset > later.endOffset) ? next : later
  );
  return end
    ? at(end.endLine, end.endCol)
    : endBefore(ancestors.slice(0, -1), parent);
};

/** `<tag>`, with the values of `names` it has. */
const tagOf = (tag: string, attributes: Map<string, string>, names: string[]) =>
  `<${tag}${names
    .filter((name) => attributes.has(name))
    .map((name) => ` ${name}=${JSON.stringify(attributes.get(name))}`)
    .join("")}>`;

/** The difference at `own` / `other`, children of the last of `ancestors` (either may be missing), showing attributes `names`. */
const differenceAt = (
  ancestors: Parent[],
  own: Element | undefined,
  other: Parse5.Element | undefined,
  names: string[] = []
): ParseDifference => ({
  path: (ancestors.slice(1) as Parse5.Element[])
    .map(({ tagName, attrs }) => {
      const id = attrs.find(({ name }) => name === "id")?.value;
      return id ? `${tagName}#${id}` : tagName;
    })
    .join(" > "),
  here: own ? tagOf(own.localName, ownAttributes(own), names) : "nothing",
  browser: other
    ? tagOf(other.tagName, browserAttributes(other), names)
    : "nothing",
  ...(other
    ? (startOf(other) ?? endBefore(ancestors, other))
    : closeOf(ancestors)),
});

/** `parent`'s element children: a template's are in its content. */
const ownElements = (parent: ParentNode): Element[] => {
  const { localName, namespaceURI } = parent as Element;
  return Array.from(
    (localName === "template" && namespaceURI === HTML
      ? (parent as HTMLTemplateElement).content
      : parent
    ).children
  );
};

/** The first difference between `here`'s subtree and the browser's, the last of `ancestors`. */
const differenceIn = (
  here: ParentNode,
  ancestors: Parent[]
): ParseDifference | null => {
  const ours = ownElements(here);
  const theirs = nodesOf(ancestors.at(-1)!).filter(
    (node): node is Parse5.Element => "tagName" in node
  );
  for (const index of Array(Math.max(ours.length, theirs.length)).keys()) {
    const own = ours[index];
    const other = theirs[index];
    if (
      !own ||
      !other ||
      own.localName.toLowerCase() !== other.tagName.toLowerCase()
    )
      return differenceAt(ancestors, own, other);
    const mine = ownAttributes(own);
    const yours = browserAttributes(other);
    const differing = [...new Set([...mine.keys(), ...yours.keys()])].filter(
      (name) =>
        mine.get(name) !== yours.get(name) &&
        // markup spells out the `is` a customized built-in was created with
        !(name === "is" && !mine.has(name))
    );
    if (differing.length) return differenceAt(ancestors, own, other, differing);
    const uncompared = UNCOMPARED.includes(own.localName);
    // one a browser never closed takes the rest of the file: what it holds
    // here is lost there
    const unclosed = uncompared && runsToEnd(other, ancestors[0]);
    const inside =
      uncompared && !unclosed ? null : differenceIn(own, [...ancestors, other]);
    if (inside)
      return unclosed
        ? { ...inside, ...startOf(other)!, unclosed: `<${other.tagName}>` }
        : inside;
  }
  return null;
};

/**
 * Where a browser builds other elements from `html` than `here` holds: the
 * first place, in document order, where the element trees differ in tags,
 * their order and nesting (template content too), attribute names or
 * values; `null` when they agree. `here` is the document `html` was written
 * from (a server-rendered page: its doctype, then its `outerHTML`), or a
 * window whose parser reads `html` too. `html` should carry the page's
 * doctype: without one a browser parses in quirks mode, where a `<table>`
 * stays in a `<p>`. Catches what a server render (SSR) builds that a
 * browser builds otherwise: its parser moves a block element out of a
 * `<p>`, ends an `<a>` at the next one, and reads a tag in a `<title>` or
 * `<textarea>` as text up to that element's end tag or the end of the file.
 * Text and comments are not compared, nor what a `<noscript>` or `<select>`
 * holds, unless its end tag never comes. Namespaces are not compared:
 * happy-dom builds MathML, and HTML inside `<foreignObject>`, in other
 * namespaces than a browser. A window should define no element: its parser
 * constructs the ones defined there.
 */
export const findParseDifference = (
  here: DomWindow | Document,
  html: string
): ParseDifference | null => {
  const tree =
    "documentElement" in here
      ? here
      : new here.DOMParser().parseFromString(html, "text/html");
  try {
    return differenceIn(tree, [
      parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true }),
    ]);
  } finally {
    // happy-dom points `here[id]` at the first element of each id parsed
    // there, keeping its whole document: detached, it lets go
    if (tree !== here) tree.documentElement.remove();
  }
};
