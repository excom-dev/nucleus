import { claim, type DomWindow } from "./window";

const SHIMMED = Symbol.for("@excom/nucleus-dom/mutation-observer");
const PINS = Symbol("mutation-observer-pins");

type Observed = Node &
  Record<symbol, { callback?: Partial<WeakRef<object>> }[] | undefined>;
type Pinned = MutationObserver & { [PINS]?: Set<object> };

/**
 * happy-dom 20.8 holds each observer's dispatch closure in a `WeakRef`, so
 * the first GC after `observe()` silences the observer. Pins the closure to
 * its observer until `disconnect()`.
 */
export function pinMutationObservers(win: DomWindow | typeof globalThis): void {
  const proto = win.MutationObserver.prototype;
  // Found on a node rather than imported: an import can be a second happy-dom copy.
  const listenersKey = Object.getOwnPropertySymbols(win.document).find(
    (symbol) => symbol.description === "mutationListeners"
  );
  if (!listenersKey || !claim(proto, SHIMMED)) return;
  const { observe, disconnect } = proto;
  proto.observe = function (
    this: Pinned,
    target: Observed,
    options?: MutationObserverInit
  ) {
    const listeners = target?.[listenersKey] ?? [];
    const known = listeners.length;
    observe.call(this, target, options);
    const added = listeners[known]?.callback?.deref?.();
    if (added) (this[PINS] ??= new Set()).add(added);
  };
  proto.disconnect = function (this: Pinned) {
    disconnect.call(this);
    this[PINS]?.clear();
  };
}
