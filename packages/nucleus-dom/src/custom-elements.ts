import { internal, owner } from "./happy-dom";
import { keepParentRead, parentNodeOf } from "./parents";
import { claim, type DomWindow } from "./window";

type Win = DomWindow | typeof globalThis;
type CallbackName = (typeof CALLBACKS)[number];
type Callback = (this: Element, ...args: unknown[]) => unknown;
type Definition = {
  elementClass: CustomElementConstructor;
  lifecycleCallbacks: Partial<Record<CallbackName, Callback>>;
};
type Definitions = Map<string, Definition>;
type Reactions = {
  enqueueReaction(element: Element, name: CallbackName, args?: unknown[]): void;
};
type Create = (this: Document, ...args: unknown[]) => Element;
type State = {
  /** Elements whose upgrade threw: undefined for good, as in browsers. */
  failed: WeakSet<Element>;
  /** Parsed elements waiting for their definition's turn. */
  waiting: WeakSet<Element>;
  watched: WeakSet<Definition>;
  /** `super()` stand-ins of classes mid-upgrade. */
  upgraders: WeakSet<object>;
  /** Undefined elements the insertion in progress connected. */
  inserted: Element[];
  /** happy-dom `connectedToNode()` calls in progress. */
  connecting: number;
  /** Above 0: a throwing callback is reported and the work goes on. */
  isolating: number;
  /** Above 0: a replacement moves nodes; their callbacks are held. */
  holding: number;
};

const SHIMMED = Symbol.for("@excom/nucleus-dom/upgrade-clones");
const HTML = "http://www.w3.org/1999/xhtml";
const CALLBACKS = [
  "connectedCallback",
  "disconnectedCallback",
  "attributeChangedCallback",
] as const;
const NO_DEFINITIONS: Definitions = new Map();

// one per process: each nucleus-dom copy gates a definition once
const state = ((globalThis as Record<symbol, State | undefined>)[
  Symbol.for("@excom/nucleus-dom/custom-elements")
] ??= {
  failed: new WeakSet(),
  waiting: new WeakSet(),
  watched: new WeakSet(),
  upgraders: new WeakSet(),
  inserted: [],
  connecting: 0,
  isolating: 0,
  holding: 0,
});

const windowOf = (node: Node) =>
  node.ownerDocument?.defaultView as Win | null | undefined;

/** As browsers report an uncaught error: the window's `error` event and console. */
const report = (node: Node, error: unknown) => {
  const win = windowOf(node)!;
  const [view, dispatchError] = internal(win, "dispatchError");
  (view[dispatchError] as (this: Win, error: unknown) => void).call(win, error);
};

/** Runs `run`; custom element callbacks report what they throw, as in browsers. */
export const isolated = <T>(run: () => T): T => {
  state.isolating++;
  try {
    return run();
  } finally {
    state.isolating--;
  }
};

const call = (
  element: Element,
  callback: Callback | undefined,
  args: unknown[]
) => {
  try {
    return callback?.apply(element, args);
  } catch (error) {
    if (!state.isolating) throw error;
    report(element, error);
  }
};

/** happy-dom's own map of `registry`'s definitions, in definition order. */
const definitionsOf = (registry: CustomElementRegistry) => {
  const [owner, key] = internal(registry, "registry");
  return owner[key] as Definitions;
};

/** The definition of `node` when it is an undefined element free to upgrade. */
const definitionOf = (node: Node): Definition | undefined => {
  const win = windowOf(node);
  const element = node as HTMLElement;
  return win &&
    Object.getPrototypeOf(element) === win.HTMLElement.prototype &&
    !state.failed.has(element) &&
    !state.waiting.has(element)
    ? definitionsOf(win.customElements).get(element.localName)
    : undefined;
};

/** The class in `cls`'s chain whose `super()` is `root`'s (or an upgrader's). */
const baseOf = (cls: object, root: object): object | undefined => {
  const parent = Object.getPrototypeOf(cls);
  if (parent === root || state.upgraders.has(parent)) return cls;
  return parent ? baseOf(parent, root) : undefined;
};

/**
 * Puts `element` in `placeholder`'s place with its attributes and children,
 * their callbacks held: the element object changes.
 */
const replace = (placeholder: HTMLElement, element: HTMLElement) => {
  state.holding++;
  try {
    [...placeholder.attributes].forEach((attribute) =>
      element.setAttributeNode(attribute.cloneNode() as Attr)
    );
    while (placeholder.firstChild) element.append(placeholder.firstChild!);
    placeholder.replaceWith(element);
  } finally {
    state.holding--;
  }
  return element;
};

/**
 * Runs the class's constructor on `element` itself, its `super()` handing the
 * element over, as a browser's upgrade. A constructor that never calls
 * `super()` (compiled ES5: `Reflect.construct(HTMLElement, …)`) makes its own
 * element, which takes `element`'s place. A throw leaves `element` undefined
 * for good. Gives the upgraded element.
 */
const construct = (
  element: HTMLElement,
  { elementClass }: Definition
): HTMLElement | undefined => {
  const root = windowOf(element)!.HTMLElement;
  const base = baseOf(elementClass, root);
  let next: HTMLElement | undefined = element;
  const upgrader = function (...args: unknown[]) {
    const cls: unknown = new.target;
    if (!next || cls !== elementClass)
      return Reflect.construct(root, args, new.target);
    const target = next;
    next = undefined;
    return Object.setPrototypeOf(target, elementClass.prototype);
  };
  try {
    const parent = base && Object.getPrototypeOf(base);
    state.upgraders.add(upgrader);
    if (base) Object.setPrototypeOf(base, upgrader);
    let made: unknown;
    try {
      made = Reflect.construct(elementClass, []);
    } finally {
      if (base) Object.setPrototypeOf(base, parent);
    }
    if (made === element) return element;
    if (!(made instanceof root))
      throw new TypeError(
        `<${element.localName}>: its class does not extend HTMLElement`
      );
    if (next && made instanceof elementClass)
      return replace(element, made as HTMLElement);
    throw new TypeError(
      `<${element.localName}>: its constructor returned another object`
    );
  } catch (error) {
    Object.setPrototypeOf(element, root.prototype);
    state.failed.add(element);
    report(element, error);
  }
};

/**
 * Upgrades undefined `element` as browsers do: its constructor runs with its
 * attributes and children there, then `attributeChangedCallback` per
 * attribute and `connectedCallback`. Gives the element now in its place.
 */
const upgrade = (
  element: HTMLElement,
  definition: Definition
): HTMLElement | undefined => {
  watch(definition);
  const upgraded = construct(element, definition);
  if (!upgraded) return;
  const win = windowOf(upgraded)!;
  const [registry, callbacks] = internal(win.customElements, "callbacks");
  // define() never comes for a defined name: drop its placeholders' waits
  (registry[callbacks] as Map<string, unknown>).delete(upgraded.localName);
  const [view, stack] = internal(win, "customElementReactionStack");
  const reactions = view[stack] as Reactions;
  [...upgraded.attributes].forEach(({ name, value }) =>
    reactions.enqueueReaction(upgraded, "attributeChangedCallback", [
      name,
      null,
      value,
    ])
  );
  if (upgraded.isConnected)
    reactions.enqueueReaction(upgraded, "connectedCallback");
  return upgraded;
};

/**
 * Upgrades the undefined elements of `node`'s tree in tree order; `<template>`
 * content stays undefined. Gives the node now in `node`'s place.
 */
const upgradeTree = (node: Node): Node => {
  const definition = definitionOf(node);
  const current =
    (definition && upgrade(node as HTMLElement, definition)) || node;
  [...((current as ParentNode).children ?? [])].forEach(upgradeTree);
  return current;
};

/** The topmost undefined element above `node`, or `node`. */
const topmost = (node: Node, top: Node = node): Node => {
  const parent = parentNodeOf(node);
  return parent ? topmost(parent, definitionOf(parent) ? parent : top) : top;
};

/** Upgrades what insertions connected undefined, in tree order, as browsers. */
const flush = () =>
  state.inserted.splice(0).forEach((element) => {
    if (definitionOf(element)) isolated(() => upgradeTree(topmost(element)));
  });

/**
 * Gates `definition`'s callbacks: happy-dom calls them on any element of its
 * name, even undefined. Those get none; but one connecting upgrades once the
 * insertion is done (see `upgradeClones()`), as browsers upgrade on insertion.
 */
const watch = (definition: Definition): void => {
  if (state.watched.has(definition)) return;
  state.watched.add(definition);
  const { elementClass, lifecycleCallbacks } = definition;
  const originals = { ...lifecycleCallbacks };
  CALLBACKS.forEach((name) => {
    lifecycleCallbacks[name] = function (this: Element, ...args: unknown[]) {
      if (state.holding) return;
      if (this instanceof elementClass)
        return call(this, originals[name], args);
      if (name === "connectedCallback" && definitionOf(this))
        state.inserted.push(this);
    };
  });
};

/**
 * Parses `html` into `root` as a browser loads a page whose element
 * definitions run after the markup: custom elements parse undefined, then
 * each definition, in definition order, upgrades its elements in place, in
 * parse order. `<template>` content stays undefined until imported or
 * inserted. Callbacks that throw are reported; the load goes on.
 */
export const loadPage = (win: Win, root: Element, html: string): void => {
  const { document } = win;
  const registry = win.customElements as CustomElementRegistry &
    Record<symbol, Definitions>;
  const [, key] = internal(registry, "registry");
  const definitions = registry[key];
  upgradeClones(win);
  const parsed: HTMLElement[] = [];
  const own = Object.getOwnPropertyDescriptor(document, "createElementNS");
  const create = document.createElementNS as unknown as Create;
  // a defined name parses undefined: the registry hides while it is created
  Object.defineProperty(document, "createElementNS", {
    configurable: true,
    value(
      this: Document,
      namespace: string | null,
      name: string,
      options?: unknown
    ) {
      if (namespace !== HTML || !definitions.has(name))
        return create.call(this, namespace, name, options);
      registry[key] = NO_DEFINITIONS;
      try {
        const element = create.call(
          this,
          namespace,
          name,
          options
        ) as HTMLElement;
        state.waiting.add(element);
        parsed.push(element);
        return element;
      } finally {
        registry[key] = definitions;
      }
    },
  });
  isolated(() => {
    try {
      root.innerHTML = html;
    } finally {
      if (own) Object.defineProperty(document, "createElementNS", own);
      else delete (document as Partial<Document>).createElementNS;
    }
    const turns = new Map<string, HTMLElement[]>();
    parsed.forEach((element) => {
      // `<template>` content: undefined until imported or inserted
      if (!element.isConnected) state.waiting.delete(element);
      else if (turns.has(element.localName))
        turns.get(element.localName)!.push(element);
      else turns.set(element.localName, [element]);
    });
    definitions.forEach((definition, name) =>
      turns.get(name)?.forEach((element) => {
        state.waiting.delete(element);
        // moved out of the page before its turn: upgrades once inserted again
        if (element.isConnected) upgrade(element, definition);
      })
    );
  });
};

/**
 * Undefined custom elements upgrade as in browsers. happy-dom upgrades only
 * those connected when `define()` runs, and calls the definition's callbacks
 * on the rest. Shimmed, every definition (existing or later) is gated: an
 * undefined element gets no callbacks; `document.importNode()` upgrades the
 * ones it imports, with the importing document's definitions; an insertion
 * upgrades the ones it connects, in tree order, once done. So `<template>`
 * content (which `resetDocument()` leaves undefined) renders working
 * elements. A class whose constructor never calls `super()` (compiled ES5)
 * gets a new element in place of the undefined one.
 */
export function upgradeClones(win: Win): void {
  keepParentRead(win);
  const registry = win.customElements;
  definitionsOf(registry).forEach(watch);
  const registryProto = owner(registry, "define");
  if (claim(registryProto, SHIMMED)) {
    const { define } = registryProto;
    registryProto.define = function (
      this: CustomElementRegistry,
      ...args: Parameters<CustomElementRegistry["define"]>
    ) {
      define.apply(this, args);
      const definition = definitionsOf(this).get(args[0]);
      if (definition) watch(definition);
    };
  }
  const documentProto = owner(win.document, "importNode");
  if (claim(documentProto, SHIMMED)) {
    const { importNode } = documentProto;
    documentProto.importNode = function <T extends Node>(
      this: Document,
      node: T,
      deep?: boolean
    ) {
      const imported = importNode.call(this, node, deep) as T;
      const registry = this.defaultView?.customElements;
      return registry && definitionsOf(registry).size
        ? (isolated(() => upgradeTree(imported)) as T)
        : imported;
    };
  }
  const [nodeProto, connectedToNode] = internal(
    win.Node.prototype,
    "connectedToNode"
  );
  if (claim(nodeProto, SHIMMED)) {
    const connect = nodeProto[connectedToNode] as (this: Node) => void;
    nodeProto[connectedToNode] = function (this: Node) {
      state.connecting++;
      try {
        connect.call(this);
      } finally {
        state.connecting--;
        if (!state.connecting && state.inserted.length) flush();
      }
    };
  }
}
