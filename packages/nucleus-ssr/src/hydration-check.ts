import { type BrowserPage, SETTLE_MS, until } from "./browser-page";

export interface HydrationCheckOptions {
  /**
   * Hidden or loading states, as a selector, e.g. `spa-route[delaying-ready],
   * [is-loading]`: a frame that shows one outside a `no-ssr` region is a
   * change, and the page has hydrated once none is left there.
   */
  loading: string;
  /** Changes the page makes by design: a line one of them matches is left out. */
  allow?: readonly RegExp[];
  /**
   * Requests made after parsing that count as changes, by path: content the
   * island should have answered, e.g. `/^\/views\//`. Stylesheets, sheets,
   * modules and the views an idle `pre-fetch` include loads never count.
   * None by default.
   */
  requests?: RegExp;
}

/**
 * What hydrating a prerendered page did in a real browser, as
 * `checkHydration` saw it: every mutation of the server's DOM from the end of
 * parsing until the hydration window closed and nothing is hidden or loading,
 * frame by frame, except in a `no-ssr` region (it mounts as on a cold load).
 */
export interface HydrationCheckReport {
  /**
   * One line per change: `removed: <parent> > <node>` (a server node),
   * `added: <parent> > <node>` (outside `<head>`), `text: <parent>` (a server
   * text rewritten), `attribute removed: <element> [<name>]` (a server
   * attribute still gone at the end), `frame showed: <element>` (a loading
   * state, or `<element> without [<name>]`: a server attribute missing in a
   * painted frame), `view transitions: <count>`, `request: <path>`, and
   * `server markup: spa-manager without has-rendered`. Empty: hydration
   * changed nothing a browser paints.
   */
  changes: string[];
  /**
   * How often a server attribute went, painted or not: one back before the
   * next frame is in no line, only counted here.
   */
  flips: number;
}

/** What the recorder keeps on `window.hydration`. */
interface Recording {
  changes: string[];
  frames: string[];
  flips: number;
  transitions: number;
  start: number;
  done: boolean;
  rendered?: boolean;
  gone?: () => string[];
}

// The three functions below run in the page: they refer to nothing outside
// themselves, and their parameters are JSON.

/**
 * In every new document, before its scripts: from the end of parsing
 * (readyState "interactive", before module scripts run) it records what
 * hydration does to the server's DOM, every frame until `hydration.done`.
 * A server attribute counts when a painted frame lacks it or it is still
 * gone at the end; one that goes and returns between two frames is never
 * seen, and only counted ("flips").
 */
export const recorder = (loading: string) => {
  // kit-utils' momentary `:scope` id and the claimed provision id are expected to go
  const IGNORED = /^(n-ssr$|n-util-select-id-)/;
  const record: Recording = ((window as any).hydration = {
    changes: [],
    frames: [],
    flips: 0,
    transitions: 0,
    start: 0,
    done: false,
  });
  // server attributes gone right now, by element
  const missing = new Map();
  const gone = () =>
    [...missing].flatMap(([element, names]) =>
      [...names].map((name) => [element, name])
    );
  const step = (node: any) =>
    node.nodeType !== 1
      ? node.nodeName
      : `${node.localName}${node.id ? `#${node.id}` : ""}${[...node.attributes]
          .filter(
            ({ name }) =>
              name.startsWith("bind-") || name === "class" || name === "api-url"
          )
          .map(({ name, value }) =>
            value ? `[${name}="${value}"]` : `[${name}]`
          )
          .join("")}`;
  const path = (node: any) => {
    const steps: string[] = [];
    for (let at = node; at && at !== document; at = at.parentNode)
      steps.unshift(step(at));
    return steps.join(" > ");
  };
  const start = () => {
    const server = new WeakSet();
    const attributes = new WeakMap();
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
    for (let node: any = walker.currentNode; node; node = walker.nextNode()) {
      server.add(node);
      if (node.nodeType === 1)
        attributes.set(node, new Set(node.getAttributeNames()));
    }
    record.start = performance.now();
    // a prerendered page keeps it: its first update must not animate, delay or scroll
    record.rendered = !document.querySelector(
      "spa-manager:not([has-rendered])"
    );
    // a `no-ssr` region was kept out of the prerender: it renders here, as on a cold load
    const keptOut = (node: any) =>
      !!(node.nodeType === 1 ? node : node.parentElement)?.closest("[no-ssr]");
    new MutationObserver((records) => {
      for (const {
        type,
        target,
        removedNodes,
        addedNodes,
        attributeName,
      } of records as any[]) {
        if (keptOut(target)) continue;
        if (type === "childList") {
          for (const node of removedNodes)
            if (server.has(node))
              record.changes.push(`removed: ${path(target)} > ${step(node)}`);
          // the head gets the bundler's module preloads; anything else added counts
          for (const node of addedNodes)
            if (target !== document.head)
              record.changes.push(`added: ${path(target)} > ${step(node)}`);
        } else if (type === "characterData" && server.has(target)) {
          record.changes.push(`text: ${path(target.parentNode)}`);
        } else if (
          type === "attributes" &&
          attributes.get(target)?.has(attributeName) &&
          !IGNORED.test(attributeName)
        ) {
          const names = missing.get(target) ?? new Set();
          if (target.hasAttribute(attributeName)) names.delete(attributeName);
          else if (!names.has(attributeName))
            (names.add(attributeName), record.flips++);
          if (names.size) missing.set(target, names);
          else missing.delete(target);
        }
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    // observer callbacks run before a frame's callbacks, so `missing` is what this frame paints
    const frame = () => {
      // a `no-ssr` region loads as on a cold load
      const shown = [...document.querySelectorAll(loading)].find(
        (element) => !element.closest("[no-ssr]")
      );
      if (shown) record.frames.push(path(shown));
      for (const [element, name] of gone())
        record.frames.push(`${path(element)} without [${name}]`);
      if (!record.done) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    record.gone = () =>
      gone().map(
        ([element, name]) => `attribute removed: ${path(element)} [${name}]`
      );
  };
  const transition = (Document.prototype as any).startViewTransition;
  if (transition) {
    (Document.prototype as any).startViewTransition = function (...args) {
      record.transitions++;
      return transition.apply(this, args);
    };
  }
  document.addEventListener(
    "readystatechange",
    () => document.readyState === "interactive" && start()
  );
};

/** The hydration window closed (kit-utils' global state), nothing hidden or loading, Quark settled. */
export const hydrated = async (loading: string) => {
  const state = globalThis[Symbol.for("@excom/kit-utils:hydration")];
  if (!state?.booted || state.open) return false;
  if (
    [...document.querySelectorAll(loading)].some(
      (element) => !element.closest("[no-ssr]")
    )
  )
    return false;
  await (
    document.querySelector("quark-sheet") as any
  )?.quarkInstance?.constructor.whenSettled?.();
  return true;
};

/**
 * What hydration did, once it is over: changes, server attributes still gone,
 * frames that showed a hidden or loading state or lacked a server attribute,
 * View Transitions, and requests made since parsing ended whose path matches
 * `requests` (source and flags), other than stylesheets, sheets and modules
 * (views that an idle `pre-fetch` include loads are cold by design).
 */
export const report = (requests: [string, string] | null) => {
  const hydration: Recording = (window as any).hydration;
  hydration.done = true;
  const idle = [...document.querySelectorAll("include-content[pre-fetch]")].map(
    (el) => el.getAttribute("template-ref")
  );
  const counted = requests && new RegExp(...requests);
  const fetched = performance
    .getEntriesByType("resource")
    .filter(({ startTime }) => startTime >= hydration.start)
    .map(({ name }) => new URL(name).pathname)
    .filter(
      (path) =>
        counted?.test(path) &&
        !idle.includes(path) &&
        !/\.(css|quark|js)$/.test(path)
    );
  return {
    flips: hydration.flips,
    changes: [
      ...(hydration.rendered
        ? []
        : ["server markup: spa-manager without has-rendered"]),
      ...hydration.changes,
      ...hydration.gone!(),
      ...[...new Set(hydration.frames)].map((path) => `frame showed: ${path}`),
      ...(hydration.transitions
        ? [`view transitions: ${hydration.transitions}`]
        : []),
      ...fetched.map((path) => `request: ${path}`),
    ],
  };
};

/**
 * Loads `path` in a real browser and reports what hydrating the prerendered
 * page changed in the server's DOM, frame by frame: the blinks and re-renders
 * happy-dom's `hydrate()` cannot see. `page`: `open()` of
 * `@excom/nucleus-test/chrome.mjs`. Throws when still hydrating after 15 s.
 */
export const checkHydration = async (
  page: BrowserPage,
  path: string,
  { loading, allow = [], requests }: HydrationCheckOptions
): Promise<HydrationCheckReport> => {
  // in documents loaded from now on, before their own scripts
  const { identifier } = await page.cdp(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: `(${recorder})(${JSON.stringify(loading)})` }
  );
  const remove = () =>
    page.cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  try {
    await page.goto(path);
    if (!(await until(() => page.run(hydrated, loading), SETTLE_MS)))
      throw new Error(`still hydrating after ${SETTLE_MS / 1000} s`);
    const { flips, changes } = await page.run(
      report,
      requests ? [requests.source, requests.flags] : null
    );
    await remove();
    return {
      flips,
      changes: changes.filter(
        (line) => !allow.some((pattern) => pattern.test(line))
      ),
    };
  } catch (error) {
    // the first error says why: Chrome may be gone, and the removal with it
    await remove().catch(() => undefined);
    throw error;
  }
};
