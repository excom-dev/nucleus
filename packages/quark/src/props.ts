/**
 * `prop("name")` reactivity: observe a JS property on the matched
 * element, whatever kind it is.
 *
 * Subscriptions go through `observeProperty` (kit-utils), the same
 * helper Neutron defines its props with, so one own accessor per
 * element + property intercepts writes from any source. Writes coalesce
 * per element into one bubbling `quark-prop-change` per microtask
 * (`detail.names`). Every sheet hears it at its root and matches
 * `propIndex`. Same bus as `quark-binding-change`.
 *
 * Subscriptions are refcounted per (element, name) across sheets; each
 * sheet releases the ones it took on `unregister()`.
 */
import { observeProperty } from "@excom/kit-utils";

export const PROP_CHANGE_EVENT = "quark-prop-change";

export interface PropChangeDetail {
  names: string[];
}

interface Subscription {
  count: number;
  unsubscribe: () => void;
}

const SUBSCRIPTIONS = new WeakMap<Element, Map<string, Subscription>>();
const PENDING = new Map<Element, Set<string>>();
let flushQueued = false;

const flush = () => {
  flushQueued = false;
  const batch = [...PENDING];
  PENDING.clear();
  batch.forEach(([element, names]) => {
    if (!element.isConnected) return;
    element.dispatchEvent(
      new CustomEvent<PropChangeDetail>(PROP_CHANGE_EVENT, {
        bubbles: true,
        detail: { names: [...names] },
      })
    );
  });
};

const queuePropChange = (element: Element, name: string) => {
  let names = PENDING.get(element);
  if (!names) PENDING.set(element, (names = new Set()));
  names.add(name);
  if (!flushQueued) {
    flushQueued = true;
    queueMicrotask(flush);
  }
};

/**
 * Take a (refcounted) subscription to `element[name]`. A custom element
 * that is not defined yet is observed now and re-observed once it
 * upgrades, in case upgrade replaced the property (the vanilla "upgrade
 * property" idiom deletes own descriptors). Returns a release function.
 */
export const subscribeProp = (element: Element, name: string): (() => void) => {
  let byName = SUBSCRIPTIONS.get(element);
  if (!byName) SUBSCRIPTIONS.set(element, (byName = new Map()));
  let subscription = byName.get(name);
  if (!subscription) {
    const observer = () => queuePropChange(element, name);
    let unsubscribe = observeProperty(element, name, observer);
    const tag = element.localName;
    if (tag.includes("-") && !customElements.get(tag)) {
      customElements.whenDefined(tag).then(() => {
        // still wanted? re-observe: a no-op when the wrapper survived
        if (byName?.get(name) === subscription) {
          unsubscribe();
          unsubscribe = observeProperty(element, name, observer);
        }
      });
    }
    subscription = { count: 0, unsubscribe: () => unsubscribe() };
    byName.set(name, subscription);
  }
  subscription.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscription.count--;
    if (subscription.count === 0) {
      subscription.unsubscribe();
      byName.delete(name);
    }
  };
};
