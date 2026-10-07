import { internal, owner } from "./happy-dom";
import { keepParentRead, parentNodeOf } from "./parents";
import { claim, type DomWindow } from "./window";

const SHIMMED = Symbol.for("@excom/nucleus-dom/event-path");
const DOCUMENT = 9;
const FRAGMENT = 11;

type Target = EventTarget & Partial<Node & { host: Element }>;

/**
 * An event's `composedPath()` as happy-dom builds it (every dispatch does),
 * climbing by the `parentNode` getter kept at install: budgets that spy on
 * the public getter count the app's walks, not an event's.
 */
export function keepEventPaths(win: DomWindow | typeof globalThis): void {
  keepParentRead(win);
  const proto = owner(win.Event.prototype, "composedPath");
  if (!claim(proto, SHIMMED)) return;
  const [, windowKey] = internal(win.document, "window");
  /** What follows `target` in `event`'s path: its parent, a composed event's shadow host, a document's window. */
  const next = (event: Event, target: Target) => {
    const parent =
      target instanceof win.Node ? parentNodeOf(target) : target.parentNode;
    if (parent) return parent;
    if (event.composed && target.nodeType === FRAGMENT && target.host)
      return target.host;
    // `load` stops at the document
    return target.nodeType === DOCUMENT && event.type !== "load"
      ? (target as unknown as Record<symbol, EventTarget>)[windowKey]
      : null;
  };
  proto.composedPath = function (this: Event) {
    const path: EventTarget[] = [];
    let target = this.target as Target | null | undefined;
    while (target) {
      path.push(target);
      target = next(this, target) as Target | null | undefined;
    }
    return path;
  };
}
