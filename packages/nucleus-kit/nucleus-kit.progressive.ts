/**
 * `nucleus-kit.progressive.min.js`: lazy Nucleus Kit. Watches for Nucleus Kit
 * element tags (initial scan + `MutationObserver`) and imports that package on
 * first sight. Shared chunks (`neutron`, `kit-utils`, `quark`, bases) live
 * under `dist/progressive/` and load once.
 *
 * Vs the all-in `index.umd.min.js`: one extra round-trip before upgrade
 * (style the pre-upgrade state yourself), and ESM only. Opt into idle loading
 * (prefetch the rest after page load) with `<body nucleus-kit-idle>`.
 *
 * Prerendered pages: the packages for the tags present at startup load before
 * hydration ends, so those elements adopt the server markup; tags inserted
 * later load as usual.
 */
import { bootHydration, holdHydration } from "@excom/kit-utils";

type Loader = () => Promise<unknown>;

/** The logger Nucleus Kit elements use: `KitLogger.level = 2` shows warnings. */
export { KitLogger } from "@excom/kit-logger";

const contentCarousel: Loader = () => import("@excom/content-carousel");
const contentDrawer: Loader = () => import("@excom/content-drawer");
const contentTabs: Loader = () => import("@excom/content-tabs");
const dataTable: Loader = () => import("@excom/data-table");
const spaRoute: Loader = () => import("@excom/spa-route");

/** Element tag → the package that defines it. */
export const PROGRESSIVE_LOADERS: Readonly<Record<string, Loader>> = {
  "content-carousel": contentCarousel,
  "content-carousel-slide": contentCarousel,
  "content-drawer": contentDrawer,
  "content-tabs": contentTabs,
  "content-tabs-body": contentTabs,
  "content-tabs-header": contentTabs,
  "data-table": dataTable,
  "data-th": dataTable,
  "detect-browser": () => import("@excom/detect-browser"),
  "detect-features": () => import("@excom/detect-features"),
  "detect-media": () => import("@excom/detect-media"),
  "dialog-anchor": () => import("@excom/dialog-anchor"),
  "dismiss-watcher": () => import("@excom/dismiss-watcher"),
  "dom-observer": () => import("@excom/dom-observer"),
  "event-handler": () => import("@excom/event-handler"),
  "gesture-handler": () => import("@excom/gesture-handler"),
  "include-content": () => import("@excom/include-content"),
  "network-status": () => import("@excom/network-status"),
  "provider-fetch": () => import("@excom/provider-fetch"),
  "provider-geolocation": () => import("@excom/provider-geolocation"),
  "provider-orientation": () => import("@excom/provider-orientation"),
  "provider-storage": () => import("@excom/provider-storage"),
  "quark-sheet": () => import("@excom/quark-sheet"),
  "scroll-into-view": () => import("@excom/scroll-into-view"),
  "service-worker": () => import("@excom/service-worker"),
  "spa-a": spaRoute,
  "spa-manager": spaRoute,
  "spa-route": spaRoute,
  "super-form": () => import("@excom/super-form"),
  "super-input": () => import("@excom/super-input"),
  "web-authn": () => import("@excom/web-authn"),
};

/** Every tag the progressive entry can load. */
export const PROGRESSIVE_TAGS: readonly string[] =
  Object.keys(PROGRESSIVE_LOADERS);

const SELECTOR = PROGRESSIVE_TAGS.join(",");
const pending = new Map<Loader, Promise<unknown>>();

/**
 * Load (once) the package defining `tag`. Resolves when its module has
 * evaluated, i.e. the element is defined; `undefined` for tags Nucleus Kit
 * does not know. A failed import is logged and retried on the next call.
 */
export const loadElement = (tag: string): Promise<unknown> | undefined => {
  const loader = PROGRESSIVE_LOADERS[tag];
  if (!loader) return undefined;
  let promise = pending.get(loader);
  if (!promise) {
    promise = loader().catch((error) => {
      pending.delete(loader);
      console.error(`[nucleus-kit] failed to load <${tag}>`, error);
      throw error;
    });
    pending.set(loader, promise);
  }
  return promise;
};

/** Start loading the packages for the kit tags in `node` and below; the loads. */
const scan = (node: Node): Promise<unknown>[] =>
  [
    ...(node instanceof Element ? [node.localName] : []),
    ...("querySelectorAll" in node
      ? Array.from(
          (node as ParentNode).querySelectorAll(SELECTOR),
          (el) => el.localName
        )
      : []),
  ].flatMap((tag) => loadElement(tag) ?? []);

/** Watch `root`: `initial` is what its first scan started, `stop` disposes. */
const observe = (root: Document | Element | ShadowRoot) => {
  const initial = scan(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(scan);
  });
  observer.observe(root, { childList: true, subtree: true });
  return { initial, stop: () => observer.disconnect() };
};

/**
 * Load the Nucleus Kit elements as their tags appear under `root` (an initial
 * scan, then every inserted subtree). Returns a disposer. The entry watches
 * `document` itself; call this for a shadow root.
 */
export const observeElements = (
  root: Document | Element | ShadowRoot
): (() => void) => observe(root).stop;

const loaded = new Promise((resolve) =>
  document.readyState == "complete"
    ? resolve(0)
    : window.addEventListener("load", resolve, { once: true })
);

/** Next idle period (≤ 3 s away); a 100 ms timer without `requestIdleCallback` (Safari). */
const idle = () =>
  new Promise((resolve) =>
    typeof requestIdleCallback == "function"
      ? requestIdleCallback(resolve, { timeout: 3000 })
      : setTimeout(resolve, 100)
  );

/** Data-saver mode (Chromium; `prefers-reduced-data` ships nowhere yet). */
const saveData = () =>
  (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;

/**
 * After `load`, prefetch the packages behind `tags` (default all) one per idle
 * period, skipping loaded ones, unknown tags (warned) and Save-Data mode.
 * The entry calls this itself on `<script data-idle>` / `<body nucleus-kit-idle>`.
 */
export const idleLoadElements = async (
  tags: readonly string[] = PROGRESSIVE_TAGS
): Promise<void> => {
  const known = tags.filter(
    (tag) =>
      PROGRESSIVE_TAGS.includes(tag) ||
      console.warn(`[nucleus-kit] unknown idle tag <${tag}>`)
  );
  await loaded;
  if (saveData()) return;
  // one tag per package, so a family is one idle slot
  const queue = new Map(known.map((tag) => [PROGRESSIVE_LOADERS[tag], tag]));
  for (const tag of queue.values()) {
    if (pending.has(PROGRESSIVE_LOADERS[tag])) continue;
    await idle();
    await loadElement(tag)?.catch(() => {});
  }
};

// prerendered page: open the hydration window before any package loads, hold
// it until the first batch is in (`allSettled`: a failed import must not hold
// it). Not a prerendered page: both calls are no-ops.
bootHydration();
holdHydration(Promise.allSettled(observe(document).initial));

// opt-in: `data-idle` on this entry's own <script> (module scripts have no
// `currentScript`), else <body nucleus-kit-idle>; empty = every package
loaded.then(() => {
  const spec =
    [...document.querySelectorAll<HTMLScriptElement>("script[data-idle]")].find(
      (script) => script.src == import.meta.url
    )?.dataset.idle ?? document.body.getAttribute("nucleus-kit-idle");
  if (spec != null) idleLoadElements(spec.match(/\S+/g) ?? PROGRESSIVE_TAGS);
});
