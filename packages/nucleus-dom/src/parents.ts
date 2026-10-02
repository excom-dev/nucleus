import { owner } from "./happy-dom";
import type { DomWindow } from "./window";

// where happy-dom's own `parentNode` getter is kept, on `Node.prototype`
const KEPT = Symbol.for("@excom/nucleus-dom/parent-node");

let readParent: (this: Node) => ParentNode | null;

/**
 * Keeps happy-dom's `parentNode` getter, once for the process (its classes
 * are shared between windows). The shims climb by it, so budgets that spy on
 * the public getters count the app's walks, not matching, event paths or
 * upgrades.
 */
export function keepParentRead(win: DomWindow | typeof globalThis): void {
  const proto = owner(win.Node.prototype, "parentNode");
  if (!Object.hasOwn(proto, KEPT))
    Reflect.defineProperty(proto, KEPT, {
      value: Object.getOwnPropertyDescriptor(proto, "parentNode")!.get,
    });
  readParent = (proto as unknown as Record<symbol, typeof readParent>)[KEPT];
}

/** `node`'s `parentNode`, through the getter kept at install. */
export const parentNodeOf = (node: Node): ParentNode | null =>
  readParent.call(node);

/** `el`'s parent element, by `parentNode`. */
export const parentOf = (el: Element): Element | null => {
  const parent = parentNodeOf(el);
  return parent?.nodeType === 1 ? (parent as Element) : null;
};
