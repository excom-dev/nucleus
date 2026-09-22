export type * from "./types";
import type { DiagnosticLevel } from "./ast";
import { type ListenerOptionSource, listenerOptionsText } from "./ast";
import { writeBinding } from "./bindings";
import { ATTRIBUTE_BLACKLIST_REGEXES, isNoop } from "./constants";
import { publicize } from "./devtools-hook";
import {
  collectAttrCalls,
  collectPropCalls,
  collectVariableNames,
  getExpressionAst,
} from "./evaluator";
import { getQuarkInternal, TQuarkElement } from "./quark-internal";
import { reportDiagnostic, resolveExpression, resolveField } from "./resolvers";
import type { Rule } from "./rule";
import type { QuarkOptions, TransitionSpec } from "./types";
import { deref, QuarkLogger } from "./utils";
import { LoopGuard, tc } from "@excom/kit-utils";
import type { Expression } from "@excom/quark-parser";

/** How `QuarkInternal.propertyHasBeenSet` tells a property's kind apart. */
export type PropertyKind =
  | "variable"
  | "attribute"
  | "listener"
  | "diagnostic"
  | "delay";

export class Property {
  key: string;
  value: string;
  parsedValue: Expression | null;
  /** `$name`s referenced by the expression (static analysis). */
  referencedVarNames: string[] = [];
  /** Literal `attr("x")` names referenced by the expression (static analysis). */
  referencedAttrNames: string[] = [];
  /**
   * Literal `prop("x")` names in the expression. Subscribed on the
   * matched element at first read (`props.ts`); change events re-run
   * this property via the sheet's `propIndex`.
   */
  referencedPropNames: string[] = [];
  parent: Rule;
  /**
   * Resolves from bindings ($vars) or `prop()`, so it re-runs on change
   * events, not sync DOM runs. Reactivity is in the AST; no cross-sheet
   * analysis needed.
   */
  isReactive: boolean;
  /**
   * The `@view-transition` block this write sits in, if any: its paints
   * commit inside a view transition (see `paint.ts`).
   */
  transition: TransitionSpec | null;
  constructor({
    key,
    value,
    parent,
    transition = null,
  }: {
    key: string;
    value: string;
    parent: Rule;
    transition?: TransitionSpec | null;
  }) {
    this.key = key;
    this.value = value;
    this.parent = parent;
    this.transition = transition;
    if (transition) parent.quarkInstance.hasTransitions = true;
    try {
      // an `@on` block without prelude handlers has nothing to evaluate
      this.parsedValue = value ? getExpressionAst(value) : null;
      this.referencedVarNames = this.parsedValue
        ? collectVariableNames(this.parsedValue)
        : [];
      const attrCalls = collectAttrCalls(this.parsedValue);
      this.referencedAttrNames = attrCalls.names.filter(
        (name) => !ATTRIBUTE_BLACKLIST_REGEXES.some((regex) => regex.test(name))
      );
      this.referencedAttrNames.forEach((name) =>
        this.parent.observedAttrs.add(name)
      );
      if (attrCalls.hasNonLiteral) {
        QuarkLogger.warn({
          method: "property",
          message: `Quark: attr() only observes static string names; "${key}: ${value}" will not re-run when a dynamic name changes`,
          script: value,
        });
      }
      const propCalls = collectPropCalls(this.parsedValue);
      this.referencedPropNames = propCalls.names;
      if (propCalls.hasNonLiteral) {
        QuarkLogger.warn({
          method: "property",
          message: `Quark: prop() only observes static string names; "${key}: ${value}" will not re-run when a dynamic name changes`,
          script: value,
        });
      }
    } catch (error) {
      this.parsedValue = null;
      QuarkLogger.error({
        method: "property",
        message: `Quark: Invalid expression for "${key}"`,
        script: value,
        error: [error],
      });
    }
    this.isReactive =
      this.referencedVarNames.length > 0 || this.referencedPropNames.length > 0;
  }

  /**
   * The storage kind `propertyHasBeenSet` checks. Diagnostics and delays
   * record nothing on the element, so they count as new on every
   * application (they gate themselves).
   */
  kind(): PropertyKind {
    return this instanceof Variable
      ? "variable"
      : this instanceof Attribute
        ? "attribute"
        : "listener";
  }

  run(element: HTMLElement, options: QuarkOptions): void {
    const elementInternal = getQuarkInternal(element);
    const propertyIsNew = !elementInternal.propertyHasBeenSet(
      this.parent.quarkInstance.hash,
      this.parent.id,
      this.kind(),
      this.key,
      this.value
    );
    /*
     * Nearness: skip an event re-run when the changed owner is farther
     * up than the owner this element last read. The nearer one shadows.
     */
    const { changedBinding } = options;
    if (
      !propertyIsNew &&
      changedBinding &&
      this.referencedVarNames.includes(changedBinding.name)
    ) {
      const known = elementInternal.varOwners[changedBinding.name]?.deref();
      const origin = deref(changedBinding.origin);
      if (known && origin && origin !== known && origin.contains(known)) {
        return;
      }
    }
    /*
     * Deferred fan-out: this sheet wrote during the run and this
     * property already ran on this element after it (new value). Nothing
     * to refresh.
     */
    if (changedBinding?.trace) {
      const ranAt = changedBinding.trace.ran.get(element)?.get(this);
      if (ranAt !== undefined && ranAt > (changedBinding.sinceSeq ?? -1)) {
        return;
      }
    }
    const trace = this.parent.quarkInstance.runTrace;
    if (trace) recordSeq(trace.visited, element, this, ++trace.seq);
    const shouldRun =
      propertyIsNew ||
      (options.isAsyncRun
        ? this.isReactive
        : !this.isReactive ||
          // a binding this reads was written earlier in this run: refresh
          // inline instead of through the deferred change event
          (!!trace &&
            this.referencedVarNames.some((name) => trace.written.has(name))));
    if (shouldRun) {
      if (trace) recordSeq(trace.ran, element, this, trace.seq);
      this._run(element as TQuarkElement, options);
    }
  }
  _run(element: TQuarkElement, options: QuarkOptions) {
    return resolveField({
      element,
      key: this.key,
      value: this.value,
      options: { ...options, rule: this.parent, property: this },
      hash: this.parent.quarkInstance.hash,
    });
  }
}

/** Store `seq` for (element, property) in a run-trace map. */
export const recordSeq = (
  map: Map<Element, Map<Variable | Attribute | Listener, number>>,
  element: Element,
  property: Variable | Attribute | Listener,
  seq: number
) => {
  let byProperty = map.get(element);
  if (!byProperty) map.set(element, (byProperty = new Map()));
  byProperty.set(property, seq);
};

export class Variable extends Property {
  _run(element: TQuarkElement, options: QuarkOptions) {
    const resolved = super._run(element, options);
    // `preserve` leaves the existing binding untouched
    if (isNoop(resolved)) return false;
    /*
     * Bindings live on the element (`_q_.vars`), shared across sheets
     * like CSS custom properties. `unset` deletes; a real change fires
     * bubbling `quark-binding-change`, which drives re-runs.
     */
    const sheet = this.parent.quarkInstance;
    return writeBinding(
      element,
      this.key,
      resolved,
      {
        sheetId: sheet.id,
        runId: options.runId,
        isFirstRun: options.isFirstRun,
      },
      // mid-run writes are announced once the run completes
      sheet.runTrace ? sheet.queueBindingChange : undefined
    );
  }
}

export class Attribute extends Property {}

/**
 * `--custom-prop: expr` writes a CSS custom property on matched elements
 * (see the `styleProperty` resolver). Values are Quark expressions, not
 * CSS value grammar: quote CSS literals. Enforced here for the two
 * shapes that would silently become strings (`#ccc` colors, `10px` unit
 * numbers). Bare ids and space lists (`red`, `1px solid red`) already
 * fail at eval.
 */
export class StyleProperty extends Attribute {
  private isValidValue: boolean;
  constructor(args: ConstructorParameters<typeof Property>[0]) {
    super(args);
    const node = this.parsedValue as { type?: string; unit?: string } | null;
    this.isValidValue = !(
      node &&
      (node.type === "color" || (node.type === "number" && node.unit))
    );
    if (!this.isValidValue) {
      QuarkLogger.error({
        method: "styleProperty",
        message: `Quark: CSS literal values must be quoted — write ${this.key}: "${this.value}" (strings / expressions only)`,
      });
    }
  }
  _run(element: TQuarkElement, options: QuarkOptions) {
    if (!this.isValidValue) return false;
    return super._run(element, options);
  }
}

/**
 * `@warn` / `@debug` / `@error` statements: evaluate their value on the
 * matched element and report it (console at that logger level, DevTools
 * as `quark/diagnostic`). `@warn` and `@error` speak once per element and
 * rule — a warning repeated on every re-run is noise; `@debug` speaks on
 * every application, so it re-logs when a binding or `prop()` it reads
 * changes. A top-level comma list (`@debug "size", attr("width")`)
 * reports one value per item.
 */
export class Diagnostic extends Property {
  level: DiagnosticLevel;
  /** Elements already warned about (not kept for `@debug`). */
  private spoken = new WeakSet<Element>();
  constructor({
    level,
    value,
    parent,
    transition = null,
  }: {
    level: DiagnosticLevel;
    value: string;
    parent: Rule;
    transition?: TransitionSpec | null;
  }) {
    super({ key: `@${level}`, value, parent, transition });
    this.level = level;
  }
  kind(): PropertyKind {
    return "diagnostic";
  }
  _run(element: TQuarkElement, options: QuarkOptions) {
    if (this.level !== "debug") {
      if (this.spoken.has(element)) return false;
      this.spoken.add(element);
    }
    const args = {
      element,
      key: this.key,
      value: this.value,
      options: { ...options, rule: this.parent, property: this },
      hash: this.parent.quarkInstance.hash,
    };
    const resolved = resolveExpression(args);
    // a failed expression already logged and published an error
    if (isNoop(resolved)) return false;
    const node = this.parsedValue as {
      type?: string;
      separator?: string;
    } | null;
    const values =
      node?.type === "list" && node.separator === "," && Array.isArray(resolved)
        ? resolved
        : [resolved];
    reportDiagnostic(args, this.level, values);
    return true;
  }
}

/**
 * `@delay <ms> { … }`: applies its block to the matched element once the
 * duration elapses, provided the element is still in the document, the
 * sheet is still registered and the rule still matches. Applying the rule
 * again restarts the timer (one per element). The block runs like an
 * `@on` block — a one-shot, with `event` / `target` kept when scheduled
 * from one — inside the loop-guard depth of the run that scheduled it, so
 * two delays cannot bounce forever. The sheet clears pending timers on
 * unregister.
 */
export class Delay extends Property {
  block: Rule;
  private timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  constructor({
    value,
    parent,
    transition = null,
    block,
  }: {
    value: string;
    parent: Rule;
    transition?: TransitionSpec | null;
    block: Rule;
  }) {
    super({ key: "@delay", value, parent, transition });
    this.block = block;
  }
  kind(): PropertyKind {
    return "delay";
  }
  /** Drop the pending timer for `element`, if any. */
  cancel(element: Element) {
    const timer = this.timers.get(element);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(element);
    this.parent.quarkInstance.delayTimers.delete(timer);
  }
  _run(element: TQuarkElement, options: QuarkOptions) {
    const sheet = this.parent.quarkInstance;
    const resolved = resolveExpression({
      element,
      key: this.key,
      value: this.value,
      options: { ...options, rule: this.parent, property: this },
      hash: sheet.hash,
    });
    if (isNoop(resolved)) return false;
    const ms = typeof resolved === "string" ? parseFloat(resolved) : resolved;
    if (typeof ms !== "number" || !(ms >= 0)) {
      QuarkLogger.warn({
        method: "delay",
        message: `Quark: @delay ${this.value} needs a number of milliseconds (${this.parent.selector})`,
        element,
      });
      return false;
    }
    this.cancel(element);
    const publish = (phase: "scheduled" | "fired" | "dropped", extra = {}) =>
      publicize(["quark", "delay"], {
        weakElement: new WeakRef(element),
        tag: element.localName,
        selector: this.parent.selector,
        ruleId: this.parent.id,
        sheetId: sheet.id,
        runId: options.runId ?? null,
        expression: this.value,
        ms,
        phase,
        ...extra,
      });
    // the timer carries the causal depth of the run that scheduled it
    const depth = LoopGuard.current();
    const elRef = new WeakRef(element);
    const timer = setTimeout(() => {
      this.timers.delete(element);
      sheet.delayTimers.delete(timer);
      const el = elRef.deref();
      const host = sheet.host?.deref();
      const reason =
        !el || !el.isConnected
          ? "disconnected"
          : !sheet.isRegistered || !host
            ? "unregistered"
            : !stillMatches(this.parent, el, host)
              ? "unmatched"
              : null;
      if (reason) {
        publish("dropped", { reason });
        return;
      }
      publish("fired");
      LoopGuard.run(depth, () =>
        this.block.runEvent(
          el as HTMLElement,
          options.event,
          options,
          options.eventTarget ?? null
        )
      );
    }, ms);
    this.timers.set(element, timer);
    sheet.delayTimers.add(timer);
    publish("scheduled");
    return true;
  }
}

/** Whether `rule` (its host compound included) still matches `element`. */
const stillMatches = (
  rule: Rule,
  element: HTMLElement,
  host: HTMLElement
): boolean =>
  (rule.hostCompound === null || host.matches(rule.hostCompound)) &&
  rule.matchesElement(element, host);

/**
 * `@on` options that configure the registration or act on the event
 * itself, resolved once per match (bare flags and the `host` word; see
 * `resolveListenerOptions`). Everything else (`target`, `key`,
 * `debounce`, `throttle`, `handle`) is evaluated when the event fires.
 */
export interface ResolvedListenerOptions {
  self?: boolean;
  once?: boolean;
  passive?: boolean;
  capture?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  stopImmediatePropagation?: boolean;
  host?: "window" | "document";
}

/** Option names evaluated per event, in the block's scope. */
export const DYNAMIC_LISTENER_OPTIONS = [
  "target",
  "key",
  "debounce",
  "throttle",
  "handle",
] as const;
export type DynamicListenerOption = (typeof DYNAMIC_LISTENER_OPTIONS)[number];

/** What an option-aware listener needs at event time; refreshed per run. */
export interface ListenerState {
  opts: ResolvedListenerOptions;
  /** Per-event options as written (`target`, `key`, `debounce`, `throttle`, `handle`). */
  dynamic: ListenerOptionSource[];
  options: QuarkOptions;
  hash: string;
  ruleId: number;
  internal: ReturnType<typeof getQuarkInternal>;
  timer?: ReturnType<typeof setTimeout>;
  last?: number;
}

const KEY_MODIFIERS: Record<string, (e: KeyboardEvent) => boolean> = {
  shift: (e) => e.shiftKey,
  alt: (e) => e.altKey,
  ctrl: (e) => e.ctrlKey,
  control: (e) => e.ctrlKey,
  meta: (e) => e.metaKey,
  cmd: (e) => e.metaKey,
};

const modifierKeyName = (mod: string): string =>
  mod === "ctrl" || mod === "control"
    ? "control"
    : mod === "cmd"
      ? "meta"
      : mod;

/**
 * One chord token: `k`, `shift`, or `shift+k` / `k+shift`. Listed
 * modifiers must be held; a modifier-only token matches that key's
 * own keydown. Same rules as `event-handler`'s `keycode-filter`.
 */
const matchesKeyToken = (token: string, e: KeyboardEvent): boolean => {
  const parts = token.toLowerCase().split("+").filter(Boolean);
  if (!parts.length) return false;
  const mods = parts.filter((p) => p in KEY_MODIFIERS);
  const keys = parts.filter((p) => !(p in KEY_MODIFIERS));
  if (!mods.every((m) => KEY_MODIFIERS[m](e))) return false;
  const key = e.key?.toLowerCase();
  if (!key) return false;
  if (keys.length) return keys.every((k) => key === k);
  return mods.some((m) => key === modifierKeyName(m));
};

/** `key: "Escape Shift+K"`, space-separated alternatives, any may match. */
export const matchesKey = (filter: string, e: Event): boolean =>
  filter
    .split(/\s+/)
    .filter(Boolean)
    .some((token) => matchesKeyToken(token, e as KeyboardEvent));

/** The EventTarget an `@on (host: …)` listener registers on. */
export const listenerHost = (
  element: Element,
  host: ResolvedListenerOptions["host"]
): EventTarget =>
  host === "window"
    ? ((element.ownerDocument.defaultView as EventTarget) ?? window)
    : host === "document"
      ? element.ownerDocument
      : element;

/**
 * `@on <event>[, <event>] [(options)] { … }` / `@on <event> (options);`
 * attaches listeners on matched elements. `key` is the display form
 * (`@on click, submit (once, handle: save)`), unique per rule for one
 * event list + options group and used as the storage slot; the same
 * function is registered for every event type in the list.
 *
 * `block` is a rule from the block body (never run by sheet passes)
 * applied to the matched element once per event. Without options the
 * block listener is registered directly and created once per element
 * (`blockFns`) so rule re-runs keep the same registration.
 *
 * With options, one per-element `wrapper` applies the filters (`self`,
 * `target`, `key`), the event flags (`prevent-default`, …), timing
 * (`debounce` / `throttle`), `once`, then runs the `handle` functions
 * and the block. `target`, `key`, `debounce`, `throttle` and `handle` are
 * expressions evaluated when the event fires, in the block's scope
 * (`event`, `target`, `element`, current `$bindings`), so nothing about
 * the listener is reactive: a re-run only refreshes `ListenerState`,
 * never the DOM registration.
 */
export class Listener extends Property {
  eventTypes: string[];
  optionSources: ListenerOptionSource[];
  block: Rule | null;
  /** The `handle:` option as written, for DevTools (`""` when absent). */
  handleText: string;
  /** Per-element block listener, stable across rule re-runs. */
  private blockFns = new WeakMap<Element, (e: Event) => void>();
  /** Per-element option-aware wrapper + the state it reads at event time. */
  private wrappers = new WeakMap<
    Element,
    { fn: (e: Event) => void; state: ListenerState }
  >();
  /** Per-event option problems already reported, per element. */
  private warned = new WeakMap<Element, Set<string>>();
  constructor({
    eventTypes,
    eventsText,
    optionSources = [],
    parent,
    block = null,
    transition = null,
  }: {
    eventTypes: string[];
    /** Event list as written (`click, "my:evt"`), for the display key. */
    eventsText: string;
    optionSources?: ListenerOptionSource[];
    parent: Rule;
    block?: Rule | null;
    transition?: TransitionSpec | null;
  }) {
    super({
      key: `@on ${eventsText}${listenerOptionsText(optionSources)}`,
      value: "",
      parent,
      transition,
    });
    this.eventTypes = eventTypes;
    this.optionSources = optionSources;
    this.block = block;
    this.handleText =
      optionSources.find((o) => o.name === "handle")?.text ?? "";
  }
  get hasOptions(): boolean {
    return this.optionSources.length > 0;
  }
  /** The listener that applies this `@on` block to `element`. */
  blockListener(
    element: TQuarkElement,
    options: QuarkOptions
  ): (e: Event) => void {
    let fn = this.blockFns.get(element);
    if (!fn) {
      const block = this.block!;
      fn = (e: Event) => block.runEvent(element, e, options);
      this.blockFns.set(element, fn);
    }
    return fn;
  }
  private warnOnce(element: Element, topic: string, message: string) {
    let topics = this.warned.get(element);
    if (!topics) this.warned.set(element, (topics = new Set()));
    if (topics.has(topic)) return;
    topics.add(topic);
    QuarkLogger.warn({
      method: "listener",
      message: `Quark: ${this.key} — ${message}`,
      element,
    });
  }
  /**
   * Evaluate one per-event option in the block's scope: the event, the
   * delegate (once known) and the element's current bindings.
   */
  private evaluateOption(
    element: TQuarkElement,
    state: ListenerState,
    name: DynamicListenerOption,
    e: Event,
    delegate: Element | undefined
  ): unknown {
    const source = state.dynamic.find((o) => o.name === name);
    if (!source) return undefined;
    if (source.text === null) {
      this.warnOnce(element, name, `option "${name}" needs a value`);
      return undefined;
    }
    return resolveExpression({
      element,
      key: `${this.key} option`,
      value: source.text,
      options: {
        ...state.options,
        rule: this.parent,
        property: this,
        event: e,
        eventTarget: delegate ?? (e.target as Element | null) ?? null,
      },
      hash: state.hash,
    });
  }
  /** `debounce` / `throttle` as milliseconds, or `undefined` (warned once). */
  private evaluateMs(
    element: TQuarkElement,
    state: ListenerState,
    name: "debounce" | "throttle",
    e: Event,
    delegate: Element | undefined
  ): number | undefined {
    if (!state.dynamic.some((o) => o.name === name)) return undefined;
    const value = this.evaluateOption(element, state, name, e, delegate);
    if (isNoop(value)) return undefined;
    const ms = typeof value === "string" ? parseFloat(value) : value;
    if (typeof ms !== "number" || !(ms > 0)) {
      this.warnOnce(
        element,
        name,
        `option "${name}" needs a positive number of milliseconds`
      );
      return undefined;
    }
    return ms;
  }
  /** Call the `handle:` result(s) with the event; `this` is the element. */
  private callHandlers(element: TQuarkElement, value: unknown, e: Event) {
    if (value === undefined || value === null || isNoop(value)) return;
    const handlers = Array.isArray(value) ? value.flat(Infinity) : [value];
    for (const handler of handlers) {
      if (typeof handler === "function") {
        handler.call(element, e);
      } else if (typeof handler === "string") {
        this.warnOnce(
          element,
          "handle",
          `handle: "${handler}" is a string — write the bare name of a function`
        );
      }
    }
  }
  /**
   * The one function registered for an `@on` with options. Created once
   * per element; `state` is replaced each run so the wrapper always
   * sees the latest flags, option sources and run context.
   */
  wrapper(element: TQuarkElement, state: ListenerState): (e: Event) => void {
    const existing = this.wrappers.get(element);
    if (existing) {
      // keep timing bookkeeping across runs
      state.timer = existing.state.timer;
      state.last = existing.state.last;
      existing.state = state;
      return existing.fn;
    }
    const entry = { state, fn: (_e: Event) => {} };
    const block = this.block;
    const slot = this.key;
    const run = (e: Event, delegate: Element | undefined) => {
      const { options } = entry.state;
      if (entry.state.dynamic.some((o) => o.name === "handle")) {
        this.callHandlers(
          element,
          this.evaluateOption(element, entry.state, "handle", e, delegate),
          e
        );
      }
      if (block) block.runEvent(element, e, options, delegate ?? null);
    };
    entry.fn = (e: Event) => {
      const { opts, internal, hash, ruleId } = entry.state;
      const onHost = !!opts.host;
      if (onHost && !element.isConnected) {
        // the element left the document: drop the window / document listener
        internal.removeAllListeners(hash, ruleId, slot);
        return;
      }
      if (opts.self && e.target !== e.currentTarget) return;
      let delegate: Element | undefined;
      if (entry.state.dynamic.some((o) => o.name === "target")) {
        const selector = this.evaluateOption(
          element,
          entry.state,
          "target",
          e,
          undefined
        );
        if (isNoop(selector)) return;
        if (typeof selector !== "string" || !selector.trim()) {
          this.warnOnce(
            element,
            "target",
            `option "target" needs a string value`
          );
          return;
        }
        const origin = e.target as Element | null;
        const found =
          origin && typeof origin.closest === "function"
            ? tc(() => origin.closest(selector))
            : null;
        if (!found) return;
        if (!onHost && !element.contains(found)) return;
        delegate = found;
      }
      if (entry.state.dynamic.some((o) => o.name === "key")) {
        const filter = this.evaluateOption(
          element,
          entry.state,
          "key",
          e,
          delegate
        );
        if (isNoop(filter)) return;
        if (typeof filter !== "string" || !filter.trim()) {
          this.warnOnce(element, "key", `option "key" needs a string value`);
          return;
        }
        if (!matchesKey(filter, e)) return;
      }
      if (opts.once) internal.removeAllListeners(hash, ruleId, slot);
      // event flags act now, before any timing, so cancelation is synchronous
      if (opts.preventDefault) e.preventDefault();
      if (opts.stopPropagation) e.stopPropagation();
      if (opts.stopImmediatePropagation) e.stopImmediatePropagation();
      const debounce = this.evaluateMs(
        element,
        entry.state,
        "debounce",
        e,
        delegate
      );
      if (debounce) {
        clearTimeout(entry.state.timer);
        entry.state.timer = setTimeout(() => run(e, delegate), debounce);
        return;
      }
      const throttle = this.evaluateMs(
        element,
        entry.state,
        "throttle",
        e,
        delegate
      );
      if (throttle) {
        const now = Date.now();
        const last = entry.state.last;
        if (last !== undefined && now - last < throttle) return;
        entry.state.last = now;
      }
      run(e, delegate);
    };
    // give the wrapper a readable name for DevTools / stack traces
    Object.defineProperty(entry.fn, "name", {
      value: `on:${this.eventTypes.join(",")}`,
    });
    this.wrappers.set(element, entry);
    return entry.fn;
  }
  _run(element: TQuarkElement, options: QuarkOptions) {
    return resolveField({
      element,
      key: this.key,
      value: this.value,
      options: { ...options, rule: this.parent, property: this },
      hash: this.parent.quarkInstance.hash,
      listener: {
        eventTypes: this.eventTypes,
        slot: this.key,
        optionSources: this.optionSources,
        block: this.block ?? undefined,
      },
    });
  }
}
