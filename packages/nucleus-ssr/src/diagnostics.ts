import { LOAD_STATE_ATTRIBUTES, loadStateAttributes } from "./load-state";
import { builtin, onUnhandledRejection } from "./node";
import type {
  DomWindow,
  ParseDifference,
  PendingWork,
  ServedRequest,
} from "@excom/nucleus-dom";

/** What a page render reported. `errors` fail the page; nothing else does. */
export interface Diagnostics {
  /**
   * Console errors, happy-dom errors, unhandled `-error` events, unhandled
   * rejections, private responses, refused writes, WebSockets and requests
   * of schemes other than `http:` / `https:`, elements still `is-loading`
   * or `delaying-ready` once the page settled, a Neutron element that
   * mounted before `no-ssr` reached it, unsafe markup, markup a browser
   * parses into other elements, `file:` URLs and build-machine paths, an
   * unsettled page, and a throwing `shell` function or hook.
   */
  errors: string[];
  /** Console warnings, happy-dom warnings, skipped cross-origin resources and iframe pages, an island over `warnIslandBytes`. */
  warnings: string[];
  /** Work still pending when `budgetMs` ran out. */
  pending?: PendingWork;
  /** Every request the page made, in order. */
  requests: ServedRequest[];
  /**
   * Elements whose `provision` stays out of the island, with why: they derive
   * it again in the browser. One whose data is not in the island is written
   * not loaded (no `is-success` / `did-load`), and fetches as on a cold load.
   */
  skippedProvisions: string[];
  /** Executable `<script>`s the render inserted (html paints, fetched views), made inert (`type="text/plain"`); data blocks stay. */
  neutralizedScripts: number;
  /** `<template shadowrootmode>`s the render inserted, made inert: parsed from the file, they would attach shadow roots. */
  neutralizedShadowRoots: number;
  /** Delays (ms) of the timers held: never fired, never waited for. */
  heldTimers: number[];
  /** Size of the hydration island's JSON, in bytes. */
  islandBytes: number;
}

type Printer = { read(): { level: number; message: unknown[] }[] };

const ERROR_LEVEL = 3;
const WARN_LEVEL = 2;
const CAPTURING_PHASE = 1;
// a kit element waiting for data or for its `ready-on` event
const NOT_READY = loadStateAttributes("waiting");
// state and kit markers: no help in telling elements apart
const UNNAMING = new Set([
  ...Object.keys(LOAD_STATE_ATTRIBUTES),
  "class",
  "style",
  "n-ssr",
  "n-tpl",
  "q-scope",
]);
// about how long a page excerpt is in a parse difference
const EXCERPT = 60;
// happy-dom's notice for an iframe with page loading off
const FRAME_SKIPPED =
  /^Failed to load iframe page "([^"]+)"\. Iframe page loading is disabled\.$/;

export const emptyDiagnostics = (): Diagnostics => ({
  errors: [],
  warnings: [],
  requests: [],
  skippedProvisions: [],
  neutralizedScripts: 0,
  neutralizedShadowRoots: 0,
  heldTimers: [],
  islandBytes: 0,
});

/** `<tag name="value">`: an element in a diagnostic. */
export const openingTag = (element: Element): string => {
  const attributes = Array.from(element.attributes, ({ name, value }) =>
    value ? ` ${name}="${value}"` : ` ${name}`
  );
  return `<${element.localName}${attributes.join("")}>`;
};

/** `tag#id`, else `tag[name="value"]` by its first naming attribute, else `tag`. */
const selectorOf = (element: Element): string => {
  if (element.id) return `${element.localName}#${element.id}`;
  const naming = Array.from(element.attributes).find(
    ({ name }) => !UNNAMING.has(name)
  );
  if (!naming) return element.localName;
  const value =
    naming.value.length > 60 ? `${naming.value.slice(0, 60)}…` : naming.value;
  return `${element.localName}[${naming.name}="${value}"]`;
};

/**
 * Elements still `is-loading` or `delaying-ready`, each as a short selector
 * with what it waits on: once the page settled, they would be written
 * half-rendered (or hidden). One in a `noSsr` region (`no-ssr`) got there
 * once it had started loading: said so.
 */
export const notReady = (document: Document, noSsr: string): string[] =>
  Array.from(
    document.querySelectorAll(NOT_READY.map((name) => `[${name}]`).join(", ")),
    (element) =>
      `${selectorOf(element)} (${NOT_READY.filter((name) =>
        element.hasAttribute(name)
      ).join(", ")})${
        element.closest(`[${noSsr}]`)
          ? `: ${noSsr} reached it after it had started loading, and belongs in the markup or first in the rule that activates it`
          : ""
      }`
  );

const isNode = (value: unknown): value is Node =>
  typeof (value as Node | null)?.nodeType === "number";

/** A value as diagnostic text: elements as their opening tag, errors as `Name: message (cause)`. */
export const describe = (value: unknown): string =>
  typeof value === "string"
    ? value
    : value instanceof Error
      ? `${value}${value.cause === undefined ? "" : ` (${describe(value.cause)})`}`
      : isNode(value)
        ? value.nodeType === 1
          ? openingTag(value as Element)
          : value.nodeName
        : builtin("node:util").inspect(value, {
            depth: 2,
            breakLength: Infinity,
            maxStringLength: 200,
          });

/**
 * About 60 characters of `html` from `line` / `column` (as parse5 counts
 * them), whitespace collapsed, cut after a tag that ends near there.
 */
const excerptOf = (html: string, line: number, column: number): string => {
  const start = html
    // lines as parse5 counts them: LF, CR LF or a lone CR ends one
    .split(/(?<=\n|\r(?!\n))/)
    .slice(0, line - 1)
    .reduce((offset, text) => offset + text.length, column - 1);
  const text = html
    .slice(start, start + 4 * EXCERPT)
    .replace(/\s+/g, " ")
    .trim();
  const end = text.lastIndexOf(">", EXCERPT + 20);
  return end >= EXCERPT - 20 ? text.slice(0, end + 1) : text.slice(0, EXCERPT);
};

/**
 * Where a browser parses markup into other elements than the renderer, with
 * the usual causes: diagnostic text. In a `page`, which is never written
 * when it fails, the place is an excerpt to search for, not a position.
 */
export const describeParseDifference = (
  { path, here, browser, line, column, unclosed }: ParseDifference,
  page?: string
): string => {
  const at =
    page === undefined
      ? `on line ${line}, column ${column}`
      : `at \`${excerptOf(page, line, column)}\``;
  return `in ${path}, the renderer has ${here} where a browser has ${browser}${
    unclosed
      ? `: it reads everything after ${unclosed} ${at} into it`
      : `, ${at}`
  }. Usual causes: a block element inside <p>, text that looks like a tag inside an inline sheet or another element's text, a nested <a>, <form> or <button>, content a <table> cannot hold.`;
};

/** An `-error` event as diagnostic text: type, `target`, detail. */
export const describeEvent = (
  { type, detail }: CustomEvent,
  target: unknown
): string =>
  `${type} on ${describe(target)}${detail == null ? "" : `: ${describe(detail)}`}`;

/** `node` as seen from its document: the outermost shadow host that holds it. */
const outermost = (node: Node): Node => {
  const root = node.getRootNode() as ShadowRoot;
  return root.host ? outermost(root.host) : node;
};

/**
 * Records Node console errors / warnings (element code logs there) and
 * unhandled rejections into the diagnostics `current()` returns at that
 * moment, instead of printing them, until the returned function restores
 * the console.
 */
export const captureConsole = (current: () => Diagnostics): (() => void) => {
  const { error, warn } = console;
  const record =
    (list: "errors" | "warnings") =>
    (...args: unknown[]) => {
      current()[list].push(args.map(describe).join(" "));
    };
  Object.assign(console, { error: record("errors"), warn: record("warnings") });
  const stop = onUnhandledRejection((reason) =>
    current().errors.push(`Unhandled rejection: ${describe(reason)}`)
  );
  return () => {
    Object.assign(console, { error, warn });
    stop();
  };
};

/**
 * Moves happy-dom's own errors and warnings since the last read (the
 * window's `console`, failed loads, throwing listeners and timers) into
 * `diagnostics`. Its notice that an iframe loaded no page, as a render
 * wants, is a warning.
 */
export const readVirtualConsole = (
  window: DomWindow,
  diagnostics: Diagnostics
): void => {
  const printer = (
    window as unknown as { happyDOM: { virtualConsolePrinter: Printer } }
  ).happyDOM.virtualConsolePrinter;
  for (const { level, message } of printer.read()) {
    const frame = FRAME_SKIPPED.exec(
      (message[0] as Error | undefined)?.message ?? ""
    );
    if (frame)
      diagnostics.warnings.push(
        `Skipped ${frame[1]}: a render loads no page into an iframe`
      );
    else if (level >= WARN_LEVEL)
      (level >= ERROR_LEVEL ? diagnostics.errors : diagnostics.warnings).push(
        message.map(describe).join(" ")
      );
  }
};

/**
 * Adds each event whose type ends in `-error` that reaches `document` to the
 * list `errors()` gives as it arrives, once its dispatch is over, unless a
 * listener handled it (`preventDefault()`). happy-dom calls each node's own
 * `dispatchEvent` once per phase, so one override on the document sees every
 * type. An event that stays inside a shadow root (`composed: false`) never
 * reaches it. The returned function removes the override.
 */
export const watchErrorEvents = (
  document: Document,
  errors: () => string[]
): (() => void) => {
  const dispatch = document.dispatchEvent;
  Object.defineProperty(document, "dispatchEvent", {
    configurable: true,
    value(this: Document, event: Event) {
      if (
        event.eventPhase === CAPTURING_PHASE &&
        event.type.endsWith("-error")
      ) {
        const list = errors();
        // its target as seen from the document: a shadow host, not inside
        const text = describeEvent(
          event as CustomEvent,
          outermost(event.target as Node)
        );
        queueMicrotask(() => {
          if (!event.defaultPrevented) list.push(text);
        });
      }
      return dispatch.call(this, event);
    },
  });
  return () => {
    delete (document as Partial<Document>).dispatchEvent;
  };
};
