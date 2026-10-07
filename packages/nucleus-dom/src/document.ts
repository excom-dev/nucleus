import { activityOf } from "./activity";
import { isolated, loadPage } from "./custom-elements";
import { forgetVisits } from "./frame";
import { macrotask } from "./node";
import type { DomWindow } from "./window";

export interface ResetDocumentOptions {
  /** The new page's URL; a relative one resolves against the current URL. */
  url: string;
  /** The new page: a whole document or body markup. */
  html?: string;
  /**
   * Runs once the old page is gone, before the new one parses: reset
   * module-level state (`resetRouter(url)`), seed storage or cookies.
   */
  beforeParse?: () => unknown;
}

type HappyWindow = { happyDOM: { setURL(url: string): void } };

/** How long the old page's teardown may keep its timers and frames running. */
const SETTLE_MS = 50;

/**
 * Loads another page into the same window as a first visit, keeping its
 * `customElements` registry, module state and `window` / `document`
 * listeners: server-side rendering (SSR) of every route in one window.
 * Before `beforeParse`, the old page disconnects and its teardown settles:
 * its timers, intervals and frames run for up to 50 ms, then what is still
 * due is cancelled and held timers are dropped. Storage, cookies and history
 * are cleared; requests in flight finish untracked, reaching only the old
 * page's code. The new page parses whole; then each definition, in
 * definition order, upgrades its elements as a deferred script's `define()`
 * would: constructor, `attributeChangedCallback`, `connectedCallback`, with
 * attributes and children in place; `<template>` content stays undefined
 * until imported or inserted. A class whose constructor never calls
 * `super()` (compiled ES5) gets a new element in the parsed one's place.
 * Unlike in a browser, every definition already exists meanwhile: code
 * running then sees later names defined and constructs the elements it
 * creates at once, and elements waiting their turn upgrade in parse order,
 * wherever moved. What throws as pages unload and load is reported as an
 * uncaught error (the window's `error` event and console), and the work goes
 * on. Scripts stay inert; `document.readyState` stays `"complete"`.
 */
export async function resetDocument(
  win: DomWindow | typeof globalThis,
  { url, html = "", beforeParse }: ResetDocumentOptions
): Promise<void> {
  const { document } = win;
  const root = document.documentElement;
  isolated(() => {
    [...document.childNodes]
      .filter((node) => node !== root)
      .forEach((node) => document.removeChild(node));
    [...root.attributes].forEach(({ name }) => root.removeAttribute(name));
    root.replaceChildren(
      document.createElement("head"),
      document.createElement("body")
    );
  });
  // module state outlives the page: its teardown timers (a flag reset, a
  // queued pass) must fire; only work that never settles is cut off
  const activity = activityOf(win);
  const deadline = Date.now() + SETTLE_MS;
  do await macrotask();
  while (
    activity &&
    activity.timers.size + activity.frames.size > 0 &&
    Date.now() < deadline
  );
  activity?.cancel();
  win.localStorage.clear();
  win.sessionStorage.clear();
  forgetVisits(win);
  const { href, hash } = new URL(url, win.location.href);
  // a page load fires no `hashchange`; happy-dom's URL change would
  if (hash !== win.location.hash)
    win.addEventListener(
      "hashchange",
      (event) => event.stopImmediatePropagation(),
      { capture: true, once: true }
    );
  (win as unknown as HappyWindow).happyDOM.setURL(href);
  win.history.replaceState(null, "", href);
  await beforeParse?.();
  const doctype = /^\s*<!doctype\s+([^\s>]+)/i.exec(html);
  if (doctype)
    document.insertBefore(
      document.implementation.createDocumentType(
        doctype[1].toLowerCase(),
        "",
        ""
      ),
      root
    );
  loadPage(win, root, html);
}
