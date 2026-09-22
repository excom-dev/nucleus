import { chaiDomDiff, getDiffableHTML } from "@open-wc/semantic-dom-diff";
import * as HappyDomSymbol from "happy-dom/lib/PropertySymbol.js";
import { chai, expect } from "vitest";
import { installCommandShim } from "./command-shim";

installCommandShim();

const getViNamespace = (eventTargetAndOrElement) => {
  if (!eventTargetAndOrElement._vi_) {
    eventTargetAndOrElement._vi_ = {};
  }
  return eventTargetAndOrElement._vi_;
};

globalThis.getEventListeners = (target: EventTarget) => {
  const viNamespace = getViNamespace(target);
  return viNamespace.allListeners || {};
};

globalThis.clearEventListeners = (target: EventTarget) => {
  const viNamespace = getViNamespace(target);
  viNamespace.allListeners = {};
};

declare global {
  interface Window {
    getEventListeners: (target: EventTarget) => Record<string, EventListener[]>;
    clearEventListeners: (target: EventTarget) => void;
  }
}

const newAdd = (collection) =>
  function (
    type: string,
    cb: EventListenerOrEventListenerObject,
    opts?: boolean | AddEventListenerOptions,
  ) {
    const ns = ((this as any)._vi_ ??= {});
    const listeners = (ns.allListeners ??= {});
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(cb);
    collection.call(this, type, cb, opts);
  };

const newRemove = (collection) =>
  function (
    type: string,
    cb: EventListenerOrEventListenerObject,
    opts?: boolean | EventListenerOptions,
  ) {
    const listeners = (this as any)._vi_?.allListeners;
    if (listeners?.[type]) {
      const idx = listeners[type].indexOf(cb);
      if (idx !== -1) listeners[type].splice(idx, 1);
      if (listeners[type].length === 0) delete listeners[type];
    }
    collection.call(this, type, cb, opts);
  };

// Patch every happy-dom proto that owns add/remove — `EventTarget` alone misses `HTMLElement`.
for (const proto of [EventTarget.prototype, HTMLElement.prototype]) {
  proto.addEventListener = newAdd(proto.addEventListener);
  proto.removeEventListener = newRemove(proto.removeEventListener);
}
// happy-dom binds window/document listeners on the instance; host-ref="window"|"document" skips proto patches.
for (const target of [window, document]) {
  target.addEventListener = newAdd(target.addEventListener);
  target.removeEventListener = newRemove(target.removeEventListener);
}

/**
 * happy-dom 20.8 stores MutationObserver dispatch closures in a `WeakRef`
 * (`MutationObserverListener`: `callback: new WeakRef(...)`) and drops the
 * listener when `deref()` fails — first GC after `observe()` kills it. Quark's
 * host observer and `<dom-observer>` then stop mid-test (worse in long suites).
 * Pin each target's dispatch closure to the observer while connected.
 */
const MO_PINS = Symbol("mutation-observer-pins");
const happyDomObserve = MutationObserver.prototype.observe;
const happyDomDisconnect = MutationObserver.prototype.disconnect;
MutationObserver.prototype.observe = function (
  target: Node,
  options?: MutationObserverInit,
) {
  happyDomObserve.call(this, target, options);
  const pins: Set<unknown> = ((this as any)[MO_PINS] ??= new Set());
  const listeners: Array<{ callback?: WeakRef<object> }> =
    (target as any)[HappyDomSymbol.mutationListeners] ?? [];
  for (const listener of listeners) {
    const fn = listener.callback?.deref?.();
    if (fn) pins.add(fn);
  }
};
MutationObserver.prototype.disconnect = function () {
  happyDomDisconnect.call(this);
  (this as any)[MO_PINS]?.clear();
};

/**
 * happy-dom `Element#querySelector(All)` matches only the subtree; browsers
 * match the document, then keep descendants of `this` (MDN).
 *
 * `:scope` → temporary attribute on `this` (same as `@excom/kit-utils`
 * `_select`).
 *
 * Document-wide lookup sees connected nodes only. Offline trees
 * (`div.innerHTML = ...` before `appendChild`) fall back to happy-dom's
 * subtree query, or `is-active` / templates fail with "Failed to find template".
 */
const documentQuerySelectorAll = Document.prototype.querySelectorAll;
const happyDomQuerySelector = Element.prototype.querySelector;
const happyDomQuerySelectorAll = Element.prototype.querySelectorAll;

const withScopeMarker = <T>(
  el: Element,
  selector: string,
  run: (sel: string) => T,
): T => {
  if (!selector.includes(":scope")) return run(selector);
  const tempAttr = `n-happy-dom-scope-${Math.random().toString(36).slice(2, 11)}`;
  el.setAttribute(tempAttr, "");
  try {
    return run(selector.replace(/:scope/g, `[${tempAttr}]`));
  } finally {
    el.removeAttribute(tempAttr);
  }
};

/**
 * Descendants of `root` via one `childNodes` walk.
 *
 * happy-dom can say `form.contains(input) === false` (and a wrong
 * `parentElement`) for controls in an offline-parsed then appended `<form>`,
 * while `form.childNodes` is correct — use that, not `contains`.
 */
const descendantsOf = (root: Node): Set<Node> => {
  const set = new Set<Node>();
  const stack: Node[] = [];
  const rootChildren = root.childNodes;
  for (let i = 0; i < rootChildren.length; i++) stack.push(rootChildren[i]);
  while (stack.length) {
    const cur = stack.pop()!;
    set.add(cur);
    const children = cur.childNodes;
    for (let i = 0; i < children.length; i++) stack.push(children[i]);
  }
  return set;
};

/**
 * Is `node` a descendant of `root` (never `root` itself — browsers never
 * return the context node)?
 *
 * `Node.contains` is O(depth). On miss, one `childNodes` walk per query:
 * document matches are mostly *outside* `root`; walking per miss was
 * O(matches × subtree) and ~30% of view-test CPU.
 */
const withinChecker = (root: Node) => {
  let descendants: Set<Node> | undefined;
  return (node: Node): boolean =>
    node !== root &&
    (root.contains(node) || (descendants ??= descendantsOf(root)).has(node));
};

Element.prototype.querySelector = function querySelector(selectors: string) {
  return withScopeMarker(this, String(selectors), (scoped) => {
    if (!this.isConnected) {
      return happyDomQuerySelector.call(this, scoped);
    }
    const matches = documentQuerySelectorAll.call(this.ownerDocument, scoped);
    const within = withinChecker(this);
    for (let i = 0; i < matches.length; i++) {
      if (within(matches[i])) return matches[i];
    }
    return null;
  });
};

Element.prototype.querySelectorAll = function querySelectorAll(
  selectors: string,
) {
  return withScopeMarker(this, String(selectors), (scoped) => {
    if (!this.isConnected) {
      return happyDomQuerySelectorAll.call(this, scoped);
    }
    const matches = documentQuerySelectorAll.call(this.ownerDocument, scoped);
    const within = withinChecker(this);
    const out: Element[] = [];
    for (let i = 0; i < matches.length; i++) {
      if (within(matches[i])) out.push(matches[i]);
    }
    return out;
  }) as unknown as NodeListOf<Element>;
};

/**
 * Never serialize a DOM node in test output — happy-dom inspects to thousands
 * of lines. Console methods summarize to `<tag>` / `<tag#id>` (`[Node type=N]`
 * otherwise), including inside objects/arrays. Same idea as
 * `@excom/kit-logger` `summarizeLogArg` (rig cannot depend on it;
 * kit-logger is built and tested with the rig).
 */
const SUMMARIZE_DEPTH = 6;
export const summarizeConsoleArg = (
  arg: unknown,
  depth = SUMMARIZE_DEPTH,
  seen: WeakSet<object> = new WeakSet(),
): unknown => {
  if (arg instanceof Node) {
    if (arg.nodeType === Node.ELEMENT_NODE) {
      const el = arg as Element;
      return el.id ? `<${el.localName}#${el.id}>` : `<${el.localName}>`;
    }
    return `[Node type=${arg.nodeType}]`;
  }
  if (depth <= 0 || typeof arg !== "object" || arg === null) return arg;
  if (Array.isArray(arg)) {
    if (seen.has(arg)) return "[Circular]";
    seen.add(arg);
    return arg.map((item) => summarizeConsoleArg(item, depth - 1, seen));
  }
  const proto = Object.getPrototypeOf(arg);
  if (proto === Object.prototype || proto === null) {
    if (seen.has(arg)) return "[Circular]";
    seen.add(arg);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(arg)) {
      out[key] = summarizeConsoleArg(value, depth - 1, seen);
    }
    return out;
  }
  return arg;
};
const CONSOLE_GUARDED = Symbol.for("heft-rig.console-node-guard");
type ConsoleMethod = "log" | "info" | "debug" | "warn" | "error";
/** The real console methods the guards forward to (swappable in tests). */
export const consoleSinks = {} as Record<ConsoleMethod, (...args: unknown[]) => void>;
for (const method of ["log", "info", "debug", "warn", "error"] as const) {
  const original = console[method] as (...args: unknown[]) => void;
  if ((original as any)[CONSOLE_GUARDED]) continue;
  consoleSinks[method] = original;
  const guarded = (...args: unknown[]) =>
    consoleSinks[method].apply(console, args.map((arg) => summarizeConsoleArg(arg)));
  (guarded as any)[CONSOLE_GUARDED] = true;
  console[method] = guarded;
}

chai.use(chaiDomDiff);

chai.use((_chai, utils) => {
  _chai.Assertion.addMethod(
    "equalTag",
    function equalTag(expected, options = {}) {
      const element = utils.flag(this, "object");
      const tagName = element?.localName || element?.tagName?.toLowerCase();

      try {
        new _chai.Assertion(element).dom.to.equal(expected, {
          ...options,
          ignoreChildren: [...(options.ignoreChildren || []), tagName],
        });
      } catch (e) {
        Error.captureStackTrace(e, equalTag);
        throw e;
      }
    }
  );

  _chai.Assertion.addMethod(
    "toMatchListeners",
    function toMatchListeners(expected: Record<string, number>) {
      const element = utils.flag(this, "object");
      const listeners = window.getEventListeners(element);
      const actual: Record<string, number> = {};
      for (const key in listeners) {
        actual[key] = listeners[key]?.length;
      }

      try {
        this.assert(
          JSON.stringify(actual) === JSON.stringify(expected),
          `expected listeners #{act} to match #{exp}`,
          `expected listeners #{act} to not match #{exp}`,
          expected,
          actual
        );
      } catch (e) {
        Error.captureStackTrace(e, toMatchListeners);
        throw e;
      }
    }
  );

  _chai.Assertion.addMethod(
    "toContainListeners",
    function toContainListeners(expected: Record<string, number>) {
      const element = utils.flag(this, "object");
      const listeners = window.getEventListeners(element);
      const actual: Record<string, number> = {};
      for (const key in listeners) {
        actual[key] = listeners[key]?.length ?? 0;
      }
      try {
        for (const key in expected) {
          this.assert(
            (actual[key] ?? 0) === expected[key],
            `expected listeners #{act} to match #{exp}`,
            `expected listeners #{act} to not match #{exp}`,
            expected,
            actual
          );
        }
      } catch (e) {
        Error.captureStackTrace(e, toContainListeners);
        throw e;
      }
    }
  );
});

expect.addSnapshotSerializer({
  test: (val) => val instanceof HTMLElement,
  print: (val: string | Node) => getDiffableHTML(val),
});

(globalThis as any).ServiceWorkerContainer = class {};

HTMLElement.prototype.checkVisibility = function () {
  return true;
};
