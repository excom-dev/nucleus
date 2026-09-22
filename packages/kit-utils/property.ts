/**
 * Observable properties. Neutron defines them with
 * `defineObservableProperty`; Quark subscribes with `observeProperty`
 * (any element: Neutron, third-party, or native).
 *
 * One own accessor per (target, name), always outermost:
 * - `observeProperty` wraps whatever is there (own accessor, data
 *   property, or inherited prototype accessor).
 * - `defineObservableProperty` installs the *base* getter/setter. If a
 *   wrapper is already on, the base is swapped under it so subscriptions
 *   survive upgrade.
 *
 * Notify after the base setter, only on `!==`. In-place object mutation
 * is not a write. Last subscriber off restores the base if the wrapper
 * is still the own descriptor.
 */

import { LoopGuard } from "./loop-guard";

export type PropertyObserver = (value: unknown, oldValue: unknown) => void;

export interface BaseDescriptor {
  get?: (this: object) => unknown;
  set?: (this: object, value: unknown) => void;
  enumerable?: boolean;
}

interface Entry {
  base: BaseDescriptor;
  /**
   * How to put the property back when the wrapper is removed: an own
   * descriptor to redefine, `"absent"` when nothing existed before (the
   * assigned value, if any, becomes a plain data property), or `null` for
   * an inherited accessor (the own shadow is simply removed).
   */
  restore: PropertyDescriptor | "absent" | null;
  subscribers: Set<PropertyObserver>;
  get: () => unknown;
  set: (value: unknown) => void;
}

const REGISTRY = new WeakMap<object, Map<string, Entry>>();

const entries = (target: object): Map<string, Entry> => {
  let map = REGISTRY.get(target);
  if (!map) REGISTRY.set(target, (map = new Map()));
  return map;
};

const findDescriptor = (
  target: object,
  name: string
): { descriptor: PropertyDescriptor; own: boolean } | null => {
  const own = Object.getOwnPropertyDescriptor(target, name);
  if (own) return { descriptor: own, own: true };
  for (
    let proto = Object.getPrototypeOf(target);
    proto;
    proto = Object.getPrototypeOf(proto)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor) return { descriptor, own: false };
  }
  return null;
};

const isDataDescriptor = (d: PropertyDescriptor) =>
  "value" in d || "writable" in d;

/** A base that stores in a closure slot (for data properties / absent). */
const slotBase = (value: unknown, writable: boolean): BaseDescriptor => {
  let slot = value;
  return {
    get: () => slot,
    set: writable
      ? (next) => {
          slot = next;
        }
      : undefined,
    enumerable: true,
  };
};

/** The wrapper's own descriptor, identity is how we recognize ourselves. */
const isWrapper = (target: object, name: string, entry: Entry) => {
  const own = Object.getOwnPropertyDescriptor(target, name);
  return !!own && own.get === entry.get && own.set === entry.set;
};

const install = (target: object, name: string): Entry | null => {
  const found = findDescriptor(target, name);
  let base: BaseDescriptor;
  let restore: Entry["restore"];
  if (!found) {
    base = slotBase(undefined, true);
    restore = "absent";
  } else if (isDataDescriptor(found.descriptor)) {
    if (found.descriptor.writable === false) return null;
    base = slotBase(found.descriptor.value, true);
    base.enumerable = found.descriptor.enumerable;
    // an own data property is restored with its current value; an
    // inherited one (rare) simply gets the own shadow removed
    restore = found.own ? { ...found.descriptor } : null;
  } else {
    if (!found.descriptor.set) return null;
    base = {
      get: found.descriptor.get,
      set: found.descriptor.set,
      enumerable: found.descriptor.enumerable,
    };
    restore = found.own ? { ...found.descriptor } : null;
  }
  if (found?.own && found.descriptor.configurable === false) return null;
  const entry: Entry = {
    base,
    restore,
    subscribers: new Set(),
    get() {
      return entry.base.get?.call(target);
    },
    set(value: unknown) {
      const old = entry.base.get?.call(target);
      // an observed assignment is one causal hop; past the loop guard's
      // limit it is dropped (the chain that led here is a runaway loop)
      const applied = LoopGuard.write(target, name, () => {
        entry.base.set?.call(target, value);
        return true;
      });
      if (applied === false) return;
      const next = entry.base.get?.call(target);
      if (next !== old) {
        entry.subscribers.forEach((subscriber) => subscriber(next, old));
      }
    },
  };
  Object.defineProperty(target, name, {
    get: entry.get,
    set: entry.set,
    enumerable: base.enumerable ?? false,
    configurable: true,
  });
  entries(target).set(name, entry);
  return entry;
};

const uninstall = (target: object, name: string, entry: Entry) => {
  entries(target).delete(name);
  if (!isWrapper(target, name, entry)) return; // someone redefined it
  const restore = entry.restore;
  if (!restore || restore === "absent") {
    const value = entry.base.get?.call(target);
    delete (target as Record<string, unknown>)[name];
    if (restore === "absent" && value !== undefined) {
      (target as Record<string, unknown>)[name] = value;
    }
    return;
  }
  if (isDataDescriptor(restore)) {
    Object.defineProperty(target, name, {
      ...restore,
      value: entry.base.get?.call(target),
    });
  } else {
    Object.defineProperty(target, name, {
      get: entry.base.get,
      set: entry.base.set,
      enumerable: restore.enumerable,
      configurable: true,
    });
  }
};

/**
 * Observe assignments to `target[name]`. Returns an unsubscribe function.
 * Read-only properties (no setter / non-writable) cannot change by
 * assignment, so nothing is installed and the returned function is a no-op.
 */
export const observeProperty = (
  target: object,
  name: string,
  observer: PropertyObserver
): (() => void) => {
  const entry = entries(target).get(name) ?? install(target, name);
  if (!entry) return () => {};
  entry.subscribers.add(observer);
  return () => {
    if (!entry.subscribers.delete(observer)) return;
    if (entry.subscribers.size === 0) uninstall(target, name, entry);
  };
};

/**
 * Define the storage-owning accessor of `target[name]`. Keeps an installed
 * observer wrapper on top (its base is swapped), so an element upgrading
 * after a sheet subscribed keeps that subscription.
 */
export const defineObservableProperty = (
  target: object,
  name: string,
  descriptor: BaseDescriptor
): void => {
  const entry = entries(target).get(name);
  if (entry && isWrapper(target, name, entry)) {
    entry.base = descriptor;
    // no slot to keep: the new base owns storage; nothing to restore to
    // but the base itself
    entry.restore = {
      get: descriptor.get,
      set: descriptor.set,
      enumerable: descriptor.enumerable ?? false,
      configurable: true,
    };
    return;
  }
  Object.defineProperty(target, name, {
    get: descriptor.get,
    set: descriptor.set,
    enumerable: descriptor.enumerable ?? false,
    configurable: true,
  });
};

/** Whether `target[name]` currently has observers. */
export const isObservedProperty = (target: object, name: string): boolean =>
  (REGISTRY.get(target)?.get(name)?.subscribers.size ?? 0) > 0;
