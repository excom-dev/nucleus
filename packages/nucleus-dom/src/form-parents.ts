import { internal } from "./happy-dom";
import { claim, type DomWindow } from "./window";

const SHIMMED = Symbol.for("@excom/nucleus-dom/form-parents");

type Internals = Node & Record<symbol, unknown>;

/**
 * Gives a node as the tree holds it: a `<form>` / `<select>` is a proxy
 * there, while happy-dom runs the proxy's methods on the object behind it.
 */
export const proxyOf = (win: DomWindow | typeof globalThis) => {
  const node = win.document.createElement("div");
  const [tagName, formNode, selectNode] = [
    "tagName",
    "formNode",
    "selectNode",
  ].map((name) => internal(node, name)[1]);
  // a form / select keeps its proxy in its own formNode / selectNode
  return <T extends Node>(target: T): T => {
    const own = target as T & Internals;
    const tag = own[tagName];
    return ((tag === "FORM"
      ? own[formNode]
      : tag === "SELECT"
        ? own[selectNode]
        : null) ?? target) as T;
  };
};

/**
 * A `<form>` / `<select>` attached with its children (a rendered template, a
 * moved subtree) stays their parent: `form.contains(input)`,
 * `input.parentNode`, `input.closest("form")`, `compareDocumentPosition()`.
 * happy-dom parents them to the object behind the element's proxy.
 */
export function keepFormParents(win: DomWindow | typeof globalThis): void {
  const proxy = proxyOf(win);
  const [proto, connectedToNode] = internal(
    win.Node.prototype,
    "connectedToNode"
  );
  if (!claim(proto, SHIMMED)) return;
  const connect = proto[connectedToNode] as (this: Node) => void;
  proto[connectedToNode] = function (this: Node) {
    return connect.call(proxy(this));
  };
}
