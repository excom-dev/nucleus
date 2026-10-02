import { later } from "./node";

/**
 * A page in a real browser, as `open()` of `@excom/nucleus-test/chrome.mjs`
 * gives it: what the browser checks need of a harness.
 */
export interface BrowserPage {
  /** Loads a path of the site the page was opened on, or a URL, and waits until the network is quiet. */
  goto(pathOrUrl: string): Promise<unknown>;
  /** Calls `fn` in the page with JSON `args`; resolves to its JSON result. */
  run<A extends unknown[], T>(
    fn: (...args: A) => T,
    ...args: A
  ): Promise<Awaited<T>>;
  /** Sends a Chrome DevTools Protocol command for the page. */
  cdp(method: string, params?: object): Promise<any>;
}

/** How long a page may take to settle, in ms. */
export const SETTLE_MS = 15_000;

/** True once `check()` is truthy (a throw is a no), checked every 100 ms; false after `ms`. */
export const until = async (
  check: () => unknown,
  ms: number
): Promise<boolean> => {
  const end = Date.now() + ms;
  while (
    !(await Promise.resolve()
      .then(check)
      .catch(() => false))
  ) {
    if (Date.now() >= end) return false;
    await new Promise((resolve) => later(() => resolve(undefined), 100));
  }
  return true;
};
