import { isNumber, isPojo } from "./common";
import { LoopGuard } from "./loop-guard";

export const createElement = (
  tagName,
  props = {},
  children: HTMLElement[] = []
) => {
  const element = document.createElement(tagName);
  Object.entries(props).forEach(([key, value]) => {
    if (key === "attributes") {
      Object.entries(value || {}).forEach(([attrName, attrValue]) => {
        element.setAttribute(attrName, attrValue);
      });
    } else {
      element[key] = value;
    }
  });
  children.forEach((child) => {
    if (typeof child === "string") {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  });
  return element;
};

export const getChildren = (element: Element) => {
  const templateChild =
    element.children?.[0] instanceof HTMLTemplateElement
      ? element.children?.[0]
      : null;
  const otherChildren = templateChild
    ? [...element.children].slice(1)
    : [...element.children];
  return {
    templateChild,
    otherChildren,
  };
};

/* TODO optimize this function. Very heavy. */
/**
 * Replace `element`'s non-`<template>` children with `newChildren`.
 * Returns whether the child list changed: `false` also when the loop
 * guard dropped the write (child insertions are one causal hop, keyed
 * `"content"` on the parent, the same key a childList observer maps to).
 */
export const replaceNonTemplateChildren = (
  element: Element,
  newChildren: Node[] = []
): boolean =>
  LoopGuard.write(element, "content", () =>
    replaceChildrenUnguarded(element, newChildren)
  );

const replaceChildrenUnguarded = (
  element: Element,
  newChildren: Node[] = []
) => {
  let didChangeChildren = false;
  if (newChildren.length > 0) {
    newChildren.forEach((newChild, index) => {
      // children mutate each pass, so re-read otherChildren
      const { otherChildren } = getChildren(element);
      const oldChild = otherChildren[index];
      if (oldChild) {
        if (oldChild !== newChild) {
          if (
            newChild.parentElement === element &&
            newChild instanceof HTMLElement
          ) {
            /* Already a sibling: swap via a placeholder so the live
             * child list stays intact. Neutron can optimize the move. */
            newChild.replaceWith(document.createElement("div"));
            oldChild.replaceWith(newChild);
            didChangeChildren = true;
          } else {
            // inbound node, not already here
            oldChild.replaceWith(newChild);
            didChangeChildren = true;
          }
        } else {
          // same node at this index
        }
      } else {
        // past the old list: append
        element.appendChild(newChild);
        didChangeChildren = true;
      }
    });
    const { otherChildren } = getChildren(element);
    if (newChildren.length < otherChildren.length) {
      otherChildren.slice(newChildren.length).forEach((oldChild) => {
        // leftover old nodes
        oldChild.remove();
        didChangeChildren = true;
      });
    }
  } else {
    // empty new list: strip everything but the <template>
    const { otherChildren } = getChildren(element);
    otherChildren.forEach((oldChild) => {
      oldChild.remove();
      didChangeChildren = true;
    });
  }
  return didChangeChildren;
};

const wrapContent = (content: Node) => {
  const wrapper = document.createElement("div");
  wrapper.appendChild(content);
  return wrapper;
};

export const buildContent = (
  _content: DocumentFragment,
  options?: { skipCloning?: boolean }
) => {
  const content = (
    options?.skipCloning
      ? _content
      : (document.importNode(_content, true) as unknown as Element)
  ) as Element;
  const numberOfChildren = content.children?.length;
  return numberOfChildren === 1 ? content.children?.[0] : wrapContent(content);
};

const getRootNode = (scope?: Element | Document | null): Document | null => {
  return (scope as any)?.getRootNode?.() ?? document;
};

const getRoot = (
  root?: string,
  scope?: Element | null
): Element | Document | null => {
  if (!root) return getRootNode(scope) || null;
  if (!scope) return getRootNode(scope)?.querySelector?.(root) || null;
  return scope.closest?.(root) || null;
};

function recognizeRootRef(ref: string) {
  if (ref === "window") return window;
  if (ref === "document") return document;
  if (ref === "html") return document.documentElement;
  if (ref === "body") return document.body;
  if (ref === "head") return document.head;
  return null;
}

type SelectRootRefResult<EnableRootRefs extends boolean> =
  EnableRootRefs extends true ? Window | Document | Element : never;

type SelectFnResult<Fn extends "querySelector" | "querySelectorAll"> =
  Fn extends "querySelector" ? HTMLElement | null : HTMLElement[] | null;

type SelectResult<
  Fn extends "querySelector" | "querySelectorAll",
  EnableRootRefs extends boolean,
> = SelectFnResult<Fn> | SelectRootRefResult<EnableRootRefs>;

export const _select = <
  Fn extends "querySelector" | "querySelectorAll",
  EnableRootRefs extends boolean = false,
>(
  _selector: string,
  {
    root,
    scope,
    fn,
    enableRootRefs,
  }: {
    root?: string;
    scope?: Element;
    fn: Fn;
    enableRootRefs?: EnableRootRefs;
  }
): SelectResult<Fn, EnableRootRefs> => {
  if (enableRootRefs) {
    const _root = recognizeRootRef(_selector.trim());
    if (_root) return _root as SelectRootRefResult<EnableRootRefs>;
  }
  const _root = getRoot(root, scope);
  if (!_root) return null;
  let selector = _selector;
  let tempAttr = "";
  /* Only a selector that mentions `:scope` needs the scope element tagged */
  const tagScope = !!scope && _root !== scope && _selector.includes(":scope");
  if (tagScope) {
    tempAttr = `n-util-select-id-${Math.random().toString(36).substring(2, 11)}`;
    scope!.setAttribute(tempAttr, "");
    selector = selector.replace(/:scope/g, `[${tempAttr}]`);
  }
  const result = (_root as any)[fn](selector);
  if (tagScope) {
    scope!.removeAttribute(tempAttr);
  }
  return (
    fn === "querySelector"
      ? (result as HTMLElement | null)
      : Array.from(result as NodeListOf<HTMLElement>)
  ) as SelectFnResult<Fn>;
};

export const selectOne = <EnableRootRefs extends boolean = false>(
  selector: string,
  opts: {
    root?: string;
    scope?: Element;
    enableRootRefs?: EnableRootRefs;
  } = {}
): SelectResult<"querySelector", EnableRootRefs> => {
  return _select(selector, {
    root: opts.root,
    scope: opts.scope,
    fn: "querySelector",
    enableRootRefs: opts.enableRootRefs,
  });
};

export const selectAll = <EnableRootRefs extends boolean = false>(
  selector: string,
  opts: {
    root?: string;
    scope?: Element;
    enableRootRefs?: EnableRootRefs;
  } = {}
): SelectResult<"querySelectorAll", EnableRootRefs> => {
  return _select(selector, {
    root: opts.root,
    scope: opts.scope,
    fn: "querySelectorAll",
    enableRootRefs: opts.enableRootRefs,
  });
};

export const attributesToEntries = (
  attributes: NamedNodeMap,
  attrNamespace?: string,
  attrFormatter?: (attr: Attr) => [string, string]
): [string, string][] =>
  Object.values(attributes)
    .filter(
      (a) => a?.name && (!attrNamespace || a.name.startsWith(attrNamespace))
    )
    .map((a) =>
      attrFormatter ? attrFormatter(a) : ([a.name, a.value] as [string, string])
    );

export const attributesToObject = (
  attributes: NamedNodeMap,
  attrNamespace?: string,
  attrFormatter?: (attr: Attr) => [string, string]
): Record<string, string> => {
  return Object.fromEntries(
    attributesToEntries(attributes, attrNamespace, attrFormatter)
  );
};

/**
 * Prop-type marker for space-separated token attributes
 * (`props: { eventNames: TokenList }` ↔ `event-names="a b"`).
 * The runtime value is a plain `string[]`; this class is never instantiated.
 * It exists so a prop config can name the type the way it names `String` or
 * `Number`. Shipped with the Neutron factory (`import { TokenList } from
 * "@excom/neutron"`).
 */
export class TokenList extends Array<string> {}

type AttrType =
  | typeof Boolean
  | typeof Number
  | typeof String
  | typeof TokenList
  | "boolean"
  | "number"
  | "string"
  | "tokens";
type AttrValue = string | null;
export const Converter = {
  boolean: {
    attr: {
      convert: (attrValue: AttrValue) => (attrValue === null ? false : true),
      isTruthy: (attrValue: AttrValue) => !isNullish(attrValue),
      defaultValue: null,
    },
    prop: {
      convert: (propValue: unknown) =>
        propValue || typeof propValue === "string" ? "" : null,
      isTruthy: (propValue: unknown) => !!propValue,
      defaultValue: false,
    },
  },
  number: {
    attr: {
      convert: (attrValue: AttrValue) => {
        if (["", null].includes(attrValue)) return null;
        const num = Number(attrValue);
        return isNumber(num) ? num : null;
      },
      isTruthy: (attrValue: AttrValue) =>
        !isNullish(attrValue) && attrValue !== "",
      defaultValue: null,
    },
    prop: {
      convert: (propValue: unknown) =>
        isNullish(propValue) || propValue === "" ? null : propValue + "",
      isTruthy: (propValue: unknown) => isNumber(propValue),
      defaultValue: null,
    },
  },
  string: {
    attr: {
      convert: (attrValue: AttrValue) =>
        isNullish(attrValue) ? null : attrValue,
      isTruthy: (attrValue: AttrValue) => !isNullish(attrValue),
      defaultValue: null,
    },
    prop: {
      convert: (propValue: unknown) =>
        isNullish(propValue) ? null : propValue + "",
      isTruthy: (propValue: unknown) => !isNullish(propValue),
      defaultValue: null,
    },
  },
  tokens: {
    attr: {
      convert: (attrValue: AttrValue) => {
        if (isNullish(attrValue)) return null;
        return attrValue
          .split(" ")
          .map((t) => t.trim())
          .filter((t) => t);
      },
      isTruthy: (attrValue: AttrValue) => !isNullish(attrValue),
      defaultValue: null,
    },
    prop: {
      convert: (propValue: unknown) => {
        if (Array.isArray(propValue)) {
          return propValue.filter((v) => !isNullish(v) && v !== "").join(" ");
        } else {
          return null;
        }
      },
      isTruthy: (propValue: unknown) => Array.isArray(propValue),
      defaultValue: null,
    },
  },
  nonPrimitive: {
    attr: {
      convert: (_: AttrValue) => {
        throw new Error("Cannot convert non-primitive to attribute");
      },
      isTruthy: (attrValue: AttrValue) => !isNullish(attrValue),
      defaultValue: null,
    },
    prop: {
      convert: (propValue: unknown) => {
        try {
          return Array.isArray(propValue)
            ? propValue.length + ""
            : isPojo(propValue)
              ? Object.keys(propValue as Record<string, unknown>).length + ""
              : !!propValue
                ? ""
                : null;
        } catch (error) {
          return !!propValue ? "" : null;
        }
      },
      isTruthy: (propValue: unknown) => !isNullish(propValue),
      defaultValue: null,
    },
  },
  getAttrName: (propName: string) => camelToDash(propName),
  getPropName: (attrName: string) => dashToCamel(attrName),
  type: <T>(
    type: T,
    options?: { convertNonPrimitives?: boolean }
  ): T extends AttrType ? (typeof Converter)["string"] : void => {
    switch (type) {
      case String:
        return Converter.string;
      case Boolean:
        return Converter.boolean;
      case Number:
        return Converter.number;
      case TokenList:
        return Converter.tokens;
      default:
        if (
          ["string", "number", "boolean", "tokens"].includes(type as string)
        ) {
          return Converter[type];
        } else if (options?.convertNonPrimitives) {
          if (isNullish(type)) {
            return undefined;
          } else {
            return Converter.nonPrimitive;
          }
        } else {
          return undefined;
        }
    }
  },
};

export const setAttr = (
  elementOrNamedNodeMap: HTMLElement | NamedNodeMap,
  name: string,
  value: unknown
) => {
  const shouldRemove = isNullish(value);
  if (elementOrNamedNodeMap instanceof HTMLElement) {
    const element = elementOrNamedNodeMap;
    const oldVal = element.getAttribute(name);
    // caller (setProp) often already compared; cheap to re-check
    if (value !== oldVal) {
      // one causal hop: a runaway chain (effect ↔ attribute) is cut here
      LoopGuard.write(element, name, () => {
        element[shouldRemove ? "removeAttribute" : "setAttribute"](
          name,
          value as string
        );
      });
    }
  } else {
    const attributes = elementOrNamedNodeMap;
    if (shouldRemove) {
      attributes.removeNamedItem(name);
    } else {
      let attr = attributes.getNamedItem(name);
      if (value !== attr?.value) {
        if (!attr) {
          attr = document.createAttribute(name);
          attributes.setNamedItem(attr);
        }
        attr.value = value as string;
      }
    }
  }
};

export const getAttr = (
  elementOrNamedNodeMap: HTMLElement | NamedNodeMap,
  name: string
) => {
  if (elementOrNamedNodeMap instanceof HTMLElement) {
    return elementOrNamedNodeMap.getAttribute(name);
  } else {
    const attr = elementOrNamedNodeMap.getNamedItem(name);
    return attr?.value ?? null;
  }
};

export const isNullish = <T>(value: T): value is T & (null | undefined) =>
  [null, undefined].includes(value as any);

export const isPrimitive = (value: unknown): boolean =>
  ["string", "number", "boolean", "tokens"].includes(value as any);

export const isPrimitiveConstructor = (value: AttrType | any): boolean =>
  [String, Number, Boolean, TokenList].includes(value);

export const dashToCamel = (str: string): string =>
  str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());

export const camelToDash = (str: string): string =>
  str.replace(/([A-Z])/g, (g) => `-${g[0].toLowerCase()}`);

export const objToAttrs = (
  obj: Record<string, unknown>,
  options: {
    preserveKey?: boolean;
    prefix?: string;
    convertNonPrimitives?: boolean;
  } = {}
): Record<string, string | null> => {
  const prefix = typeof options.prefix === "string" ? options.prefix : "";
  return Object.fromEntries(
    Object.entries(obj).map(([key, val]) => {
      const valType =
        Array.isArray(val) &&
        val.every((v) => typeof v === "string" || isNullish(v))
          ? TokenList
          : typeof val;
      const converter = Converter.type(valType, {
        convertNonPrimitives: options?.convertNonPrimitives,
      });
      return [
        `${prefix}${options?.preserveKey ? key.toLowerCase() : camelToDash(key)}`,
        converter?.prop.convert(val) ?? null,
      ];
    })
  );
};

export const PropSerializer = {
  dfault: {
    serialize: (v: unknown) => v,
    deserialize: (v: unknown) => v,
  },
  weak: {
    serialize: (v: unknown) => (v ? new WeakRef(v) : v),
    deserialize: (v: unknown | WeakRef<WeakKey>) =>
      v instanceof WeakRef ? v.deref() : v,
  },
};
