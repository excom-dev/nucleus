import { installCommandShim } from "./command";
import { installMissingApis } from "./missing-apis";
import { pinMutationObservers } from "./mutation-observer";
import { scopeQueriesToDocument } from "./query-selector";
import type { DomWindow } from "./window";
import { Window } from "happy-dom";

export interface CreateDomOptions {
  /**
   * Page URL: `location`, `history` and relative URLs resolve against it.
   * @default "http://localhost/"
   */
  url?: string;
  /** Initial markup: a whole document or body content. */
  html?: string;
}

export interface Dom {
  window: DomWindow;
  document: Document;
  /** Closes the window: timers stop, pending fetches abort. */
  dispose(): Promise<void>;
}

/**
 * Installs every browser-parity shim on `win`. Safe to repeat.
 * `installShims(globalThis)` patches a test runner's happy-dom environment.
 */
export function installShims(win: DomWindow | typeof globalThis): void {
  scopeQueriesToDocument(win);
  pinMutationObservers(win);
  installCommandShim(win);
  installMissingApis(win);
}

/**
 * A fresh happy-dom window with every shim installed: one per test, or per
 * request when server-side rendering (SSR).
 */
export function createDom({
  url = "http://localhost/",
  html,
}: CreateDomOptions = {}): Dom {
  const happyWindow = new Window({ url });
  const window = happyWindow as unknown as DomWindow;
  if (html) window.document.write(html);
  installShims(window);
  return {
    window,
    document: window.document,
    dispose: () => happyWindow.happyDOM.close(),
  };
}
