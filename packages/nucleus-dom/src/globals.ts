import { builtin } from "./node";
import type { DomWindow } from "./window";

// stay Node's (the window's `queueMicrotask` drops callbacks once closed)
const NODE_KEYS = new Set([
  "Buffer",
  "constructor",
  "global",
  "process",
  "queueMicrotask",
]);
const INSTALLS = Symbol.for("@excom/nucleus-dom/globals");

/** What one install replaced: each key's earlier descriptor, if any. */
type Install = Map<string, PropertyDescriptor | undefined>;

// active installs, oldest first; shared by every copy of this module
const installs: Install[] = ((globalThis as { [INSTALLS]?: Install[] })[
  INSTALLS
] ??= []);

/** `object` and its prototypes, up to `Object.prototype`. */
const chain = (object: object | null): object[] =>
  object && object !== Object.prototype
    ? [object, ...chain(Object.getPrototypeOf(object))]
    : [];

const put = (key: string, descriptor: PropertyDescriptor | undefined) => {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else delete (globalThis as Record<string, unknown>)[key];
};

/**
 * Puts `win`'s globals on `globalThis`, as a test environment does, so
 * browser modules imported in Node run against it (`window` is `win`);
 * returns the restore function. Node-side code then gets the window's timers
 * and `fetch` too: a 1.5 s `setTimeout` held above 1000 ms never fires, so
 * tooling takes its timers from `node:timers`. JavaScript built-ins,
 * `console` and `process` stay Node's; a global assigned while installed
 * (`location = …`, `onerror = …`) shadows the window's. Install before
 * importing modules that bind at import time; restore before disposing.
 */
export function installGlobals(win: DomWindow): () => void {
  const intrinsics = new Set(
    builtin("node:vm").runInNewContext(
      "Object.getOwnPropertyNames(globalThis)"
    ) as string[]
  );
  const install: Install = new Map(
    [
      ...new Set(
        chain(win).flatMap((object) => Object.getOwnPropertyNames(object))
      ),
    ]
      .filter((key) => !intrinsics.has(key) && !NODE_KEYS.has(key))
      .map(
        (key) =>
          [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
      )
      .filter(([, descriptor]) => descriptor?.configurable !== false)
  );
  const overrides = new Map<string, unknown>();
  const bound = new WeakMap<object, unknown>();
  // methods bound to the window; classes (capitalized) as they are
  const read = (key: string) => {
    const value = (win as unknown as Record<string, unknown>)[key];
    if (typeof value !== "function" || /^[A-Z]/.test(key)) return value;
    if (!bound.has(value)) bound.set(value, value.bind(win));
    return bound.get(value);
  };
  for (const key of install.keys()) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => (overrides.has(key) ? overrides.get(key) : read(key)),
      set: (value) => overrides.set(key, value),
    });
  }
  installs.push(install);
  return () => {
    const index = installs.indexOf(install);
    if (index < 0) return;
    installs.splice(index, 1);
    for (const [key, descriptor] of install) {
      // a later install holds this one's accessor: it restores what was before
      const later = installs.slice(index).find((other) => other.has(key));
      if (later) later.set(key, descriptor);
      else put(key, descriptor);
    }
  };
}
