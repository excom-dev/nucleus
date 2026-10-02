import { openingTag } from "./diagnostics";
import { loadStateAttributes } from "./load-state";
import type { HydrationIsland } from "@excom/kit-utils";

// what an element whose data stays out of the island must not claim
const LOADED = loadStateAttributes("loaded");

/** The kit-utils names of the island and its markers. */
export interface IslandNames {
  HYDRATION_ISLAND_ID: string;
  SSR_ATTR: string;
  INERT_ATTR: string;
}

/** What the shell parsed into, before the render touched it. */
export interface ShellSnapshot {
  /** `<head>` nodes: any other one the render added. */
  head: ReadonlySet<Node>;
  /**
   * The shell's markup, parsed where no element is defined and nothing
   * runs: its scripts, styles, comments and declarative shadow roots are
   * no render's doing, and serialize back as parsed.
   */
  parsed: Document;
}

export interface SerializeOptions {
  names: IslandNames;
  responses: HydrationIsland["responses"];
  shell: ShellSnapshot;
  /** The shell's own doctype, or `""`. */
  doctype: string;
}

export interface Serialized {
  html: string;
  /** Markup that would read differently once parsed from the file, and leaked build paths. */
  errors: string[];
  skippedProvisions: string[];
  neutralizedScripts: number;
  neutralizedShadowRoots: number;
  islandBytes: number;
}

// head nodes a render may add: SEO, and idempotent in the browser
const KEPT_HEAD = "title, meta, link[rel~=canonical]";

// what a browser runs or applies: classic (no / a JavaScript type), module,
// import map, speculation rules. Any other type is a data block.
const EXECUTABLE =
  /^(|module|importmap|speculationrules|(application|text)\/(x-)?(java|ecma)script|text\/javascript1\.[0-5]|text\/(jscript|livescript))$/i;

// serialized raw, so text holding these ends the element or opens a comment
const RAW_TEXT = ["script", "style"];
const RAW_TEXT_END = /<\/(script|style)|<!--/i;
// a comment starting `>` / `->` or holding `-->` / `--!>` ends early
const COMMENT_END = /^-?>|--!?>|-$/;
// a tag name runs to whitespace, `/` or `>`: anything else is markup
const ELEMENT_NAME = /^[a-z][^\s/>\0]*$/i;
const FILE_URL = /\bfile:/i;

/** Whether a browser would run `script` once the page is parsed (a `type` parameter aside). */
export const isExecutable = (script: Element): boolean =>
  EXECUTABLE.test((script.getAttribute("type") ?? "").split(";")[0].trim());

/** `root` and the content of each `<template>` in it, nested ones too. */
const contentsOf = (root: ParentNode): ParentNode[] => [
  root,
  ...Array.from(root.querySelectorAll("template")).flatMap((template) =>
    contentsOf(template.content)
  ),
];

/** `selector`'s matches in `root` and in its templates' content. */
export const queryDeep = (root: ParentNode, selector: string): Element[] =>
  contentsOf(root).flatMap((part) =>
    Array.from(part.querySelectorAll(selector))
  );

const commentsIn = (node: Node): Comment[] =>
  Array.from(node.childNodes).flatMap((child) =>
    child.nodeType === 8 ? [child as Comment] : commentsIn(child)
  );

/** Every comment in `root` and in its templates' content. */
const commentsDeep = (root: ParentNode): Comment[] =>
  contentsOf(root).flatMap(commentsIn);

/** A multiset of `keys`: `take(key)` is true while one of them is left. */
const counted = (keys: string[]) => {
  const counts = new Map<string, number>();
  keys.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
  return (key: string) => {
    const left = counts.get(key) ?? 0;
    counts.set(key, left - 1);
    return left > 0;
  };
};

const textKey = (node: Node) =>
  `${node.nodeName}\0${node.nodeType === 8 ? (node as Comment).data : node.textContent}`;

/** Elements and comments that would serialize as other markup, and `file:` URLs. */
const unsafeMarkup = (document: Document, { parsed }: ShellSnapshot) => {
  const elements = queryDeep(document, "*");
  // parsed from the shell: its text serializes back as it was written
  const fromShell = counted(
    [...queryDeep(parsed, "script, style"), ...commentsDeep(parsed)].map(
      textKey
    )
  );
  return [
    ...elements
      .filter(({ localName }) => !ELEMENT_NAME.test(localName))
      .map(
        ({ localName }) =>
          `Element name ${JSON.stringify(localName)} is not valid HTML: written to the file, it is other markup`
      ),
    ...elements
      .filter(
        (element) =>
          RAW_TEXT.includes(element.localName) &&
          RAW_TEXT_END.test(element.textContent!) &&
          !fromShell(textKey(element))
      )
      .map(
        (element) =>
          `${openingTag(element)} holds "</script", "</style" or "<!--": parsed from the file, its text would end early`
      ),
    ...commentsDeep(document)
      .filter(
        (comment) =>
          COMMENT_END.test(comment.data) && !fromShell(textKey(comment))
      )
      .map(
        ({ data }) =>
          `Comment ${JSON.stringify(data.slice(0, 40))} would end early once parsed from the file`
      ),
    ...elements
      .filter((element) =>
        [
          ...Array.from(element.attributes, ({ value }) => value),
          RAW_TEXT.includes(element.localName) ? element.textContent! : "",
        ].some((text) => FILE_URL.test(text))
      )
      .map(
        (element) =>
          `${openingTag(element)} holds a file: URL from the build machine`
      ),
  ];
};

const isPlain = (value: unknown, ancestors: object[]): boolean => {
  if (value === null || ["string", "boolean"].includes(typeof value))
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.includes(value)) return false;
  const path = [...ancestors, value];
  if (Array.isArray(value))
    return (
      typeof (value as { toJSON?: unknown }).toJSON !== "function" &&
      Array.from(value).every(
        (item) => item !== undefined && isPlain(item, path)
      )
    );
  const proto = Object.getPrototypeOf(value);
  return (
    (proto === Object.prototype || proto === null) &&
    !Object.getOwnPropertySymbols(value).length &&
    Object.getOwnPropertyNames(value).length === Object.keys(value).length &&
    Object.values(value).every(
      (item) => item === undefined || isPlain(item, path)
    )
  );
};

/**
 * Whether `value` comes back from a JSON round trip as the same data: `null`,
 * booleans, finite numbers (`-0` comes back `0`), strings, and arrays and
 * plain objects of them, with no cycle. An array's extra own properties (a
 * RegExp match's `index`) and an object's `undefined` properties are
 * dropped, as JSON drops them. Not plain: functions, symbols, bigints,
 * `NaN`, holes, class instances (`Date`, `Map`, nodes), a `toJSON` method,
 * non-enumerable properties, and anything a getter throws on.
 */
export const isPlainData = (value: unknown): boolean => {
  try {
    return isPlain(value, []);
  } catch {
    return false;
  }
};

/**
 * JSON for a `<script>` data block: `<` and U+2028 / U+2029 as `\u`
 * escapes, so no string in it can close the script (`</script>`), open a
 * comment (`<!--`) or break a line.
 */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value).replace(
    /[<\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );

/** The URL a `FetchableElement` provision's data came from: its `url`, beside a numeric `status`. */
const sourceOf = (provision: unknown) => {
  const { url, status } = provision as { url?: unknown; status?: unknown };
  return typeof url === "string" && typeof status === "number"
    ? url
    : undefined;
};

/**
 * The rendered page as HTML that hydrates: `<html n-ssr>`, every custom
 * element whose `provision` is plain data from the island's own responses
 * marked `n-ssr="<id>"` (one whose data is not in the island written not
 * loaded: no `is-success` / `did-load`), executable scripts and declarative
 * shadow roots the render inserted made inert, `q-scope` ids and head nodes
 * added by the render dropped, the island (`provisions`, `responses`) last
 * in `<body>`. Writes to the document, which is thrown away afterwards.
 */
export const serialize = (
  document: Document,
  { names, responses, shell, doctype }: SerializeOptions
): Serialized => {
  const { HYDRATION_ISLAND_ID, SSR_ATTR, INERT_ATTR } = names;
  const root = document.documentElement;
  const view = document.defaultView!;
  const relative = (url: string) => {
    const parsed = new URL(url, view.location.href);
    return parsed.origin === view.location.origin
      ? parsed.pathname + parsed.search
      : parsed.href;
  };
  const recorded = new Set(
    responses.flatMap(({ url, record }) => [url, relative(record.url)])
  );
  const provisions: Record<string, unknown> = {};
  const skippedProvisions: string[] = [];
  // first: a bundler's `file:` modulepreload links go, and are not checked
  Array.from(document.head.childNodes)
    .filter(
      (node) => !shell.head.has(node) && !(node as Element).matches?.(KEPT_HEAD)
    )
    .forEach((node) => node.remove());
  const errors = unsafeMarkup(document, shell);
  // ids from a page this one was rendered from, or copied with markup
  queryDeep(document, `[${SSR_ATTR}]`).forEach((element) =>
    element.removeAttribute(SSR_ATTR)
  );
  root.setAttribute(SSR_ATTR, "");
  for (const element of Array.from(document.querySelectorAll("*"))) {
    const { provision } = element as Element & { provision?: unknown };
    if (!view.customElements.get(element.localName) || provision == null)
      continue;
    const source = sourceOf(provision);
    const plain = isPlainData(provision);
    const skipped = !plain
      ? "not plain data"
      : source !== undefined && !recorded.has(relative(source))
        ? `its data (${relative(source)}) is not in the island: excluded, or not recordable`
        : undefined;
    if (skipped) {
      skippedProvisions.push(`${openingTag(element)}: ${skipped}`);
      // its data is not in the island: loaded, rules keyed on the state would
      // run without it in the browser. It fetches as on a cold load instead,
      // its content in place
      if (plain) LOADED.forEach((name) => element.removeAttribute(name));
      continue;
    }
    const id = String(Object.keys(provisions).length);
    element.setAttribute(SSR_ATTR, id);
    provisions[id] = provision;
  }
  // in templates too: run once cloned. Data blocks (JSON-LD) stay as they are
  const scripts = queryDeep(document, `script[${INERT_ATTR}]`).filter(
    isExecutable
  );
  scripts.forEach((script) => script.setAttribute("type", "text/plain"));
  // inert where the render inserted them; the shell's attach as on a cold load
  const shadowRootKey = (template: Element) =>
    `${template.getAttribute("shadowrootmode")}\0${template.innerHTML}`;
  const ownShadowRoot = counted(
    queryDeep(shell.parsed, "template[shadowrootmode]").map(shadowRootKey)
  );
  const shadowRoots = queryDeep(document, "template[shadowrootmode]").filter(
    (template) => !ownShadowRoot(shadowRootKey(template))
  );
  shadowRoots.forEach((template) => template.removeAttribute("shadowrootmode"));
  document
    .querySelectorAll("[q-scope]")
    .forEach((element) => element.removeAttribute("q-scope"));
  const island: HydrationIsland = { v: 1, provisions, responses };
  const json = scriptJson(island);
  document.body.append(
    Object.assign(document.createElement("script"), {
      type: "application/json",
      id: HYDRATION_ISLAND_ID,
      textContent: json,
    })
  );
  return {
    html: `${doctype}${root.outerHTML}`,
    errors,
    skippedProvisions,
    neutralizedScripts: scripts.length,
    neutralizedShadowRoots: shadowRoots.length,
    islandBytes: new TextEncoder().encode(json).byteLength,
  };
};
