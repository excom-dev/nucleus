import { toJsonSafe } from "@excom/kit-utils";
/** Demo helpers for docs-site live demos (`@use "/demo-utils"`). */

/** Write `JSON.stringify(event.detail)` into the nearest / current `output`. */
export const _setOutputFromDetail =
  ({ shouldAppend = false }) =>
  (e: CustomEvent) => {
    const el = e.currentTarget as Element;
    const output = (
      el instanceof HTMLOutputElement ? el : el.querySelector("output")
    ) as HTMLOutputElement | null;
    if (!output) return;
    const line = JSON.stringify(toJsonSafe(e.detail ?? {}), null, 2);
    if (shouldAppend) {
      output.textContent += "\n" + line;
    } else {
      output.textContent = line;
    }
  };

export const setOutputFromDetail = _setOutputFromDetail({
  shouldAppend: false,
});
export const appendOutputFromDetail = _setOutputFromDetail({
  shouldAppend: true,
});

/**
 * Write `JSON.stringify(event.target.provision)` into the nearest / current
 * `output`. Neutron elements with a `provision` prop dispatch the
 * framework-level `neutron-provision` event whenever it's set, so this
 * works for any `provider-*` element without a bespoke event name.
 */
export const setOutputFromElementData = (e: Event) => {
  const scope = e.currentTarget as Element;
  const output = (
    scope instanceof HTMLOutputElement ? scope : scope.querySelector("output")
  ) as HTMLOutputElement | null;
  const source = e.target as unknown as { provision?: unknown } | null;
  if (!output || !source) return;
  output.textContent = JSON.stringify(source.provision ?? null, null, 2);
};

/**
 * Bump a `$count` binding from JS (`quark` js-api demo). Receives the
 * owner element from the sheet (`@on click (handle: incrementFromJs(closest(…)))`)
 * and returns the click handler; `element.quark.setProperty()` re-runs
 * every rule reading `$count` below the owner.
 */
export const incrementFromJs = (owner: Element) => () => {
  const current = Number(owner.quark.getPropertyValue("$count") ?? 0);
  owner.quark.setProperty("$count", current + 1);
};

/** Static list for the `quark` iterate demo. */
export const getPlanets = () => ["Mercury", "Venus", "Earth", "Mars"];

/** Note an intercepted event in the demo's `output` (`quark` events demo). */
export const noteEvent = (e: Event) => {
  const output = (e.currentTarget as Element).parentElement?.querySelector(
    "output"
  );
  if (output) output.textContent = `"${e.type}" handled — navigation prevented`;
};

/** Noop stand-in for a real Safari polyfill loader (`detect-browser` demo). */
export const loadPolyfills = (browserInfo) => {
  console.log("<detect-browser> polyfill demo data:", browserInfo);
  // load polyfills here
  return "polyfills loaded";
};

/** `localStorage` key seeded by the `provider-storage` demo. */
export const DEMO_STORAGE_KEY = "demo-provider-storage";

/**
 * Writes a fresh payload into `localStorage`, then forces the nearest
 * `<provider-storage>` to re-read it. The browser's `storage` event only
 * fires in *other* tabs, so a same-tab write needs `key-name` re-set.
 * It is toggled off and back on around the write.
 */
export const seedDemoStorage = (e: Event) => {
  const scope = e.currentTarget as Element;
  const el = scope.querySelector("provider-storage") as
    | (Element & { keyName: string })
    | null;
  if (!el) return;
  localStorage.setItem(
    DEMO_STORAGE_KEY,
    JSON.stringify({ seededAt: new Date().toLocaleTimeString() })
  );
  el.keyName = "";
  el.keyName = DEMO_STORAGE_KEY;
};
