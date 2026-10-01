import { claim, type DomWindow } from "./window";

const SHIMMED = Symbol.for("@excom/nucleus-dom/query-selector");

/** Runs `run` with `:scope` rewritten to a temporary attribute on `el`. */
const withScopeMarker = <T>(
  el: Element,
  selectors: string,
  run: (scoped: string) => T
): T => {
  if (!selectors.includes(":scope")) return run(selectors);
  const marker = `n-happy-dom-scope-${Math.random().toString(36).slice(2, 11)}`;
  el.setAttribute(marker, "");
  try {
    return run(selectors.replace(/:scope/g, `[${marker}]`));
  } finally {
    el.removeAttribute(marker);
  }
};

/**
 * Descendants of `root` via one `childNodes` walk. happy-dom can say
 * `form.contains(input) === false` for controls of an offline-parsed, then
 * appended `<form>`; `childNodes` stays right.
 */
const descendantsOf = (root: Node): Set<Node> => {
  const set = new Set<Node>();
  const stack: Node[] = [root];
  while (stack.length) {
    const children = stack.pop()!.childNodes;
    for (let i = 0; i < children.length; i++) {
      set.add(children[i]);
      stack.push(children[i]);
    }
  }
  return set;
};

/**
 * Is `node` a descendant of `root` (never `root` itself)? `contains` first;
 * most tree-wide matches lie outside `root`, so the walk runs once, on the
 * first miss.
 */
const withinChecker = (root: Node) => {
  let descendants: Set<Node> | undefined;
  return (node: Node): boolean =>
    node !== root &&
    (root.contains(node) || (descendants ??= descendantsOf(root)).has(node));
};

/** Matches in `el`'s tree (document / shadow root) that descend from `el`. */
const matchesWithin = (
  el: Element,
  selectors: string,
  first: boolean
): Element[] => {
  const matches = (el.getRootNode() as Document | ShadowRoot).querySelectorAll(
    selectors
  );
  const within = withinChecker(el);
  const out: Element[] = [];
  for (let i = 0; i < matches.length && !(first && out.length); i++) {
    if (within(matches[i])) out.push(matches[i]);
  }
  return out;
};

/**
 * Browser `querySelector(All)` on elements: match against the whole tree,
 * keep descendants, so ancestor compounds (`body > main p`) and `:scope`
 * work. Offline trees keep happy-dom's subtree query.
 */
export function scopeQueriesToDocument(
  win: DomWindow | typeof globalThis
): void {
  const proto = win.Element.prototype;
  if (!claim(proto, SHIMMED)) return;
  const { querySelector, querySelectorAll } = proto;
  proto.querySelector = function (this: Element, selectors: string) {
    return withScopeMarker(this, String(selectors), (scoped) =>
      this.isConnected
        ? (matchesWithin(this, scoped, true)[0] ?? null)
        : querySelector.call(this, scoped)
    );
  } as typeof querySelector;
  proto.querySelectorAll = function (this: Element, selectors: string) {
    return withScopeMarker(this, String(selectors), (scoped) =>
      this.isConnected
        ? matchesWithin(this, scoped, false)
        : querySelectorAll.call(this, scoped)
    );
  } as typeof querySelectorAll;
}
