import { type BrowserPage, SETTLE_MS, until } from "./browser-page";
import { inertDom } from "./inert";
import { loadStateAttributes } from "./load-state";
import { KEPT_HEAD } from "./serialize";
import { parseTree, type TreeNode } from "@excom/nucleus-dom";

/** Where the prerendered file and the cold page differ. */
export interface RenderDifference {
  /** The element, or the parent of a node only one side has: `html > body > main#content > ul[class="nav"]`. */
  path: string;
  /** What the prerendered file has there: a node (`<li class="a">`, `"text"`, `<!--note-->`), an attribute (`[name="value"]`), or `nothing`. */
  server: string;
  /** What the cold page has there, in the same form. */
  browser: string;
}

/**
 * Whether the server rendered what a browser renders, as `compareColdRender`
 * saw it: both documents parsed as a browser parses them and compared as
 * trees, attributes in any order. Left out by design: the markers each side
 * writes for itself, the island, the loaded state of an element written not
 * loaded, declarative shadow roots (a browser attaches the shell's, the
 * serializer makes a render's inert); in `<head>`, what the serializer drops
 * from a render; a `no-ssr` region; the own attributes of `clientOnly` tags;
 * `lazy-load` views the browser has not activated; what `allow` matches.
 */
export interface ColdRenderReport {
  /** The server rendered more: nodes and attributes only the prerendered file has. The first 20, in document order. */
  serverOnly: RenderDifference[];
  /** The browser rendered more: nodes and attributes only the cold page has. The first 20. */
  browserOnly: RenderDifference[];
  /** Both have a node or attribute there, and they differ: a tag, a value, a text. The first 20. */
  different: RenderDifference[];
  /** How many differences of each kind there are. All 0: the server rendered what a browser renders. */
  counts: { serverOnly: number; browserOnly: number; different: number };
  /** `lazy-load` views the cold page has not activated (out of view): their attributes and content are not compared. */
  lazyViews: number;
}

export interface ColdRenderOptions {
  /** Origin serving the prerendered build, e.g. `http://localhost:4173`: the server's side is the page's file as written. */
  served: string;
  /** Origin serving the same build with the untouched shell in place of every prerendered page (`serveSite({ shell })` of `@excom/vite-plugin-nucleus/host`). */
  cold: string;
  /**
   * Hidden or loading states besides the kit's `is-loading` and
   * `delaying-ready`, as a selector, e.g. `spa-manager:not([has-rendered])`:
   * the cold page has rendered once none is left outside a `no-ssr` region
   * for two frames.
   */
  loading?: string;
  /** Tags of elements a prerender never upgrades, e.g. nucleus-kit's `SERVER_EXCLUDED_TAGS`: their own attributes are not compared, what they hold is. */
  clientOnly?: readonly string[];
  /** Differences the site makes by design: one whose line, `<path>: server <server>, browser <browser>`, one of them matches is left out. */
  allow?: readonly RegExp[];
}

type Tag = Extract<TreeNode, { tag: string }>;
type Kind = keyof ColdRenderReport["counts"];
type Rules = Required<Pick<ColdRenderOptions, "clientOnly" | "allow">>;

/** Differences kept per kind. */
const LIMIT = 20;

// The differences by design, one rule each:
// 1. What the prerender writes for itself (nucleus-ssr's serializer, kit-utils,
//    Quark): never in a browser's DOM
const SERVER_MARKS = new Set([
  "n-ssr",
  "n-tpl",
  "n-tpl-id",
  "n-inert",
  "q-key",
]);
// 1. ...and what only the browser writes: Quark's host ids, kit-utils' momentary `:scope` id
const BROWSER_MARKS = /^(q-scope$|n-util-select-id-)/;
// 1. ...the island, last in `<body>`
const ISLAND_ID = "nucleus-hydration";
// 1. ...the loaded state of an element written not loaded (no `n-ssr` id): its
//    data stayed out of the island, or the prerender never fetched (an idle
//    `pre-fetch` include)
const LOADED = loadStateAttributes("loaded");
// 1. ...declarative shadow roots: a browser attaches the shell's (`outerHTML`
//    leaves them out); the serializer strips the attribute from a render's
//    (a browser's `innerHTML` keeps them as templates)
const SHADOW_ROOT = "shadowrootmode";
// 2. `<head>`: `KEPT_HEAD`, what the serializer keeps of a render's additions;
//    the rest is the shell's, and the bundler's preloads
// 3. A region kept out of the prerender: its own attributes and what it holds
const NO_SSR = "no-ssr";
// 4. A lazy view: the prerender renders every one, a browser only those in view
const LAZY = "lazy-load";
// 5. What a site makes by design: `allow`

// what the cold page waits for besides a site's `loading`: the states a
// prerender never writes, so a compared element is never caught loading
const WAITING = loadStateAttributes("waiting")
  .map((name) => `[${name}]`)
  .join(", ");

const has = (node: Tag, name: string) => Object.hasOwn(node.attributes, name);

/** `parent`'s children, the island left out. */
const childrenOf = (parent: Tag): TreeNode[] =>
  parent.children.filter(
    (node) =>
      !(
        "tag" in node &&
        node.tag === "script" &&
        node.attributes.id === ISLAND_ID
      )
  );

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

const attribute = (name: string, value: string) =>
  value ? `[${name}="${clip(value, 80)}"]` : `[${name}]`;

/** A node as a difference shows it. */
const label = (node: TreeNode): string =>
  "tag" in node
    ? clip(
        `<${node.tag}${Object.entries(node.attributes)
          .map(([name, value]) => (value ? ` ${name}="${value}"` : ` ${name}`))
          .join("")}>`,
        120
      )
    : "text" in node
      ? JSON.stringify(clip(node.text, 60))
      : "comment" in node
        ? `<!--${clip(node.comment, 60)}-->`
        : `<!doctype ${node.doctype}>`;

/** An element in a path, as the hydration check names it: its tag, `#id`, `bind-*`, `class` and `api-url`. */
const step = ({ tag, attributes }: Tag) =>
  `${tag}${attributes.id ? `#${attributes.id}` : ""}${Object.entries(attributes)
    .filter(
      ([name]) =>
        name.startsWith("bind-") || name === "class" || name === "api-url"
    )
    .map(([name, value]) => attribute(name, value))
    .join("")}`;

/** What a node is, for pairing: an element by its tag. */
const keyOf = (node: TreeNode) =>
  "tag" in node ? `<${node.tag}` : Object.keys(node)[0];

/** What a node holds, for a pair: an element its tag, a leaf its text too. */
const contentOf = (node: TreeNode) =>
  "tag" in node ? keyOf(node) : Object.entries(node)[0].join(":");

/** FNV-1a, as base 36. */
const hash = (text: string) =>
  (
    Array.from(text).reduce(
      (h, char) => Math.imul(h ^ char.codePointAt(0)!, 0x01000193),
      0x811c9dc5
    ) >>> 0
  ).toString(36);

/** A subtree's digest, markers left out: equal subtrees pair first. */
const fingerprints = new WeakMap<TreeNode, string>();
const fingerprintOf = (node: TreeNode): string => {
  const known = fingerprints.get(node);
  if (known !== undefined) return known;
  const digest =
    "tag" in node
      ? hash(
          `${node.tag}\0${Object.entries(node.attributes)
            .filter(
              ([name]) => !SERVER_MARKS.has(name) && !BROWSER_MARKS.test(name)
            )
            .map(([name, value]) => `${name}=${value}`)
            .sort()
            .join("\0")}\0${childrenOf(node).map(fingerprintOf).join(",")}`
        )
      : hash(contentOf(node));
  fingerprints.set(node, digest);
  return digest;
};

/** How well two nodes pair: 2 the same subtree, 1 the same kind or tag, 0 not at all. */
const scoreOf = (a: TreeNode, b: TreeNode) =>
  keyOf(a) !== keyOf(b) ? 0 : fingerprintOf(a) === fingerprintOf(b) ? 2 : 1;

/**
 * Pairs two lists of siblings, in order, as many and as alike as possible:
 * equal subtrees at either end at once, the rest by a longest common
 * subsequence, weighted by `scoreOf`. Between two pairs, what is left pairs
 * by position; a node with nothing opposite is on one side only.
 */
const align = (a: TreeNode[], b: TreeNode[]): [TreeNode?, TreeNode?][] => {
  const same = (i: number, j: number) => scoreOf(a[i], b[j]) === 2;
  const shorter = Math.min(a.length, b.length);
  const start = countWhile(shorter, (i) => same(i, i));
  const end = countWhile(shorter - start, (i) =>
    same(a.length - 1 - i, b.length - 1 - i)
  );
  const inOrder = (ours: TreeNode[], theirs: TreeNode[]) =>
    ours.map((node, i): [TreeNode, TreeNode] => [node, theirs[i]]);
  return [
    ...inOrder(a.slice(0, start), b),
    ...paired(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ...inOrder(a.slice(a.length - end), b.slice(b.length - end)),
  ];
};

/** How many of `0..n - 1` pass `test` before the first that does not. */
const countWhile = (n: number, test: (i: number) => boolean) => {
  const failed = [...Array(n).keys()].findIndex((i) => !test(i));
  return failed < 0 ? n : failed;
};

/** `align` for what lies between equal ends. */
const paired = (a: TreeNode[], b: TreeNode[]): [TreeNode?, TreeNode?][] => {
  const width = b.length + 1;
  // best[i * width + j]: the best score of a[i..] against b[j..]
  const best = new Int32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) {
      const score = scoreOf(a[i], b[j]);
      best[i * width + j] = Math.max(
        best[(i + 1) * width + j],
        best[i * width + j + 1],
        score && best[(i + 1) * width + j + 1] + score
      );
    }
  const pairs: [TreeNode?, TreeNode?][] = [];
  const gap: [TreeNode[], TreeNode[]] = [[], []];
  const close = () => {
    const [ours, theirs] = gap.splice(0, 2, [], []);
    for (const index of Array(Math.max(ours.length, theirs.length)).keys())
      pairs.push([ours[index], theirs[index]]);
  };
  for (let i = 0, j = 0; i < a.length || j < b.length; ) {
    const score = i < a.length && j < b.length ? scoreOf(a[i], b[j]) : 0;
    if (
      score &&
      best[i * width + j] === best[(i + 1) * width + j + 1] + score
    ) {
      close();
      pairs.push([a[i++], b[j++]]);
    } else if (
      j === b.length ||
      (i < a.length && best[(i + 1) * width + j] >= best[i * width + j + 1])
    )
      gap[0].push(a[i++]);
    else gap[1].push(b[j++]);
  }
  close();
  return pairs;
};

/**
 * What differs between `server`, a prerendered page as written, and
 * `browser`, the same route a browser rendered from the shell: both parsed
 * as a browser parses them, compared as trees, attributes in any order,
 * the differences by design (above) left out.
 */
export const compareRender = (
  server: string,
  browser: string,
  { clientOnly, allow }: Rules
): ColdRenderReport => {
  const report: ColdRenderReport = {
    serverOnly: [],
    browserOnly: [],
    different: [],
    counts: { serverOnly: 0, browserOnly: 0, different: 0 },
    lazyViews: 0,
  };
  // 2. `KEPT_HEAD` as the serializer applies it: on an element
  const dom = inertDom();
  const keptInHead = (node: TreeNode) => {
    if (!("tag" in node)) return false;
    const element = dom.document.createElement(node.tag);
    for (const [name, value] of Object.entries(node.attributes))
      try {
        element.setAttribute(name, value);
      } catch {
        // a name no DOM accepts (parse5 keeps it): `KEPT_HEAD` reads none
      }
    return element.matches(KEPT_HEAD);
  };
  // what is compared of `parent`'s children, on the server's side or the browser's
  const childrenOn = (
    parent: Tag,
    side: "server" | "browser",
    inert: boolean
  ) =>
    childrenOf(parent).filter((node) =>
      parent.tag === "head"
        ? keptInHead(node)
        : // 1. the shell's shadow root, which a browser attached
          inert ||
          side === "browser" ||
          !("tag" in node && node.tag === "template" && has(node, SHADOW_ROOT))
    );
  const note = (kind: Kind, difference: RenderDifference) => {
    const line = `${difference.path}: server ${difference.server}, browser ${difference.browser}`;
    if (allow.some((pattern) => pattern.test(line))) return;
    if (report.counts[kind]++ < LIMIT) report[kind].push(difference);
  };
  const noteAttribute = (
    path: string,
    name: string,
    value?: string,
    other?: string
  ) =>
    value !== other &&
    note(
      other === undefined
        ? "serverOnly"
        : value === undefined
          ? "browserOnly"
          : "different",
      {
        path,
        server: value === undefined ? "nothing" : attribute(name, value),
        browser: other === undefined ? "nothing" : attribute(name, other),
      }
    );
  const attributeOf = (node: Tag, name: string) =>
    has(node, name) ? node.attributes[name] : undefined;
  const compareAttributes = (ours: Tag, theirs: Tag, path: string) => {
    const serverSide = new Map(
      Object.entries(ours.attributes).filter(
        ([name]) => !SERVER_MARKS.has(name)
      )
    );
    const browserSide = new Map(
      Object.entries(theirs.attributes).filter(
        ([name]) => !BROWSER_MARKS.test(name)
      )
    );
    // 1. the serializer made the script inert through its type
    if (ours.tag === "script" && has(ours, "n-inert"))
      [serverSide, browserSide].forEach((side) => side.delete("type"));
    // 1. ...wrote the element not loaded
    if (!has(ours, "n-ssr"))
      LOADED.filter((name) => !serverSide.has(name)).forEach((name) =>
        browserSide.delete(name)
      );
    // 1. ...made a render's declarative shadow root inert
    if (ours.tag === "template" && !serverSide.has(SHADOW_ROOT))
      browserSide.delete(SHADOW_ROOT);
    for (const name of new Set([...serverSide.keys(), ...browserSide.keys()]))
      noteAttribute(path, name, serverSide.get(name), browserSide.get(name));
  };
  // `path`: the document's is empty. `inert`: in a `<template>`'s content, where nothing renders
  const compareElements = (
    ours: Tag,
    theirs: Tag,
    path: string,
    inert = false
  ) => {
    // 3. a region on one side only is a difference too
    if (has(ours, NO_SSR) || has(theirs, NO_SSR))
      return void noteAttribute(
        path,
        NO_SSR,
        attributeOf(ours, NO_SSR),
        attributeOf(theirs, NO_SSR)
      );
    // 4.
    if (!inert && has(theirs, LAZY) && !has(theirs, "is-active"))
      return void report.lazyViews++;
    // 3. client-only tags
    if (!clientOnly.includes(ours.tag)) compareAttributes(ours, theirs, path);
    const at = path || "#document";
    const pairs = align(
      childrenOn(ours, "server", inert),
      childrenOn(theirs, "browser", inert)
    );
    for (const [one, other] of pairs) {
      if (!other)
        note("serverOnly", {
          path: at,
          server: label(one!),
          browser: "nothing",
        });
      else if (!one)
        note("browserOnly", {
          path: at,
          server: "nothing",
          browser: label(other),
        });
      else if ("tag" in one && "tag" in other && one.tag === other.tag)
        compareElements(
          one,
          other,
          path ? `${path} > ${step(one)}` : step(one),
          inert || one.tag === "template"
        );
      else if (contentOf(one) !== contentOf(other))
        note("different", {
          path: at,
          server: label(one),
          browser: label(other),
        });
    }
  };
  const documentOf = (html: string): Tag => ({
    tag: "#document",
    attributes: {},
    children: parseTree(html),
  });
  try {
    compareElements(documentOf(server), documentOf(browser), "");
    return report;
  } finally {
    dom.dispose().catch(() => undefined);
  }
};

// The two functions below run in the page: they refer to nothing outside themselves.

/**
 * The cold page has rendered: no `loading` state outside a `no-ssr` region
 * (the comparison leaves those out) in two frames in a row, then Quark settled.
 */
export const coldRendered = async (loading: string) => {
  const loads = () =>
    [...document.querySelectorAll(loading)].some(
      (element) => !element.closest("[no-ssr]")
    );
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  if (loads()) return false;
  await frame();
  if (loads()) return false;
  await frame();
  await (
    document.querySelector("quark-sheet") as any
  )?.quarkInstance?.constructor.whenSettled?.();
  return !loads();
};

/** The document's markup: its doctype, then `<html>`. */
export const documentHtml = () =>
  `${document.doctype ? new XMLSerializer().serializeToString(document.doctype) : ""}${document.documentElement.outerHTML}`;

/** Whether `html` is a prerendered page: `<html n-ssr>`. */
const isPrerendered = (html: string) =>
  parseTree(html).some((node) => "tag" in node && has(node, "n-ssr"));

/**
 * Whether the server rendered what a browser renders, for one route: Chrome
 * renders `path` from the untouched shell, and its document is compared with
 * the prerendered file. Catches server output that hydration would adopt
 * silently. `page`: `open()` of `@excom/nucleus-test/chrome.mjs`. Throws on
 * the wrong kind of page, or a cold page still loading after 15 s.
 */
export const compareColdRender = async (
  page: BrowserPage,
  path: string,
  { served, cold, loading, clientOnly = [], allow = [] }: ColdRenderOptions
): Promise<ColdRenderReport> => {
  const response = await fetch(new URL(path, served));
  // the host answers a path no page has with its 404 page
  if (!response.ok && response.status !== 404)
    throw new Error(`${served} answered ${path} with ${response.status}`);
  const server = await response.text();
  if (!isPrerendered(server))
    throw new Error(
      `${served} does not serve ${path} prerendered (no <html n-ssr>)`
    );
  await page.goto(new URL(path, cold).href);
  const waiting = [WAITING, loading].filter(Boolean).join(", ");
  if (!(await until(() => page.run(coldRendered, waiting), SETTLE_MS)))
    throw new Error(
      `the cold page is still loading after ${SETTLE_MS / 1000} s`
    );
  const browser = await page.run(documentHtml);
  if (isPrerendered(browser))
    throw new Error(`${cold} serves ${path} prerendered, not the shell`);
  return compareRender(server, browser, { clientOnly, allow });
};
