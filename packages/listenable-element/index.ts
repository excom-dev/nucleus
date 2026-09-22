import { selectOne } from "../kit-utils/dom";
import { Neutron, TokenList } from "@excom/neutron";
import { debounce } from "throttle-debounce";

/**
 * Composition base that wires event and lifecycle listening. Subclasses implement `actionHandler`. Used by `<spa-a>`, `<event-handler>`, and similar interactive elements.
 *
 * @summary Declarative event / lifecycle listening for Neutron elements.
 */
export const ListenableElement = Neutron({
  tag: "noop-tag",
  props: {
    /**
     * @option
     * Listen on another element / `window` / `document` — e.g. Escape to
     * dismiss a dialog from a global `keydown`. Defaults to `:scope`. Used
     * with `listen-for`. Not compatible with `listen-for-lifecycle`. The
     * selector MUST resolve when `host-ref` is set — it will not wait for a
     * match to appear.
     * @values <CSS Selector> | window | document | html | body | head
     */
    hostRef: String,
    /**
     * @option
     * Space-separated event names to listen for. Defaults to `click` when unset (and no lifecycle list is set).
     * @values <EventName>…
     */
    listenFor: TokenList,
    /**
     * @option
     * Space-separated element lifecycles to handle.
     * @values connected | disconnected | adopted
     */
    listenForLifecycle: TokenList,
    /**
     * @option
     * Handle each distinct event name / lifecycle at most once.
     */
    listenOnce: Boolean,
    // TODO support :scope in the selector below
    /**
     * @option
     * Only handle events whose `event.target` matches this CSS selector. Does not support `:scope` in the selector.
     * @values <CSS Selector>
     */
    selectorFilter: String,
    /**
     * @option
     * Space-separated key filters (OR). Join modifiers with `+` (AND, any
     * order): `shift+k tab` → Shift+K or Tab. Modifiers: `shift`, `alt`,
     * `ctrl`/`control`, `meta`. Case-insensitive.
     * @values <key|mod+key>…
     */
    keycodeFilter: TokenList,
    /**
     * @option
     * Only handle when `location.pathname` is one of these values — route-aware behaviors without a separate router element.
     * @values <pathname>…
     */
    pathnameFilter: TokenList,
    /**
     * @option
     * Call `preventDefault()` on matched events (ignored for lifecycles).
     */
    preventDefault: Boolean,
    /**
     * @option
     * Call `stopPropagation()` on matched events (ignored for lifecycles).
     */
    stopPropagation: Boolean,
    /**
     * @option
     * Call `stopImmediatePropagation()` on matched events (ignored for lifecycles).
     */
    stopImmediatePropagation: Boolean,
    /**
     * @option
     * Vibrate on handle (`navigator.vibrate`). Empty / `0` uses a 20ms pulse.
     * @default 20 (when attribute is present with no value)
     */
    vibrateMs: Number,
    /**
     * @option
     * Delay handling by this many milliseconds.
     */
    delayMs: Number,
    /**
     * @option
     * With `delay-ms`, coalesce bursts into one trailing call (debounce).
     */
    isDebounced: Boolean,
    // Subclass hooks, not attributes (the analyzer skips Function-typed props).
    debouncedActionHandler: Function,
    actionHandler: Function,
    // private state
    _lifecycleTracker: {
      type: Array<"connected" | "disconnected" | "adopted">,
      defaultValue: () => [] as Array<"connected" | "disconnected" | "adopted">,
    },
    _hostElement: {
      // EventTarget (not Element) so `window` / `document` are allowed.
      type: EventTarget,
      store: "weak",
      notify: "prop",
    },
  },
})
  .defineMethods({
    handleEvent: (
      element,
      e: Event | "connected" | "disconnected" | "adopted"
    ) => {
      const {
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
        vibrateMs,
      } = element;
      const isLifecycle = typeof e === "string";
      if (
        isLifecycle ||
        (matchesKeycode(element, e) &&
          matchesSelector(element, e) &&
          matchesPathname(element))
      ) {
        if (!isLifecycle && preventDefault) {
          e.preventDefault();
        }
        if (!isLifecycle && stopPropagation) {
          e.stopPropagation();
        }
        if (!isLifecycle && stopImmediatePropagation) {
          e.stopImmediatePropagation();
        }
        // Boolean or number. A boolean attr (`vibrate=""`) is 0, so default to 20.
        if (typeof vibrateMs === "number") {
          navigator.vibrate?.(vibrateMs || 20);
        }
        if (typeof element.delayMs === "number") {
          if (element.debouncedActionHandler) {
            element.debouncedActionHandler(e);
          } else {
            setTimeout(() => element.actionHandler?.(e), element.delayMs);
          }
        } else {
          element.actionHandler?.(e);
        }
      }
    },
    shouldLifecycleOnce: (
      { listenForLifecycle, listenOnce, _lifecycleTracker },
      lc: "connected" | "adopted" | "disconnected"
    ) => {
      const willRun =
        listenForLifecycle?.includes(lc) &&
        (!listenOnce || !_lifecycleTracker.includes(lc));
      return [
        willRun && {
          // Mark this lifecycle as already run (`listen-once`)
          _lifecycleTracker: [..._lifecycleTracker, lc],
        },
        {
          returns: willRun,
        },
      ];
    },
  })
  .onConnected(
    ({ isMoving, shouldLifecycleOnce }) =>
      !isMoving &&
      shouldLifecycleOnce("connected") && { handleEvent: ["connected"] }
  )
  .onAdopted(
    ({ shouldLifecycleOnce }) =>
      shouldLifecycleOnce("adopted") && { handleEvent: ["adopted"] }
  )
  .onDisconnected(
    ({ isMoving, shouldLifecycleOnce }) =>
      !isMoving &&
      // Don't dispatch after disconnect; the element is gone.
      shouldLifecycleOnce("disconnected") && { handleEvent: ["disconnected"] }
  )
  .onPropChanged("hostRef", (element) => {
    if (!element.hostRef) return { _hostElement: null };
    const hostElement = selectOne(element.hostRef, {
      scope: element,
      enableRootRefs: true,
    });
    if (!hostElement)
      throw new Error(`Host element not found for ${element.hostRef}`);
    return { _hostElement: hostElement };
  })
  .onPropChanged(
    ["_hostElement", "listenFor"],
    ({ _hostElement, listenFor, handleEvent, listenOnce }, previous) => {
      // `previous` only has changed props; fall back to current values.
      const removeHost =
        previous && "_hostElement" in previous
          ? previous._hostElement
          : _hostElement;
      const removeArgs = removeHost ? { target: removeHost } : {};
      const addArgs = _hostElement ? { target: _hostElement } : {};
      const prevEvents =
        previous && "listenFor" in previous
          ? previous.listenFor?.length
            ? previous.listenFor
            : ["click"]
          : listenFor?.length
            ? listenFor
            : ["click"];
      const nextEvents = listenFor?.length ? listenFor : ["click"];
      return [
        {
          removeListeners: prevEvents.map((k) => [k, handleEvent, removeArgs]),
        },
        {
          addListeners: nextEvents.map((k) => [
            k,
            handleEvent,
            listenOnce ? { once: true, ...addArgs } : addArgs,
          ]),
        },
      ];
    }
  )
  .onPropChanged("isDebounced", ({ isDebounced, delayMs, actionHandler }) => {
    return {
      debouncedActionHandler: isDebounced
        ? debounce(delayMs || 10, actionHandler)
        : null,
    };
  });

const KEY_MODIFIERS: Record<string, (e: KeyboardEvent) => boolean> = {
  shift: (e) => e.shiftKey,
  alt: (e) => e.altKey,
  ctrl: (e) => e.ctrlKey,
  control: (e) => e.ctrlKey,
  meta: (e) => e.metaKey,
};

function modifierKeyName(mod: string): string {
  return mod === "ctrl" || mod === "control" ? "control" : mod;
}

/** One filter token: `k`, `shift`, or `shift+k` / `k+shift`. */
function matchesKeycodeToken(token: string, e: KeyboardEvent): boolean {
  const parts = token.toLowerCase().split("+").filter(Boolean);
  if (!parts.length) return false;

  const mods = parts.filter((p) => p in KEY_MODIFIERS);
  const keys = parts.filter((p) => !(p in KEY_MODIFIERS));
  if (!mods.every((m) => KEY_MODIFIERS[m](e))) return false;

  const key = e.key?.toLowerCase();
  if (!key) return false;
  if (keys.length) return keys.every((k) => key === k);
  // Modifier-only token (e.g. `shift`): match that modifier keydown.
  return mods.some((m) => key === modifierKeyName(m));
}

function matchesKeycode(element: any, e: Event) {
  if (!element.keycodeFilter?.length) return true;
  const ke = e as KeyboardEvent;
  return [...element.keycodeFilter].some((token: string) =>
    matchesKeycodeToken(token, ke)
  );
}

function matchesSelector(element: any, e: Event) {
  return (
    !element.selectorFilter ||
    (e.target as HTMLElement).matches(element.selectorFilter)
  );
}

function matchesPathname(element: any) {
  return (
    !element.pathnameFilter?.length ||
    element.pathnameFilter.includes(location.pathname)
  );
}
