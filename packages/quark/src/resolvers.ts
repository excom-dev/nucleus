import type { ListenerOptionSource } from "./ast";
import type { DiagnosticLevel } from "./ast";
import { isNoop, isWipe, SYMBOL_NOOP } from "./constants";
import { getDevtoolsHook, publicize } from "./devtools-hook";
import { evaluateExpression, getExpressionAst } from "./evaluator";
import { isFormControlAttribute, syncTextControl } from "./form-controls";
import { type PaintEntry, type PaintTransition, schedulePaint } from "./paint";
import {
  DYNAMIC_LISTENER_OPTIONS,
  type Listener,
  listenerHost,
  type ResolvedListenerOptions,
} from "./properties";
import { getQuarkInternal } from "./quark-internal";
import { type SettleUntil, trackPending } from "./settle";
import type { ContextField, ExpressionResult, TransitionSpec } from "./types";
import { QuarkLogger } from "./utils";
import { createScope } from "./variables";
import {
  getChildren,
  isPojo,
  LoopGuard,
  objToAttrs,
  Queue,
  replaceNonTemplateChildren,
  tc,
} from "@excom/kit-utils";

/**
 * Write text only when it differs from what's painted: one text node
 * holding `text` (or no children for `""`). Same-string re-runs skip
 * the DOM. Anything else in the target (elements, several nodes) is
 * replaced as before.
 */
const paintText = (target: Node, text: string) => {
  const first = target.firstChild;
  if (!(first === null ? text === "" : isSoleText(first, text))) {
    target.textContent = text;
  }
  // a <textarea>'s text is only its default value: mirror it to .value
  syncTextControl(target, text);
};
const isSoleText = (node: ChildNode, text: string) =>
  node.nodeType === Node.TEXT_NODE &&
  node.nextSibling === null &&
  (node as Text).data === text;

/** Clear rendered content. `null` from expressions (e.g. `none`) lands here. */
const wipeContent = (element: Element) => {
  const { templateChild } = getChildren(element);
  if (templateChild) {
    // Keep the source <template>; drop siblings (elements + text).
    replaceNonTemplateChildren(element, []);
  } else {
    element.textContent = "";
  }
  syncTextControl(element, "");
};

export const resolveExpression = ({
  element,
  options,
  value,
  key,
}: ContextField) => {
  if (!value) return undefined;
  try {
    const ast = getExpressionAst(value);
    // names resolve lazily as the evaluator reaches them
    const scope = createScope({ element, options });
    return evaluateExpression(ast, { scope, element });
  } catch (error) {
    QuarkLogger.error({
      method: "resolveExpression",
      message: "Could not resolve expression",
      element,
      script: value,
      error: [error],
    });
    const err = error as { message?: string; name?: string } | null;
    publicize(["quark", "error"], {
      weakElement: new WeakRef(element),
      tag: element.localName,
      selector: options.rule?.selector ?? null,
      ruleId: options.rule?.id ?? null,
      sheetId: options.rule?.quarkInstance.id ?? null,
      runId: options.runId ?? null,
      key,
      expression: value,
      errorMessage: err?.message ? String(err.message) : String(error),
      errorName: err?.name ? String(err.name) : undefined,
    });
    // failed evaluations never destroy state, they no-op
    return SYMBOL_NOOP;
  }
};

/** Bare-flag `@on` options, resolved once per match. */
const LISTENER_FLAGS: Record<string, keyof ResolvedListenerOptions> = {
  once: "once",
  self: "self",
  passive: "passive",
  capture: "capture",
  "prevent-default": "preventDefault",
  "stop-propagation": "stopPropagation",
  "stop-immediate-propagation": "stopImmediatePropagation",
};

const warnOption = (args: ContextField, message: string) =>
  QuarkLogger.warn({
    method: "listener",
    message: `Quark: ${args.key} — ${message}`,
    element: args.element,
  });

/**
 * Split an `@on` options group for one matched element: flags and the
 * `host` word resolve now (they configure the registration or act on the
 * event); `target` / `key` / `debounce` / `throttle` / `handle` are kept
 * as sources and evaluated by the wrapper when the event fires. Unknown
 * options warn and are ignored.
 */
export const resolveListenerOptions = (
  args: ContextField,
  sources: ListenerOptionSource[]
): { opts: ResolvedListenerOptions; dynamic: ListenerOptionSource[] } => {
  const opts: ResolvedListenerOptions = {};
  let dynamic: ListenerOptionSource[] = [];
  for (const source of sources) {
    const { name, text, ident } = source;
    if (name in LISTENER_FLAGS) {
      if (text !== null) warnOption(args, `option "${name}" takes no value`);
      opts[LISTENER_FLAGS[name]] = true as never;
    } else if ((DYNAMIC_LISTENER_OPTIONS as readonly string[]).includes(name)) {
      dynamic.push(source);
    } else if (name === "host") {
      if (ident === "window" || ident === "document") {
        opts.host = ident;
      } else {
        warnOption(args, `option "host" must be window or document`);
      }
    } else {
      warnOption(args, `unknown option "${name}"`);
    }
  }
  if (
    dynamic.some((o) => o.name === "debounce") &&
    dynamic.some((o) => o.name === "throttle")
  ) {
    warnOption(args, "debounce and throttle are exclusive; using debounce");
    dynamic = dynamic.filter((o) => o.name !== "throttle");
  }
  return { opts, dynamic };
};

/** `@view-transition` options after evaluation (see `resolveTransitionOptions`). */
export interface ResolvedTransitionOptions {
  types: string[];
  timeout?: number;
  delay?: number;
  firstRender?: boolean;
  ifActive?: "skip" | "replace";
  until?: { selector: string } | { thenable: PromiseLike<unknown> };
}

/** `"a b"` / `("a", "b c")` → `["a", "b", "c"]`; `undefined` when not strings. */
const typeNames = (value: unknown): string[] | undefined => {
  const items = Array.isArray(value) ? value.flat(Infinity) : [value];
  if (!items.every((item) => typeof item === "string")) return undefined;
  return (items as string[]).flatMap((item) =>
    item.split(/\s+/).filter(Boolean)
  );
};

/** Settle cap of a block's `update`: longer when it waits on `until`. */
export const DEFAULT_TRANSITION_TIMEOUT = 300;
export const DEFAULT_UNTIL_TIMEOUT = 1000;

/**
 * Evaluate a `@view-transition` options group for one resolve, in the
 * scope of the block's element (`args.element` is the owner, see
 * `paintTransition`). `types` → names; `timeout` / `delay` →
 * milliseconds; `first-render` flag; `if-active` → the bare word `skip` /
 * `replace`; `until` → a selector string or a thenable. `scope` is
 * reserved. Unknown or malformed options warn once per block and are
 * ignored.
 */
export const resolveTransitionOptions = (
  args: ContextField,
  spec: TransitionSpec
): ResolvedTransitionOptions => {
  const opts: ResolvedTransitionOptions = { types: [] };
  const warn = (name: string, message: string) => {
    if (spec.warned.has(name)) return;
    spec.warned.add(name);
    QuarkLogger.warn({
      method: "viewTransition",
      message: `Quark: ${spec.source} — ${message}`,
      element: args.element,
    });
  };
  const evaluate = (text: string | null) =>
    text === null
      ? undefined
      : resolveExpression({
          ...args,
          key: `${spec.source} option`,
          value: text,
        });
  for (const { name, text, ident } of spec.optionSources) {
    if (name === "types") {
      const types = typeNames(evaluate(text));
      if (types) opts.types = types;
      else warn(name, `option "types" needs strings`);
    } else if (name === "timeout" || name === "delay") {
      const value = evaluate(text);
      const ms = typeof value === "string" ? parseFloat(value) : value;
      if (typeof ms === "number" && ms > 0) opts[name] = ms;
      else
        warn(name, `option "${name}" needs a positive number of milliseconds`);
    } else if (name === "first-render") {
      if (text !== null) warn(name, `option "first-render" takes no value`);
      opts.firstRender = true;
    } else if (name === "if-active") {
      if (ident === "skip" || ident === "replace") opts.ifActive = ident;
      else warn(name, `option "if-active" must be skip or replace`);
    } else if (name === "until") {
      const value = evaluate(text);
      if (typeof value === "string" && value.trim()) {
        if (tc(() => args.element.matches(value)) === undefined) {
          warn(name, `until: "${value}" is not a valid selector`);
        } else {
          opts.until = { selector: value };
        }
      } else if (isThenable(value)) {
        opts.until = { thenable: value };
      } else if (value != null && !isNoop(value)) {
        warn(name, `option "until" needs a selector or a promise`);
      }
    } else if (name === "scope") {
      warn(name, `option "scope" is not supported yet`);
    } else {
      warn(name, `unknown option "${name}"`);
    }
  }
  return opts;
};

/**
 * The block's element: what the rule it is written in matches (an
 * ancestor-or-self of the painted element), or the host for a sheet-level
 * or `:scope` block. Options are evaluated on it and `until: "<selector>"`
 * is checked on it.
 */
const transitionOwner = (
  element: HTMLElement,
  spec: TransitionSpec,
  host: HTMLElement | undefined
): Element | null => {
  const owner = spec.ownerRule;
  if (!owner || !owner.matchSelector) return host ?? null;
  const selector = owner.isScoped
    ? owner.scopedSelector()
    : owner.matchSelector;
  return tc(() => element.closest(selector)) ?? null;
};

/**
 * How this resolve's paints commit when the declaration sits inside a
 * `@view-transition` block; `undefined` otherwise, and during the sheet's
 * first render unless the block says `first-render`.
 */
const paintTransition = (args: ContextField): PaintTransition | undefined => {
  const property = args.options.property;
  const spec = property?.transition;
  if (!spec) return undefined;
  const sheet = property.parent.quarkInstance;
  // the first render costs nothing unless the block animates it
  if ((args.options.isFirstRun || sheet.isFirstRender) && !spec.firstRender) {
    return undefined;
  }
  // options belong to the block: `attr()` / `prop()` / `item` read its element
  const owner = spec.optionSources.length
    ? ((transitionOwner(args.element, spec, sheet.host?.deref()) ??
        args.element) as typeof args.element)
    : args.element;
  const opts: ResolvedTransitionOptions = spec.optionSources.length
    ? resolveTransitionOptions({ ...args, element: owner }, spec)
    : { types: [] };
  const until: SettleUntil | undefined =
    opts.until && "selector" in opts.until
      ? { selector: opts.until.selector, owner: new WeakRef(owner) }
      : opts.until;
  return {
    types: opts.types,
    timeout:
      opts.timeout ??
      (until ? DEFAULT_UNTIL_TIMEOUT : DEFAULT_TRANSITION_TIMEOUT),
    delay: opts.delay,
    ifActive: opts.ifActive ?? "skip",
    until,
    source: spec.source,
  };
};

/** Paint extras for a flagged declaration, with its commit-time change check. */
const withTransition = (
  transition: PaintTransition | undefined,
  willChange: () => boolean
): Pick<PaintEntry, "transition" | "willChange"> | undefined =>
  transition && { transition, willChange };

/** Would `QuarkInternal.setAttr(name, value)` change what is rendered? */
const attrWillChange = (
  element: Element,
  name: string,
  value: unknown
): boolean => {
  if (value === undefined) return false;
  const next = typeof value === "boolean" ? (value ? "" : null) : value;
  if (isFormControlAttribute(element, name)) {
    // the live property may have drifted from the attribute (form-controls.ts)
    const control = element as HTMLInputElement & Record<string, unknown>;
    const drifted =
      name === "value"
        ? control.value !== (next === null ? "" : String(next))
        : control[name] !== (next !== null);
    if (drifted) return true;
  }
  return next === null
    ? element.hasAttribute(name)
    : element.getAttribute(name) !== String(next);
};

/** Would replacing `element`'s non-template children with `nodes` change them? */
const childrenWillChange = (element: Element, nodes: Node[]): boolean => {
  const { otherChildren } = getChildren(element);
  return (
    otherChildren.length !== nodes.length ||
    nodes.some((node, index) => otherChildren[index] !== node)
  );
};

/** Would `wipeContent(element)` change it? */
const wipeWillChange = (element: Element): boolean =>
  getChildren(element).templateChild
    ? getChildren(element).otherChildren.length > 0
    : element.firstChild !== null;

/** Would `paintText(target, text)` change it? */
const textWillChange = (target: Node, text: string): boolean => {
  const first = target.firstChild;
  return !(first === null ? text === "" : isSoleText(first, text));
};

export const resolveField = (args: ContextField) => {
  let key: string;
  if (args.listener) {
    key = "listener";
  } else if (args.key.startsWith("$")) {
    key = "variable";
  } else if (args.key.startsWith("--")) {
    key = "styleProperty";
  } else if (args.key in FIELD_RESOLVERS) {
    key = args.key;
  } else {
    key = "attribute";
  }
  const result = FIELD_RESOLVERS[key](args);
  publishApply(args, key, result);
  return result;
};

/**
 * DevTools: one publication per property resolve, Quark's version of a
 * Neutron `effect`. Fires at resolve time (before the batched paint),
 * same moment Neutron publishes before running an effect. No-op without
 * a hook.
 *
 * Published as the author meant: render descriptors (`{ type: "nodes" |
 * "html", value }` from `template()` / `iterate()` / `dangerous-html()`)
 * unwrap to `value`, fragments / NodeLists expand to nodes, promises
 * publish once settled, never as `Promise`.
 */
const publishApply = (
  { element, key, value, options }: ContextField,
  kind: string,
  result: unknown
) => {
  if (!getDevtoolsHook()?.publicize) return;
  const rule = options.rule;
  const emit = (resolved: unknown, noop: boolean) =>
    publicize(["quark", "apply"], {
      weakElement: new WeakRef(element),
      tag: element.localName,
      selector: rule?.selector ?? null,
      ruleId: rule?.id ?? null,
      sheetId: rule?.quarkInstance.id ?? null,
      runId: options.runId ?? null,
      kind,
      key,
      expression: value,
      result: noop ? undefined : presentResult(resolved),
      isNoop: noop,
      isWipe: !noop && isWipe(resolved),
      isFirstRun: !!options.isFirstRun,
    });
  if (isNoop(result)) return emit(result, true);
  if (isThenable(result)) {
    result.then(
      (settled) => emit(settled, isNoop(settled)),
      () => emit(undefined, false)
    );
    return;
  }
  emit(result, false);
};

/**
 * Report a `@warn` / `@debug` / `@error` statement: the console at the
 * matching logger level (`@debug` is silent below debug level), and the
 * DevTools hook as `quark/diagnostic` with the values presented the way
 * `quark/apply` presents results.
 */
export const reportDiagnostic = (
  { element, key, value, options }: ContextField,
  level: DiagnosticLevel,
  values: unknown[]
) => {
  const rule = options.rule;
  const text = values
    .map((v) => (typeof v === "string" ? v : presentResult(v)))
    .map((v) =>
      typeof v === "string"
        ? v
        : v instanceof Node
          ? `<${v.nodeName.toLowerCase()}>`
          : (JSON.stringify(v) ?? String(v))
    )
    .join(" ");
  QuarkLogger[level]({
    method: key,
    message: `Quark ${key} (${rule?.selector ?? "?"}): ${text}`,
    element,
    values,
  });
  publicize(["quark", "diagnostic"], {
    weakElement: new WeakRef(element),
    tag: element.localName,
    selector: rule?.selector ?? null,
    ruleId: rule?.id ?? null,
    sheetId: rule?.quarkInstance.id ?? null,
    runId: options.runId ?? null,
    level,
    key,
    expression: value,
    values: values.map(presentResult),
    message: text,
  });
};

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value &&
  typeof value === "object" &&
  typeof (value as PromiseLike<unknown>).then === "function";

/** The value an author intended, stripped of Quark's render plumbing. */
const presentResult = (result: unknown): unknown => {
  if (typeof NodeList !== "undefined" && result instanceof NodeList) {
    return Array.from(result).map(presentResult);
  }
  if (
    typeof DocumentFragment !== "undefined" &&
    result instanceof DocumentFragment
  ) {
    return Array.from(result.childNodes)
      .filter((n) => n.nodeType !== Node.TEXT_NODE || n.textContent?.trim())
      .map(presentResult);
  }
  if (Array.isArray(result)) return result.map(presentResult);
  if (
    result &&
    typeof result === "object" &&
    "value" in result &&
    ((result as ExpressionResult)?.type === "nodes" ||
      (result as ExpressionResult)?.type === "html")
  ) {
    return presentResult((result as { value: unknown }).value);
  }
  return result;
};

export const FIELD_RESOLVERS = {
  // Listeners and variables set sync
  listener: (args: ContextField) => {
    const { element, hash } = args;
    const { eventTypes, slot, block, optionSources } = args.listener!;
    const listener = args.options.property as Listener;
    const ruleId = args.options.rule!.id;
    const elementInternal = getQuarkInternal(element);
    let fns: Array<(e: Event) => unknown>;
    let target: EventTarget = element;
    const addOptions: AddEventListenerOptions = {};
    if (listener.hasOptions) {
      const { opts, dynamic } = resolveListenerOptions(args, optionSources);
      // one wrapper carries filters, flags, timing, `once`, `handle` and the block
      fns = [
        listener.wrapper(element, {
          opts,
          dynamic,
          options: args.options,
          hash,
          ruleId,
          internal: elementInternal,
        }),
      ];
      target = listenerHost(element, opts.host);
      if (opts.capture) addOptions.capture = true;
      if (opts.passive) addOptions.passive = true;
    } else {
      // `@on … { }` without options: the block listener, registered directly
      fns = block ? [listener.blockListener(element, args.options)] : [];
    }
    elementInternal.setOrderedListeners(hash, ruleId, slot, fns, {
      eventTypes,
      target,
      options: addOptions,
    });
    return fns;
  },
  variable: (args: ContextField) => {
    const result = resolveExpression(args);
    return result;
  },
  // all attrs and content set async in schedulePaint()
  dataset: (args: ContextField) => {
    const { element, hash } = args;
    const elementInternal = getQuarkInternal(element);
    const resolved = resolveExpression(args);
    if (isNoop(resolved)) {
      return resolved;
    }
    // wipe values (and other falsy) clear prior data-* attrs
    const result = objToAttrs((isWipe(resolved) ? {} : resolved) || {}, {
      prefix: "data-",
      convertNonPrimitives: true,
      preserveKey: false,
    });
    const entries = () =>
      prefixedAttrEntries(elementInternal, hash, "data-", result);
    schedulePaint(
      () => {
        entries().forEach(([k, val]) => {
          elementInternal.setAttr(hash, k, val);
        });
      },
      1,
      withTransition(paintTransition(args), () =>
        entries().some(([k, val]) => attrWillChange(element, k, val))
      )
    );
    return result;
  },
  ariaset: (args: ContextField) => {
    const { element, hash } = args;
    const elementInternal = getQuarkInternal(element);
    const resolved = resolveExpression(args);
    if (isNoop(resolved)) {
      return resolved;
    }
    const result = objToAttrs((isWipe(resolved) ? {} : resolved) || {}, {
      prefix: "aria-",
      convertNonPrimitives: true,
      preserveKey: false,
    });
    const entries = () =>
      prefixedAttrEntries(elementInternal, hash, "aria-", result);
    schedulePaint(
      () => {
        entries().forEach(([k, val]) => {
          elementInternal.setAttr(hash, k, val);
        });
      },
      1,
      withTransition(paintTransition(args), () =>
        entries().some(([k, val]) => attrWillChange(element, k, val))
      )
    );
    return result;
  },
  class: (args: ContextField) => {
    const { element, hash, key } = args;
    const elementInternal = getQuarkInternal(element);
    const result = resolveExpression(args);
    if (isNoop(result)) {
      return result;
    }
    // a string, a list (joined) or a wipe is one attribute write; a map
    // toggles single classes (read at commit time: class changes are
    // observed, so only real flips may write, as one causal hop)
    const value = Array.isArray(result)
      ? result.join(" ")
      : isWipe(result)
        ? null
        : typeof result === "string"
          ? result
          : undefined;
    const flips = (): [string, unknown][] =>
      isPojo(result)
        ? Object.entries(result).filter(
            ([k, v]) => element.classList.contains(k) !== !!v
          )
        : [];
    schedulePaint(
      () => {
        if (value !== undefined) {
          elementInternal.setAttr(hash, key, value);
          return;
        }
        const toggles = flips();
        if (toggles.length) {
          LoopGuard.write(element, key, () =>
            toggles.forEach(([k, v]) => element.classList.toggle(k, !!v))
          );
        }
      },
      1,
      withTransition(paintTransition(args), () =>
        value !== undefined
          ? attrWillChange(element, key, value)
          : flips().length > 0
      )
    );
    return result;
  },
  /*
   * CSS custom properties (`--x:`). Inline-style writes so stylesheets
   * can consume Quark state via `var()` (colors, progress, theming).
   * Values are Quark expressions, not CSS value grammar: quote literals
   * (`"red !important"`, `"#ccc"`). A trailing `!important` in the
   * string maps to the priority arg. Wipe removes the property. Quark
   * never reads CSS variables back.
   */
  styleProperty: (args: ContextField) => {
    const { element, hash, key } = args;
    const elementInternal = getQuarkInternal(element);
    const resolved = resolveExpression(args);
    if (isNoop(resolved)) {
      return resolved;
    }
    const wiped = isWipe(resolved);
    if (
      !wiped &&
      typeof resolved !== "string" &&
      typeof resolved !== "number"
    ) {
      QuarkLogger.error({
        method: "styleProperty",
        message: `Quark: "${key}" must resolve to a string — quote CSS values (e.g. "#ccc")`,
        element,
        script: args.value,
      });
      return SYMBOL_NOOP;
    }
    const value = wiped ? null : String(resolved);
    schedulePaint(
      () => {
        elementInternal.setStyleProperty(hash, key, value);
      },
      1,
      withTransition(paintTransition(args), () => {
        const style = element.style;
        if (value === null) return style.getPropertyValue(key) !== "";
        const important = IMPORTANT.test(value);
        return (
          style.getPropertyValue(key).trim() !==
            value.replace(IMPORTANT, "").trim() ||
          style.getPropertyPriority(key) !== (important ? "important" : "")
        );
      })
    );
    return resolved;
  },
  attribute: (args: ContextField) => {
    const { element, hash, key } = args;
    const elementInternal = getQuarkInternal(element);
    const result = resolveExpression(args);
    if (isNoop(result)) {
      return result;
    }
    const value = isWipe(result) ? null : result;
    schedulePaint(
      () => {
        elementInternal.setAttr(hash, key, value);
      },
      1,
      withTransition(paintTransition(args), () =>
        attrWillChange(element, key, value)
      )
    );
    return result;
  },
  content: (args: ContextField) => {
    const { element, hash, value } = args;
    const elementInternal = getQuarkInternal(element);
    const result = resolveExpression(args);
    // `preserve` leaves rendered content alone; wipe values clear it
    if (isNoop(result)) {
      return result;
    }
    // `@view-transition`: evaluated now, in this run's scope, for any branch
    const transition = paintTransition(args);
    if (isWipe(result)) {
      elementInternal.setContentAttr(hash);
      schedulePaint(
        () => {
          wipeContent(element);
        },
        0,
        withTransition(transition, () => wipeWillChange(element))
      );
      return result;
    }
    // a template's fragment is outside the observed tree and its nodes are
    // never connected, so paints into it must not requeue rules either
    const willRenderIntoTemplate = element instanceof HTMLTemplateElement;
    const textTarget = willRenderIntoTemplate ? element.content : element;
    if (typeof result === "object") {
      /*
       * Mark content applied before any async work so parallel
       * calls still collapse to one render.
       */
      elementInternal.setContentAttr(hash);
      // a settle wait (view transitions, `Quark.whenSettled`) covers the
      // paint this promise will schedule
      if (isThenable(result)) trackPending(result, element);
      new Queue()
        .settle(result)
        /*
         * If this settles sync, dependents see the new value. If async,
         * a dependent with a sync dep that changed at the same time
         * renders once with stale / undefined, then again when this
         * resolves. Fix would be: dependents check `item` / `index` for
         * a pending async op and wait.
         */
        .onResolved((state) => {
          const res = state.value as ExpressionResult | Node;
          // iterate() / template() / dangerous-html() settle to
          // {type, value, after?}, or a wipe / no-op value
          if (isNoop(res)) return;
          if (isWipe(res)) {
            schedulePaint(
              () => {
                wipeContent(element);
              },
              0,
              withTransition(transition, () => wipeWillChange(element))
            );
            return;
          }
          if (res instanceof Node || res instanceof NodeList) {
            // inserted elements reach rules through the childList observer;
            // a NodeList may be live, so read it at commit time
            const nodes = () => (res instanceof Node ? [res] : Array.from(res));
            schedulePaint(
              () => {
                replaceNonTemplateChildren(element, nodes());
              },
              0,
              withTransition(transition, () =>
                childrenWillChange(element, nodes())
              )
            );
          } else if (res?.type === "nodes") {
            const nodeArray = res.value;
            schedulePaint(
              () => {
                replaceNonTemplateChildren(element, nodeArray);
                if (nodeArray.length && !willRenderIntoTemplate) {
                  res?.after?.();
                }
              },
              0,
              withTransition(transition, () =>
                childrenWillChange(element, nodeArray)
              )
            );
          } else if (res?.type === "html") {
            schedulePaint(
              () => {
                // element insertions are one causal hop (see LoopGuard)
                LoopGuard.write(element, "content", () => {
                  element.innerHTML = res.value as string;
                  if (!willRenderIntoTemplate) {
                    res?.after?.();
                  }
                });
              },
              0,
              withTransition(
                transition,
                () => element.innerHTML !== (res.value as string)
              )
            );
          } else {
            const text = res + "";
            schedulePaint(
              () => {
                /*
                 * `textContent` / `innerText` do not write a template's
                 * document fragment (unlike `innerHTML`), so templates go
                 * through `.content`.
                 */
                paintText(textTarget, text);
              },
              0,
              withTransition(transition, () => textWillChange(textTarget, text))
            );
          }
        })
        .onRejected((state) => {
          QuarkLogger.error({
            method: "content",
            message: "Could not render content",
            element,
            expression: value,
            value: [state.value],
          });
        });
    } else {
      // record that content was applied so re-run gating (propertyIsNew /
      // nearness) works for plain string results too
      elementInternal.setContentAttr(hash);
      const text = result + "";
      schedulePaint(
        () => {
          paintText(textTarget, text);
        },
        0,
        withTransition(transition, () => textWillChange(textTarget, text))
      );
    }
    return result;
  },
};

const IMPORTANT = /\s*!important\s*$/i;

/**
 * The attribute writes of a `dataset` / `ariaset` paint: every prefixed
 * attribute this sheet set before is removed unless the new object sets
 * it again. Read at commit time.
 */
const prefixedAttrEntries = (
  elementInternal: ReturnType<typeof getQuarkInternal>,
  hash: string,
  prefix: string,
  result: Record<string, unknown>
): [string, unknown][] =>
  Object.entries({
    ...Object.fromEntries(
      Object.keys(elementInternal.getAllAttrs(hash))
        .map((k) => k.startsWith(prefix) && [k, null])
        .filter(Boolean) as [string, null][]
    ),
    ...result,
  });
