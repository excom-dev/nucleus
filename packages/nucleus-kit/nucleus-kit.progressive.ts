/**
 * `nucleus-kit.progressive.min.js`: lazy Nucleus Kit. Watches for Nucleus Kit
 * element tags (initial scan + `MutationObserver`) and imports that package on
 * first sight. Shared chunks (`neutron`, `kit-utils`, `quark`, bases) live
 * under `dist/progressive/` and load once.
 *
 * Vs the all-in `index.umd.min.js`: one extra round-trip before upgrade
 * (style the pre-upgrade state yourself), and ESM only.
 */
type Loader = () => Promise<unknown>;

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

const scan = (node: Node) => {
  if (node instanceof Element && node.localName in PROGRESSIVE_LOADERS) {
    loadElement(node.localName);
  }
  if ("querySelectorAll" in node) {
    (node as ParentNode)
      .querySelectorAll(SELECTOR)
      .forEach((el) => loadElement(el.localName));
  }
};

/**
 * Load the Nucleus Kit elements as their tags appear under `root` (an initial
 * scan, then every inserted subtree). Returns a disposer. The entry calls this
 * on `document` at import time; call it yourself for a shadow root.
 */
export const observeElements = (
  root: Document | Element | ShadowRoot
): (() => void) => {
  scan(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(scan);
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
};

observeElements(document);
