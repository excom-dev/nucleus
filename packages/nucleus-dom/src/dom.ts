import { trackActivity } from "./activity";
import { installCommandShim } from "./command";
import { upgradeClones } from "./custom-elements";
import { keepEventPaths } from "./event-path";
import { keepFormParents } from "./form-parents";
import { reportIntersecting } from "./intersection-observer";
import { installMissingApis } from "./missing-apis";
import { pinMutationObservers } from "./mutation-observer";
import { supportSelectors } from "./selectors";
import { ignoreStrayMarkup } from "./stray-markup";
import { supportTableTemplates } from "./table-templates";
import type { DomWindow } from "./window";
import { type IOptionalBrowserSettings, Window } from "happy-dom";

export interface CreateDomOptions {
  /**
   * Page URL: `location`, `history` and relative URLs resolve against it.
   * @default "http://localhost/"
   */
  url?: string;
  /** Initial markup: a whole document or body content. */
  html?: string;
  /**
   * Viewport size, read by `innerWidth` / `innerHeight` and `matchMedia()`:
   * responsive layouts render as on a phone or a desktop.
   * @default { width: 1024, height: 768, devicePixelRatio: 1 }
   */
  viewport?: IOptionalBrowserSettings["viewport"];
  /**
   * Timeouts and intervals longer than this many ms are held: clearable,
   * never fired, never pending work for `whenIdle()`. A server render
   * neither waits for nor serializes a 3 s `@delay`.
   * @default undefined (none held)
   */
  holdTimersAbove?: number;
  /**
   * `IntersectionObserver` reports each observed element in view a frame
   * after `observe()`, so lazy-loaded content renders. happy-dom's own never
   * reports.
   * @default false
   */
  intersectAll?: boolean;
  /**
   * More happy-dom settings, over these defaults: JavaScript files never
   * load (`<script src>` reports `load`), the main frame never navigates.
   * Page JavaScript evaluation stays off unless enabled here.
   */
  settings?: IOptionalBrowserSettings;
}

export interface Dom {
  window: DomWindow;
  document: Document;
  /** Closes the window: timers stop, pending fetches abort. */
  dispose(): Promise<void>;
}

const DEFAULT_SETTINGS = {
  disableJavaScriptFileLoading: true,
  handleDisabledFileLoadingAsSuccess: true,
  navigation: { disableMainFrameNavigation: true },
} satisfies IOptionalBrowserSettings;

/**
 * Installs every browser-parity shim on `win`. Safe to repeat.
 * `installShims(globalThis)` patches a test runner's happy-dom environment.
 */
export function installShims(win: DomWindow | typeof globalThis): void {
  supportSelectors(win);
  pinMutationObservers(win);
  installCommandShim(win);
  installMissingApis(win);
  upgradeClones(win);
  keepFormParents(win);
  supportTableTemplates(win);
  ignoreStrayMarkup(win);
  keepEventPaths(win);
}

/**
 * A fresh happy-dom window with every shim installed and its work tracked
 * for `whenIdle()`: one per test, or one per worker when server-side
 * rendering (SSR) with `resetDocument()` per page.
 */
export function createDom({
  url = "http://localhost/",
  html,
  viewport,
  holdTimersAbove,
  intersectAll = false,
  settings,
}: CreateDomOptions = {}): Dom {
  const happyWindow = new Window({
    url,
    settings: {
      ...DEFAULT_SETTINGS,
      ...settings,
      navigation: { ...DEFAULT_SETTINGS.navigation, ...settings?.navigation },
      ...(viewport && { viewport: { ...settings?.viewport, ...viewport } }),
    },
  });
  const window = happyWindow as unknown as DomWindow;
  trackActivity(window, holdTimersAbove);
  if (intersectAll) reportIntersecting(window);
  installShims(window);
  if (html) window.document.write(html);
  return {
    window,
    document: window.document,
    dispose: () => happyWindow.happyDOM.close(),
  };
}
