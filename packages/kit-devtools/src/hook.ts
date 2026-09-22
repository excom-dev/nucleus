import { toJsonSafe } from "@excom/kit-utils";

/**
 * Shared DevTools hook (Neutron lifecycles, Quark orchestration, …).
 * Shipped always; dormant until `__NUCLEUS_DEVTOOLS_HOOK__` is set
 * (extension at `document_start`, or `attachDevtools()`).
 *
 *   publicize(["neutron", "effect"], { weakElement, tag, effect })
 *   publicize(["quark", "apply"], { weakElement, tag, selector, key })
 *
 * Each producer `registerRenderer`s an inspector; `hook.inject(renderer)`
 * once per hook, keyed by `renderer.kind`.
 *
 * No element refs here. Payloads are WeakRef + primitives.
 * `inspect()` snapshots on demand; don't keep the live element.
 */

export const NUCLEUS_DEVTOOLS_HOOK_KEY = "__NUCLEUS_DEVTOOLS_HOOK__";
export const NUCLEUS_DEVTOOLS_HOOK_VERSION = 1 as const;

/** Hierarchical identifying tokens, e.g. `["neutron", "constructed"]`. */
export type PublicizePath = readonly string[];

/**
 * Publication metadata. Callers should pass WeakRef + primitives only.
 * Never hard element / instance references.
 */
export type PublicizeMeta = Record<string, unknown>;

/** Which producer a renderer inspects for. */
export type DevtoolsRendererKind = "neutron" | "quark";

/**
 * On-demand inspector registered by a producer. `inspect` returns a
 * JSON-safe snapshot for the element, or `null` when the producer has
 * nothing to say about it.
 */
export type DevtoolsRenderer = {
  version: typeof NUCLEUS_DEVTOOLS_HOOK_VERSION;
  kind: DevtoolsRendererKind;
  inspect: (el: Element) => Record<string, unknown> | null;
};

/**
 * Global hook installed by a DevTools consumer.
 * `publicize` mirrors the producer API: same `(path, meta)` signature.
 * `inject` receives one renderer per producer kind.
 */
export type DevtoolsHook = {
  version: typeof NUCLEUS_DEVTOOLS_HOOK_VERSION;
  inject?: (renderer: DevtoolsRenderer) => void;
  publicize?: (path: PublicizePath, meta: PublicizeMeta) => void;
};

declare global {
  var __NUCLEUS_DEVTOOLS_HOOK__: DevtoolsHook | undefined;
}

export const getDevtoolsHook = (): DevtoolsHook | undefined =>
  (globalThis as Record<string, unknown>)[NUCLEUS_DEVTOOLS_HOOK_KEY] as
    | DevtoolsHook
    | undefined;

/**
 * Prefix / wildcard match for subscriber filtering.
 * `["neutron"]` matches `["neutron", "constructed"]`.
 * `"*"` matches any single token at that position.
 */
export const pathMatches = (
  path: PublicizePath,
  pattern: PublicizePath
): boolean =>
  pattern.length <= path.length &&
  pattern.every((token, i) => token === "*" || token === path[i]);

/**
 * Serializers for DevTools payloads (see `toJsonSafe`). Only plain data
 * crosses into the extension (avoids cross-realm Object pitfalls).
 * Non-POJOs (Promise, Map, …) become `{ $constructor: "Promise" }`.
 */
export const DEVTOOLS_SERIALIZERS: Record<string, (value: any) => unknown> = {
  function: () => ({ $constructor: "Function" }),
  symbol: (value: symbol) => ({
    $constructor: "Symbol",
    description: value.description ?? null,
  }),
  WeakRef: (value: WeakRef<WeakKey>) => {
    const deref = value.deref();
    return deref === undefined ? null : deref;
  },
  Node: (value: Node) => ({ $node: value.nodeName }),
  Element: (value: Element) => ({
    $element: value.localName ?? value.nodeName,
    id: value.id || null,
  }),
  UnknownObject: (value: unknown) => ({
    $constructor:
      (value as object).constructor?.name ||
      Object.prototype.toString.call(value),
  }),
  Circular: () => ({ $constructor: "Circular" }),
  Failed: () => ({ $unserializable: true }),
};

/** JSON-safe clone using the DevTools serializers. */
export const toDevtoolsJson = (value: unknown): unknown =>
  toJsonSafe(value, DEVTOOLS_SERIALIZERS);

const renderers = new Map<DevtoolsRendererKind, DevtoolsRenderer>();
/** Renderer kinds already injected into a given hook object. */
const injected = new WeakMap<DevtoolsHook, Set<DevtoolsRendererKind>>();

/**
 * Register (or replace) a producer's renderer. Injected into the current
 * hook immediately when one is installed, and into any hook attached later.
 */
export const registerRenderer = (renderer: DevtoolsRenderer): void => {
  renderers.set(renderer.kind, renderer);
  const hook = getDevtoolsHook();
  if (hook) injected.get(hook)?.delete(renderer.kind);
  injectRenderersIfNeeded();
};

export const getRenderer = (
  kind: DevtoolsRendererKind
): DevtoolsRenderer | undefined => renderers.get(kind);

/** Hand every registered renderer to the hook, once per hook object. */
export const injectRenderersIfNeeded = (): void => {
  const hook = getDevtoolsHook();
  if (!hook?.inject) return;
  let done = injected.get(hook);
  if (!done) {
    done = new Set();
    injected.set(hook, done);
  }
  for (const renderer of renderers.values()) {
    if (done.has(renderer.kind)) continue;
    done.add(renderer.kind);
    hook.inject(renderer);
  }
};

/**
 * Install (or replace) the global hook and (re)inject every renderer.
 * Used by tests and by late-attaching consumers (e.g. a bookmarklet).
 * Chrome extensions should set the global at `document_start` instead.
 *
 * Subscriber mirrors producer:
 *   attachDevtools({
 *     version: 1,
 *     publicize: (path, meta) => { … },
 *   })
 */
export const attachDevtools = (hook: DevtoolsHook): void => {
  (globalThis as Record<string, unknown>)[NUCLEUS_DEVTOOLS_HOOK_KEY] = hook;
  injected.delete(hook);
  injectRenderersIfNeeded();
};

/**
 * Event a consumer dispatches on `globalThis` after installing the hook
 * global itself, late, without access to `attachDevtools` (an injected
 * agent-tools bundle). Producers answer by injecting their renderers.
 */
export const NUCLEUS_DEVTOOLS_ATTACH_EVENT = "nucleus-devtools-attach";

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener(NUCLEUS_DEVTOOLS_ATTACH_EVENT, () =>
    injectRenderersIfNeeded()
  );
}

/**
 * Publish a DevTools event. No-op when no hook is installed.
 * Meta (except `weakElement`) is JSON-cloned in-page before crossing to the hook.
 *
 * @example
 * publicize(["neutron", "constructed"], { weakElement, tag })
 * publicize(["quark", "apply"], { weakElement, tag, selector, key })
 */
export const publicize = (
  path: PublicizePath,
  meta: PublicizeMeta = {}
): void => {
  const hook = getDevtoolsHook();
  if (!hook?.publicize) return;
  const { weakElement, ...rest } = meta;
  hook.publicize(path, {
    ...(toDevtoolsJson(rest) as PublicizeMeta),
    ...(weakElement ? { weakElement } : {}),
  });
};
