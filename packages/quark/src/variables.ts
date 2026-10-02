import { findBindingOwner, readBinding } from "./bindings";
import {
  isThenable,
  markRenderPromise,
  PENDING_READ,
  VALUE_MAP,
} from "./constants";
import { QuarkEvalError } from "./evaluator";
import { getQuarkInternal } from "./quark-internal";
import type { ExpressionResult, QuarkOptions } from "./types";
import { QuarkLogger } from "./utils";
import { hashObject } from "@excom/hash-object";
import {
  di,
  execWhenReady,
  getChildren,
  isHydrating,
  isPojo,
  isPrimitive,
  isServerRender,
  resolveTemplateContent,
  templateIdentity,
} from "@excom/kit-utils";

/** A row's loop key as text: a server render writes it, the client adopts the row by it. */
const KEY_ATTR = "q-key";

/**
 * While hydrating, a server-rendered row `iterate()` has not adopted yet: a
 * `q-key`, no loop data. Later (or a copied row on a client-only page) it
 * is an ordinary child, re-rendered like a cold page's.
 */
const isServerRow = (row: Element) =>
  isHydrating() &&
  getQuarkInternal(row).getLoopIndex() === undefined &&
  row.hasAttribute(KEY_ATTR);

/** `row` renders `key`: its loop key, or a server row's `q-key` (as text). */
const isRowOf = (row: Element, key: unknown) =>
  isServerRow(row)
    ? row.getAttribute(KEY_ATTR) === String(key)
    : getQuarkInternal(row).getLoopKey() === key;

/** Loop data of `el`'s row. A server row has none until adopted: its rules wait. */
const loopOf = (el: Element) => {
  const row = el.closest("[q-loop] > *");
  if (row && isServerRow(row)) throw PENDING_READ;
  return row ? getQuarkInternal(row) : undefined;
};

const setLoopData = (
  el,
  index?: number,
  item?: any,
  hash?: string,
  key?: string
) => {
  const elementInternal = getQuarkInternal(el);
  // Always set index, whether number or string (for dicts)
  if (index !== undefined) elementInternal.setLoopIndex(index);
  if (item !== undefined) elementInternal.setLoopItem(item);
  if (typeof hash === "string") elementInternal.setLoopHash(hash);
  if (key !== undefined) elementInternal.setLoopKey(key);
  return el;
};

type BuiltinContext = {
  elRef: WeakRef<HTMLElement>;
  options: QuarkOptions;
};

/** Queue `element` for the next rule run of the sheet resolving `options`. */
const requeue = (
  options: QuarkOptions,
  element: HTMLElement,
  attribute: "content" | "NEW_SELF"
) => options.rule?.quarkInstance.queueRunRules({ element, attribute });

/**
 * Built-in expression names. Each factory produces the value for one
 * evaluation; most return a function. `element` is the matched element;
 * `item` / `index` read the element's loop context. Factories run only
 * when an expression actually references the name (see `createScope`).
 */
const BUILTINS: Record<string, (ctx: BuiltinContext) => unknown> = {
  /*
   * The matched element (the listening element inside `@on` blocks,
   * where `target` is the delegate). Hand the node to `@use` functions.
   * Reads through it are not observed.
   */
  element: ({ elRef }: BuiltinContext): HTMLElement | undefined =>
    di.apply([elRef], (el) => el),
  item: ({ elRef }: BuiltinContext): unknown | undefined | null =>
    di.apply([elRef], (el) => loopOf(el)?.getLoopItem()),
  index: ({ elRef }: BuiltinContext): number | undefined =>
    di.apply([elRef], (el) => loopOf(el)?.getLoopIndex()),
  // `@on … { }` blocks: the event being handled (see Rule.runEvent)
  event: ({ options }: BuiltinContext): Event | undefined => options.event,
  // `@on (target: "…") { }` blocks: the delegate element; else event.target
  target: ({ options }: BuiltinContext): EventTarget | null | undefined =>
    options.eventTarget ?? options.event?.target,
  "prevent-default":
    () =>
    (e: Event): void =>
      e.preventDefault(),
  "stop-propagation":
    () =>
    (e: Event): void =>
      e.stopPropagation(),
  /*
   * `prop("x")`: the matched element's JS property (the `attr()` of
   * properties). Literal names the property statically references are
   * subscribed on first read so a JS assignment re-runs it.
   */
  prop:
    ({ elRef, options }: BuiltinContext) =>
    (name: string): unknown =>
      di.apply([elRef], (el) => {
        if (typeof name !== "string") return undefined;
        const property = options.property;
        if (property?.referencedPropNames.includes(name)) {
          options.rule?.quarkInstance.subscribeProp(el, name);
        }
        return (el as unknown as Record<string, unknown>)[name];
      }),
  attr:
    ({ elRef }: BuiltinContext) =>
    (attrName: string): string | null | undefined =>
      di.apply([elRef], (el) => {
        if (attrName === "content") {
          return el?.innerHTML;
        } else {
          return el?.getAttribute(attrName);
        }
      }),
  closest:
    ({ elRef }: BuiltinContext) =>
    (selector: string): unknown | undefined | null =>
      di.apply([elRef], (el) => el.closest(selector)),
  ternary:
    () =>
    (condition: boolean, trueValue: any, falseValue?: any): any =>
      condition ? trueValue : (falseValue ?? null),
  // debugging
  log:
    () =>
    <A>(...args: A[]): A[] => {
      console.log("Quark log() -> ", ...args);
      return args;
    },
  debug:
    () =>
    <A>(...args: A[]): A[] => {
      args;
      debugger;
      return args;
    },
  "dangerous-html":
    ({ elRef }: BuiltinContext) =>
    (result: unknown): ExpressionResult | PromiseLike<unknown> =>
      // an outside promise passes through for `content:` to refuse
      isThenable(result)
        ? result
        : di.apply([elRef], () => {
            if (isPrimitive(typeof result)) {
              return {
                type: "html",
                value: result as string,
              };
            }
          }),
  template:
    ({ elRef }: BuiltinContext) =>
    (templateRef: string): Promise<ExpressionResult> | undefined => {
      const ref = templateRef || ":scope > template";
      const nodes = di.apply([elRef], (el) => {
        return execWhenReady(
          resolveTemplateContent(
            ref,
            {
              scope: el,
            }
            // template needs cloning, otherwise it will be removed from the DOM
          ),
          (templateHtml) => {
            const node = document.importNode(templateHtml, true) as Node;
            return {
              type: "nodes" as const,
              value: [node],
              // only a server render (stamps it) and hydration (adopts by
              // it) need the source
              identity:
                isServerRender() || isHydrating()
                  ? templateIdentity(ref, { scope: el })
                  : null,
            };
          }
        );
      });
      return markRenderPromise(nodes);
    },
  iterate:
    ({ elRef, options }: BuiltinContext) =>
    (
      result,
      templateRef,
      keyProperty
    ):
      | Promise<ExpressionResult | null>
      | PromiseLike<unknown>
      | undefined
      | null => {
      // no collection → wipe rendered children (use `preserve` to opt out)
      if (result == null) return null;
      // an outside promise passes through for `content:` to refuse
      if (isThenable(result)) return result;
      const rows = di.apply([elRef], async (el) => {
        const isArray = Array.isArray(result);
        const isObject = !isArray && isPojo(result);
        if (!isArray && !isObject) return undefined;
        return execWhenReady(
          resolveTemplateContent(
            templateRef || ":scope > template",
            {
              scope: el,
            }
            // template needs cloning, otherwise it will be removed from the DOM
          ),
          (templateHtml) => {
            // hydrating: a server list keeps its marker, nothing to rewrite
            if (!isHydrating() || !el.hasAttribute("q-loop")) {
              el.setAttribute("q-loop", "");
            }
            const existingChildren = getChildren(el).otherChildren;
            const entriesResult = isArray
              ? result.map((item, index) => [index, item])
              : Object.entries(result);
            if (!entriesResult.length) {
              // empty collection → wipe non-template children
              return {
                type: "nodes" as const,
                value: [],
              };
            }
            QuarkLogger.info({
              method: "iterate",
              runId: options.runId,
              result: [[entriesResult]],
              options,
            });
            const changedElements: Node[] = [];
            // server rows adopted this pass: one item each (duplicates)
            const adopted = new Set<Element>();
            const returnChildren = entriesResult.map(
              ([resultIndex, resultItem]) => {
                const resultKey = keyProperty
                  ? resultItem[keyProperty]
                  : hashObject(resultItem);
                // use hash for key if key property is not provided
                const hash = !keyProperty ? resultKey : hashObject(resultItem);
                const existingChild = existingChildren.find(
                  // TODO account for scenario where data matches multiple elements
                  (c) => !adopted.has(c) && isRowOf(c, resultKey)
                );
                if (!existingChild || isServerRow(existingChild)) {
                  // key not found: a new row. A server row is adopted as is,
                  // with the loop data its rules read
                  const row =
                    existingChild ??
                    (document.importNode(templateHtml, true) as Element);
                  if (existingChild) adopted.add(existingChild);
                  else if (isServerRender()) {
                    row.setAttribute(KEY_ATTR, String(resultKey));
                  }
                  changedElements.push(
                    setLoopData(row, resultIndex, resultItem, hash, resultKey)
                  );
                  return row;
                }
                const internal = getQuarkInternal(existingChild as HTMLElement);
                let didChange = false;

                if (resultIndex !== internal.getLoopIndex()) {
                  // if data was re-ordered, update index
                  setLoopData(existingChild, resultIndex);
                  didChange = true;
                }
                const existingHash = internal.getLoopHash();
                const existingKey = internal.getLoopKey();
                if (hash !== existingHash) {
                  // if data changed, update data and hash. If hash and key were the same, update key with new hash
                  setLoopData(
                    existingChild,
                    undefined,
                    resultItem,
                    hash,
                    existingHash === existingKey ? hash : undefined
                  );
                  didChange = true;
                }
                if (didChange) {
                  changedElements.push(existingChild);
                }
                return existingChild;
              }
            );
            return {
              type: "nodes" as const,
              value: returnChildren as Node[],
              after: di.bind([elRef], (el) => {
                /*
                 * Inserted / moved rows reach rules through the childList
                 * observer. A keyed row whose data changed in place
                 * moves no DOM node, so requeue those directly. All rows
                 * changed: one `content` entry on the parent (dedupes
                 * with the observer); otherwise each changed row as
                 * itself.
                 */
                if (entriesResult.length === changedElements.length) {
                  requeue(options, el, "content");
                } else {
                  changedElements.forEach((c) => {
                    requeue(options, c as HTMLElement, "NEW_SELF");
                  });
                }
                if (adopted.size) {
                  options.rule?.quarkInstance.queueAdoptedRows(el, [
                    ...adopted,
                  ]);
                }
              }),
            };
          }
        );
      });
      return markRenderPromise(rows);
    },
};

/** Built-in names, for the language-metadata sync test (`language.ts`). */
export const BUILTIN_NAMES: readonly string[] = Object.keys(BUILTINS);

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * `@use` module exports flattened into one lookup object, cached per
 * modules record. `addModules` replaces the record, so the WeakMap key
 * changes exactly when the module set does.
 */
const MODULE_SCOPE_CACHE = new WeakMap<object, Record<string, unknown>>();
const getModuleScope = (options: QuarkOptions): Record<string, unknown> => {
  const instance = options.rule?.quarkInstance;
  if (!instance) return {};
  const modules: Record<string, Record<string, unknown>> | undefined =
    getQuarkInternal(instance.host.deref())?.getModules(instance.hash);
  if (!modules) return {};
  const cached = MODULE_SCOPE_CACHE.get(modules);
  if (cached) return cached;
  const { dfault, ...others } = modules;
  const scope: Record<string, unknown> = { ...dfault, ...others };
  MODULE_SCOPE_CACHE.set(modules, scope);
  return scope;
};

export interface QuarkScope {
  /**
   * Resolve a bare identifier or `$variable` for the evaluating element.
   * Order: value keywords → `@use` exports → built-ins → `$bindings`
   * (walk ancestors; `undefined` when unbound, pending while hydrating).
   * Unknown bare ids throw.
   */
  lookup(name: string): unknown;
}

/**
 * Lazy expression scope. Nothing resolves until the evaluator asks for
 * a name, so an expression pays only for what it references: no module
 * spread, no built-in construction, no `item` / `index` `closest()`
 * walks unless used. $bindings are tree-scoped: walk ancestors from the
 * consumer (nearest owner wins), whichever sheet set them (CSS
 * custom-property semantics). VALUE_MAP supplies the behavior keywords
 * (none / preserve / unset).
 */
export const createScope = ({
  element,
  options,
}: {
  element: HTMLElement;
  options: QuarkOptions;
}): QuarkScope => {
  const modules = getModuleScope(options);
  let ctx: BuiltinContext | null = null;
  let builtins: Record<string, unknown> | null = null;
  return {
    lookup(name: string): unknown {
      if (hasOwn(VALUE_MAP, name)) return VALUE_MAP[name];
      if (hasOwn(modules, name)) return modules[name];
      if (hasOwn(BUILTINS, name)) {
        // one instance per name per evaluation (`item` twice in one
        // expression walks once)
        builtins ??= {};
        if (!hasOwn(builtins, name)) {
          ctx ??= { elRef: new WeakRef(element), options };
          builtins[name] = BUILTINS[name](ctx);
        }
        return builtins[name];
      }
      if (name.startsWith("$")) {
        const value = readBinding(element, name);
        // hydrating: a binding no rule wrote yet (its sheet may still load
        // `@use`) keeps the server's paint; readers re-run once it is bound
        if (
          value === undefined &&
          isHydrating() &&
          !findBindingOwner(element, name)
        ) {
          throw PENDING_READ;
        }
        return value;
      }
      throw new QuarkEvalError(`"${name}" is not defined`);
    },
  };
};
