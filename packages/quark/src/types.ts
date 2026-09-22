import type { ListenerOptionSource } from "./ast";
import type { Attribute, Listener, Variable } from "./properties";
import type { TQuarkElement } from "./quark-element";
import type { Rule } from "./rule";
export type UtilFn = (e: any) => any;

export type Vars = Record<string, any>;

export interface AST {
  type: string;
  value: string;
  children: AST[];
}

export type PaintFn = () => void;

/**
 * A `@view-transition` block as the writes inside it carry it
 * (`Property.transition`; nested rules and `@on` blocks inherit it through
 * `Rule.transition`, a nested block replaces it). Options are evaluated per
 * resolve (see `resolveTransitionOptions`).
 */
export interface TransitionSpec {
  /** Options as written, in source order. */
  optionSources: ListenerOptionSource[];
  /** Display text: `@view-transition (types: "todo-change")`. */
  source: string;
  /** The block lists `first-render` (read statically: no evaluation needed). */
  firstRender: boolean;
  /**
   * The rule the block is written in: the element it matches is where the
   * options are evaluated and `until: "<selector>"` is checked. `null` for
   * a sheet-level block, whose element is the host.
   */
  ownerRule: Rule | null;
  /** Option names already warned about for this block. */
  warned: Set<string>;
}

export interface QuarkOptions {
  observe?: boolean;
  /**
   * Wrap the sheet in an implicit `@scope { }` at the host (quark-sheet's
   * default, via `is-global` inversion). Without it, top-level rules run
   * in the root context and authors write `@scope { }` themselves.
   */
  isScoped?: boolean;
  rule?: Rule;
  /** The property being resolved (set for the duration of one resolve). */
  property?: Variable | Attribute | Listener;
  runId?: string;
  isFirstRun?: boolean;
  properties?: Array<Variable | Attribute | Listener>;
  propertiesToRun?: Array<Variable | Attribute | Listener>;
  isAsyncRun?: boolean;
  /**
   * Set while an `@on` block runs, and while its per-event options
   * (`handle`, `target`, …) evaluate: the DOM event being handled. The
   * `event` built-in; `undefined` outside a block.
   */
  event?: Event;
  /**
   * Set while an `@on` block runs: the element the `target:` option
   * matched (the delegate), else the event's target. The `target`
   * built-in.
   */
  eventTarget?: Element | null;
  /** Set on `quark-binding-change` fan-out runs; enables the nearness skip. */
  changedBinding?: {
    name: string;
    origin: WeakRef<HTMLElement>;
    /**
     * For changes deferred to the end of a sheet's run: sequence number
     * at write time plus the run's trace, so consumers that already ran
     * after the write are not run again.
     */
    sinceSeq?: number;
    trace?: RunTrace;
  };
}

/**
 * What one sheet run executed, in order: every (element, property) pair
 * gets the sequence number at which it ran. Lives only for the outermost
 * `Quark.run()`; binding writes during that run carry the seq they were
 * made at.
 */
export interface RunTrace {
  seq: number;
  /** Property executions: the sequence number at which each ran. */
  ran: Map<Element, Map<Variable | Attribute | Listener, number>>;
  /**
   * Property visits (`Property.run` reached, executed or not). Seq 0
   * marks a property the run skipped on purpose (its key was the
   * triggering mutation); always stale for a later write.
   */
  visited: Map<Element, Map<Variable | Attribute | Listener, number>>;
  /** `$names` written so far during the run (any owner). */
  written: Set<string>;
  /**
   * Per rule: subtree roots the rule fanned out from with its full
   * property set. Every match below such a root was visited.
   */
  coverage: Map<Rule, Set<Element>>;
}

export type QuarkListenerConfig = [
  Node | WeakRef<Node>,
  string,
  (e: CustomEvent) => void,
][];

export interface QuarkArgs {
  host: HTMLElement;
  sheet: string;
  variables?: Vars;
}

export interface ContextSheet {
  host?: HTMLElement;
  hash: string;
  options: QuarkOptions;
}

export interface ContextField extends ContextSheet {
  element: TQuarkElement;
  key: string;
  value: string | null;
  /**
   * Set for `@on` at-rules: DOM event types, storage slot (display key,
   * unique per event list + options within a rule), option sources, and
   * for `@on … { }` the block rule applied once per event.
   */
  listener?: {
    eventTypes: string[];
    slot: string;
    optionSources: ListenerOptionSource[];
    block?: Rule;
  };
}

export type MutationMap = Map<HTMLElement, Set<string>>;

export type ExpressionResult =
  | {
      type: "html";
      value: string;
      after?: () => void;
    }
  | {
      type: "nodes";
      value: Node[];
      after?: () => void;
    }
  | undefined;
