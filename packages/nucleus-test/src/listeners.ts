// Kept on the targets under global symbols: `setup` and the index are
// separate bundles, so module state would not be shared.
const LISTENERS = Symbol.for("@excom/nucleus-test/listeners");
const TRACKED = Symbol.for("@excom/nucleus-test/tracked");

type Listeners = Record<string, EventListener[]>;
type Tracked = EventTarget & { [LISTENERS]?: Listeners };

/** Listeners added to `target` since setup / the last `clearEventListeners`, by type. */
export const getEventListeners = (target: EventTarget): Listeners =>
  (target as Tracked)[LISTENERS] ?? {};

/** Forgets `target`'s recorded listeners; they stay attached. */
export const clearEventListeners = (target: EventTarget): void => {
  delete (target as Tracked)[LISTENERS];
};

/**
 * Records `addEventListener` / `removeEventListener` calls. Patches
 * `HTMLElement` besides `EventTarget` (happy-dom's elements skip the latter),
 * and `window` / `document` themselves (happy-dom binds theirs per instance).
 * Safe to repeat.
 */
export function trackEventListeners(): void {
  const targets: EventTarget[] = [
    EventTarget.prototype,
    HTMLElement.prototype,
    window,
    document,
  ];
  for (const target of targets.filter(
    (target) => !Object.hasOwn(target, TRACKED)
  )) {
    Object.defineProperty(target, TRACKED, { value: true });
    const { addEventListener: add, removeEventListener: remove } = target;
    target.addEventListener = function (
      this: Tracked,
      type,
      listener,
      options
    ) {
      ((this[LISTENERS] ??= {})[type] ??= []).push(listener as EventListener);
      add.call(this, type, listener, options);
    };
    target.removeEventListener = function (
      this: Tracked,
      type,
      listener,
      options
    ) {
      const listeners = this[LISTENERS]?.[type] ?? [];
      const index = listeners.indexOf(listener as EventListener);
      if (index !== -1) listeners.splice(index, 1);
      if (!listeners.length) delete this[LISTENERS]?.[type];
      remove.call(this, type, listener, options);
    };
  }
}
