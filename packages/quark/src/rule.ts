export type * from "./types";
import { Action } from "./actions";
import {
  declarationStrings,
  eventNamesText,
  listenerOptionSources,
  type RuleNode,
  ruleSelectorTexts,
  sliceNode,
  type Statement,
  type TransitionRule,
  transitionSourceText,
  viewBlock,
} from "./ast";
import { CHILD_REMOVED } from "./constants";
import {
  Attribute,
  Delay,
  Diagnostic,
  Listener,
  recordSeq,
  StyleProperty,
  Variable,
} from "./properties";
import type { Quark } from "./quark";
import type { TQuarkElement } from "./quark-internal";
import { SCOPE_ATTR } from "./scope-id";
import {
  analyzeSelector,
  buildSelectorLine,
  type CompoundDependency,
  EMPTY_ANALYSIS,
  type FanOutRoot,
  type SelectorAnalysis,
  splitScopePrefix,
} from "./selector-utils";
import type { MutationMap, QuarkOptions, TransitionSpec } from "./types";
import { isInfoLogging, QuarkLogger } from "./utils";
import { selectAll, tc } from "@excom/kit-utils";

let quarkRuleIdCounter = 0;

/**
 * Elements not contained by another in the list, in the list's own
 * order (fan-out order is observable: it decides which match's
 * properties run first). Containment is decided on a document-ordered
 * copy: a nested element always follows its container there, and kept
 * elements are disjoint, so each candidate needs one `contains` against
 * the last kept, not against every other.
 */
export const outermostElements = (elements: HTMLElement[]): HTMLElement[] => {
  if (elements.length < 2) return elements;
  const sorted = elements
    .slice()
    .sort((a, b) =>
      a === b
        ? 0
        : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1
    );
  const kept = new Set<HTMLElement>();
  let last: HTMLElement | undefined;
  for (const el of sorted) {
    if (!last || (last !== el && !last.contains(el))) {
      kept.add(el);
      last = el;
    }
  }
  return elements.filter((el) => kept.has(el));
};

/**
 * Mutation kinds run structural first: `RUN_ALL`, then `NEW_SELF`, then
 * `content` / `CHILD_REMOVED`, then attr names and `$bindings`.
 */
const KIND_ORDER: Record<string, number> = {
  RUN_ALL: 0,
  NEW_SELF: 1,
  content: 2,
  [CHILD_REMOVED]: 3,
};
const kindOrder = (a: string, b: string) =>
  (KIND_ORDER[a] ?? 4) - (KIND_ORDER[b] ?? 4);

/**
 * The spec a `@view-transition` node gives the writes inside it.
 * `ownerRule` is the rule the block is written in (`null` at sheet level).
 */
export const transitionSpec = (
  node: TransitionRule,
  source: string,
  ownerRule: Rule | null
): TransitionSpec => ({
  optionSources: listenerOptionSources(node, source),
  source: transitionSourceText(node, source),
  firstRender: node.options.some((option) => option.name === "first-render"),
  ownerRule,
  warned: new Set(),
});

export class Rule {
  // for debugging
  id: number;
  numberOfRuns: number = 0;
  // for runtime
  /** Authored selector (may contain `:scope`); parent for nested rules. */
  selector: string;
  /**
   * Selector usable with DOM APIs (no `:scope`). Empty string: the rule
   * targets the host itself (`:scope { ... }`).
   */
  matchSelector: string;
  /**
   * Set when the selector is `:scope`-anchored: remainder of the first
   * compound, matched against the host (`:scope[is-on]` → `"[is-on]"`,
   * bare `:scope` → `""`). `null` if the selector has no `:scope`.
   */
  hostCompound: string | null;
  /**
   * The rule's own selector text, before composition with the parent's
   * (`+ provider-fetch`)
   */
  ownSelector: string;
  /** Rules inside an `@scope` block only match within the host's subtree. */
  isScoped: boolean;
  path: string[];
  /** Selector attribute gates plus literal `attr("x")` reads, observer input. */
  observedAttrs: Set<string>;
  /** What `matchSelector` depends on and where its subjects sit relative to each change. */
  deps: SelectorAnalysis;
  /** Same for `hostCompound` (`:scope:has([x])`), or `null`. */
  hostDeps: SelectorAnalysis | null;
  /**
   * Match can change when elements are removed (`:has()`, sibling
   * position, sibling combinators). The sheet observes child removals
   * only when some rule says so.
   */
  reactsToRemovals: boolean;
  attributes: Attribute[] = [];
  variables: Variable[] = [];
  listeners: Listener[] = [];
  /** `@warn` / `@debug` / `@error` statements, run after the writes. */
  diagnostics: Diagnostic[] = [];
  /** `@delay` blocks, scheduled after the writes. */
  delays: Delay[] = [];
  /** `@dispatch` / `@command` statements, run after the block's writes and nested rules. */
  actions: Action[] = [];
  parent?: Rule;
  quarkInstance: Quark;
  /**
   * True for the rule built from an `@on … { }` block (and its nested
   * rules). Event-block rules never join `quarkInstance.rules`, so sheet
   * passes, observer filter, and binding / prop indexes ignore them.
   * They run only through `runEvent`.
   */
  isEventBlock: boolean;
  /** Nested rules, kept only for event-block rules (see `runEvent`). */
  childRules: Rule[] = [];
  /**
   * True inside an `@on … { }` block (its nested rules and `@delay`
   * blocks included): the only place `@dispatch` / `@command` may appear,
   * so an outgoing event is always caused by an event the sheet heard.
   */
  inListenerBlock: boolean;
  /**
   * The `@view-transition` block enclosing this rule, inherited by its
   * writes and nested rules (a block written inside the rule stamps its
   * own spec on the writes it holds: see `Property.transition`).
   */
  transition: TransitionSpec | null;
  constructor({
    quarkInstance,
    statement,
    source,
    parent,
    parentSelector,
    selectorText,
    scoped = false,
    isEventBlock = false,
    inListenerBlock = false,
    transition = null,
  }: {
    quarkInstance: Quark;
    statement: RuleNode;
    source: string;
    parent?: Rule;
    parentSelector?: string;
    /** Set when fanning out a comma-separated selector list. */
    selectorText?: string;
    scoped?: boolean;
    isEventBlock?: boolean;
    inListenerBlock?: boolean;
    transition?: TransitionSpec | null;
  }) {
    this.isEventBlock = isEventBlock;
    this.inListenerBlock = inListenerBlock;
    this.transition = transition;
    if (transition) quarkInstance.hasTransitions = true;
    const selectorTexts = selectorText
      ? [selectorText]
      : ruleSelectorTexts(statement, source);
    this.ownSelector = selectorTexts[0].trim();
    this.selector = buildSelectorLine(selectorTexts[0], parentSelector);
    selectorTexts.slice(1).forEach((sel) => {
      new Rule({
        quarkInstance,
        statement,
        source,
        parent,
        parentSelector,
        selectorText: sel,
        scoped,
        isEventBlock,
        inListenerBlock,
        transition,
      });
    });
    const { hostCompound, rest } = splitScopePrefix(this.selector);
    this.hostCompound = hostCompound;
    this.matchSelector = rest;
    // `:scope` explicitly references the host, so such rules are
    // host-anchored even at the top level of a global sheet
    this.isScoped = scoped || hostCompound !== null;
    this.deps = rest ? analyzeSelector(rest) : EMPTY_ANALYSIS;
    this.path = this.deps.path;
    this.observedAttrs = new Set(this.deps.attrs);
    // `:scope[is-on]`, host attribute changes must trigger this rule
    this.hostDeps = hostCompound ? analyzeSelector(hostCompound) : null;
    this.hostDeps?.attrs.forEach((a) => this.observedAttrs.add(a));
    this.reactsToRemovals =
      this.deps.reactsToRemovals || !!this.hostDeps?.reactsToRemovals;
    if (!isEventBlock) {
      // warn where the pseudo is written, once, not again in every nested rule
      const ownText = selectorTexts[0];
      const unobserved = [
        ...this.deps.unobserved,
        ...(this.hostDeps?.unobserved ?? []),
      ].filter((name) => ownText.includes(name));
      if (unobserved.length) {
        QuarkLogger.warn({
          method: "rule",
          message: `Quark: ${[...new Set(unobserved)].join(", ")} in "${this.selector}" is not observed — the rule matches on its first run only. Select on reflected attributes or listen for events instead.`,
        });
      }
    }
    this.parent = parent;
    this.quarkInstance = quarkInstance;
    /*
     * A `@view-transition { … }` written in this rule is not a rule of
     * its own: its declarations and `@on`s join this rule, stamped with
     * the block's spec, and its nested rules become children carrying
     * it. Blocks nest; the innermost wins.
     */
    const children: Array<[RuleNode, TransitionSpec | null]> = [];
    const collect = (body: Statement[], spec: TransitionSpec | null) => {
      const view = viewBlock(body);
      view.declarations.forEach((declaration) => {
        const { key, value } = declarationStrings(declaration, source);
        const args = { key, value, parent: this, transition: spec };
        if (key.startsWith("$")) {
          this.variables.push(new Variable(args));
        } else if (key.startsWith("--")) {
          this.attributes.push(new StyleProperty(args));
        } else {
          this.attributes.push(new Attribute(args));
        }
      });
      view.diagnostics.forEach((node) => {
        this.diagnostics.push(
          new Diagnostic({
            level: node.name,
            value: sliceNode(source, node.value).trim(),
            parent: this,
            transition: spec,
          })
        );
      });
      view.delays.forEach((node) => {
        this.delays.push(
          new Delay({
            value: sliceNode(source, node.duration).trim(),
            parent: this,
            transition: spec,
            // the block body is a rule at this rule's own selector, applied
            // to the matched element once when the timer fires
            block: new Rule({
              quarkInstance,
              statement: { block: node.block } as RuleNode,
              source,
              parent: this,
              selectorText: this.selector,
              scoped,
              isEventBlock: true,
              inListenerBlock,
              transition: spec,
            }),
          })
        );
      });
      view.actions.forEach((node) => {
        if (!inListenerBlock) {
          QuarkLogger.error({
            method: "rule",
            message: `Quark: @${node.name} must be written inside an @on block — a rule matching is not an occurrence (${this.selector})`,
          });
          return;
        }
        this.actions.push(
          new Action({
            kind: node.name,
            names: node.names,
            optionSources: listenerOptionSources(node, source),
            parent: this,
          })
        );
      });
      view.listeners.forEach((node) => {
        if (isEventBlock) {
          QuarkLogger.error({
            method: "rule",
            message: `Quark: @${node.name} inside an @on / @delay block is not supported (${this.selector})`,
          });
          return;
        }
        this.listeners.push(
          new Listener({
            eventTypes: node.events.map((e) => e.name),
            eventsText: eventNamesText(node.events),
            optionSources: listenerOptionSources(node, source),
            parent: this,
            transition: spec,
            // the block body is a rule at this rule's own selector, applied
            // to the matched element once per event (never by the passes)
            block: node.block
              ? new Rule({
                  quarkInstance,
                  statement: { block: node.block } as RuleNode,
                  source,
                  parent: this,
                  selectorText: this.selector,
                  scoped,
                  isEventBlock: true,
                  inListenerBlock: true,
                  transition: spec,
                })
              : null,
          })
        );
      });
      view.children.forEach((child) => {
        if (child.type === "rule") children.push([child, spec]);
        else collect(child.block.body, transitionSpec(child, source, this));
      });
    };
    collect(statement.block.body, transition);

    // if there are no attributes or variables, do not pass reference to self anywhere
    // so garbage collection can clean this instance up
    const hasProperties =
      this.attributes.length > 0 ||
      this.variables.length > 0 ||
      this.listeners.length > 0 ||
      this.diagnostics.length > 0 ||
      this.delays.length > 0 ||
      this.actions.length > 0;
    if (hasProperties || isEventBlock) {
      if (!isEventBlock) quarkInstance.rules.push(this);
      this.id = quarkRuleIdCounter;
      quarkRuleIdCounter++;
    }
    children.forEach(([child, childTransition]) => {
      const childRule = new Rule({
        quarkInstance,
        statement: child,
        source,
        parent: hasProperties || isEventBlock ? this : parent,
        parentSelector: this.selector,
        scoped,
        isEventBlock,
        inListenerBlock,
        transition: childTransition,
      });
      if (isEventBlock) this.childRules.push(childRule);
    });
  }
  /**
   * Apply a block rule (`@on … { }`, `@delay … { }`) to `element` once:
   * every declaration runs against the element (no re-run gating; a
   * block is a one-shot), then nested rules run against matching
   * descendants, then `@dispatch` / `@command` statements run (after
   * every write of the block is queued). `event` is exposed to
   * expressions through the options (`undefined` for a `@delay`
   * scheduled outside an `@on` block).
   */
  runEvent(
    element: HTMLElement,
    event: Event | undefined,
    baseOptions: QuarkOptions,
    eventTarget: Element | null = null
  ) {
    const options: QuarkOptions = {
      ...baseOptions,
      event,
      eventTarget: eventTarget ?? (event?.target as Element | null) ?? null,
      rule: this,
      property: undefined,
      properties: undefined,
      propertiesToRun: undefined,
      isFirstRun: false,
      isAsyncRun: false,
      changedBinding: undefined,
    };
    this.numberOfRuns++;
    const target = element as TQuarkElement;
    this.variables.forEach((v) => v._run(target, options));
    this.attributes.forEach((a) => a._run(target, options));
    this.diagnostics.forEach((d) => d._run(target, options));
    this.delays.forEach((d) => d._run(target, options));
    this.childRules.forEach((child) => {
      /*
       * A nested selector starting with a sibling combinator means the
       * element's siblings, not its descendants
       */
      if (/^[+~]/.test(child.ownSelector)) {
        const siblings = tc(() =>
          selectAll(`:scope ${child.ownSelector}`, { scope: element })
        );
        siblings?.forEach((el) => {
          child.runEvent(el, event, baseOptions, eventTarget);
        });
        return;
      }
      const selector = child.isScoped
        ? child.scopedSelector()
        : child.matchSelector;
      if (!selector) return;
      element.querySelectorAll(selector).forEach((el) => {
        child.runEvent(el as HTMLElement, event, baseOptions, eventTarget);
      });
    });
    this.actions.forEach((action) => action.run(target, options));
  }
  run(
    mutationMap: MutationMap,
    {
      host,
      options,
    }: {
      host: HTMLElement;
      options: QuarkOptions;
    }
  ) {
    const propertiesToRun = this.filterPropertiesToRun(options);
    if (propertiesToRun.length > 0) {
      this._run(mutationMap, {
        host,
        options: { ...options, propertiesToRun },
      });
    }
  }
  _run(
    mutationMap: MutationMap,
    {
      host,
      options,
    }: {
      host: HTMLElement;
      options: QuarkOptions;
    }
  ) {
    const elementsToMutate = new Set<HTMLElement>();
    // `:scope[x] …` rules are inert while the host doesn't match the compound
    if (this.hostCompound && !host.matches(this.hostCompound)) return;
    const targetsHost = this.hostCompound !== null && !this.matchSelector;
    /*
      Scoping lives in the host marker, not tree walks. Registered hosts
      carry `q-scope="<id>"` and scoped selectors are prefixed with
      `[q-scope="<id>"] ` (see scope-id.ts), so the native engine
      enforces CSS `@scope`. Every compound matches strict descendants;
      the host itself only via explicit `:scope` (hostCompound /
      targetsHost). `host.contains()` and query-root clamping below bound
      the work and keep stale cloned markers outside the host inert.
    */
    const runSelector = this.isScoped
      ? this.scopedSelector()
      : this.matchSelector;
    const matchesRule = (el: HTMLElement) => this.matchesElement(el, host);
    // a full-property fan-out visits every match below its query roots.
    // recorded so deferred binding writes can tell which readers it reached
    const trace = this.quarkInstance.runTrace;
    const coverage =
      trace && !options.properties
        ? (trace.coverage.get(this) ??
          trace.coverage.set(this, new Set()).get(this))
        : undefined;
    const { compounds, usesHas } = this.deps;
    const hostDeps = this.hostDeps?.compounds[0];
    const hostReactsToChildren = !!this.hostDeps?.usesHas;
    /*
      Fan-out roots: elements whose subtree is re-queried for subjects,
      in queue order (observable: it decides which match's properties
      run first). Duplicates and nested roots collapse in
      `outermostElements`.
    */
    const roots = new Set<HTMLElement>();
    const fanOut = (root: HTMLElement | null) => {
      if (root) roots.add(root);
    };
    const rootFor = (el: HTMLElement, where: FanOutRoot) =>
      where === "parent" ? (el.parentElement ?? el) : el;
    /**
     * Ancestors-or-self of `el` that are compound `c`'s element (the
     * subject itself for the last compound). Scoped rules stop at the
     * host; the marker keeps every compound a strict descendant anyway.
     * Global rules walk to the root.
     */
    const matchingAncestors = (
      el: HTMLElement,
      c: CompoundDependency
    ): HTMLElement[] => {
      const found: HTMLElement[] = [];
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        if (a === host && this.isScoped) break;
        if (c.isSubject ? matchesRule(a) : this.matchesPrefix(a, c)) {
          found.push(a);
        }
      }
      return found;
    };
    mutationMap?.forEach((attrs, element) => {
      let addedSelf = false;
      const mutateSelf = (el: HTMLElement = element) => {
        if (el === element) {
          if (addedSelf) return;
          addedSelf = true;
        } else if (elementsToMutate.has(el)) {
          return;
        }
        this.numberOfRuns++;
        elementsToMutate.add(el);
      };
      /** Compound `c`'s element `el` was affected: it is a subject, or subjects sit below / beside it. */
      const reach = (el: HTMLElement, c: CompoundDependency) => {
        if (c.isSubject) mutateSelf(el);
        else fanOut(rootFor(el, c.root));
      };
      /**
       * Elements came or went below `el`: `:has()` / `:empty` candidates
       * on the way up may have flipped.
       */
      const childrenChanged = (el: HTMLElement) => {
        for (const c of compounds) {
          if (!c.reactsToChildren) continue;
          if (c.broad) fanOut(host);
          else matchingAncestors(el, c).forEach((a) => reach(a, c));
        }
        if (hostReactsToChildren) fanOut(host);
      };
      [...attrs].sort(kindOrder).forEach((attr) => {
        if (attr === "RUN_ALL") {
          // on init, if host matches selector
          if (element === host && matchesRule(element)) mutateSelf();
          fanOut(element);
        } else if (attr === "NEW_SELF") {
          // if self added children
          if (matchesRule(element)) mutateSelf();
          if (host.contains(element)) fanOut(element);
        } else if (attr === "content" || attr === CHILD_REMOVED) {
          if (attr === CHILD_REMOVED && !this.reactsToRemovals) return;
          if (!host.contains(element)) return;
          // matching children were added / removed below `element`
          fanOut(element);
          if (usesHas || hostReactsToChildren) childrenChanged(element);
        } else if (attr === "PROP") {
          // a JS property changed on `element`; `prop()` reads are on
          // the matched element only, so only it re-runs
          if (matchesRule(element)) mutateSelf();
        } else if (attr.startsWith("$")) {
          /*
           * A $binding changed on `element` (the owner). Bindings scope
           * to the DOM tree, so consumers are the owner plus matching
           * descendants, regardless of rule nesting. Owners above the
           * host (another sheet) still fan out; the scoped selector
           * keeps matches inside this sheet's subtree.
           */
          if (matchesRule(element)) mutateSelf();
          else if (host.contains(element) || element.contains(host)) {
            fanOut(element);
          }
        } else {
          /*
           * An observed attr changed on `element`. A literal `attr("x")`
           * read re-runs a matching subject; every compound that depends
           * on the name says where its subjects went (see
           * `CompoundDependency`).
           */
          if (this.readsAttr(attr) && matchesRule(element)) mutateSelf();
          for (const c of compounds) {
            if (
              c.selfAttrs.has(attr) &&
              (c.isSubject
                ? matchesRule(element)
                : this.matchesPrefix(element, c))
            ) {
              reach(element, c);
            }
            if (c.looseAttrs.has(attr)) fanOut(rootFor(element, c.looseRoot));
            if (c.hasAttrs.has(attr)) {
              matchingAncestors(element, c).forEach((a) => reach(a, c));
            }
            if (c.broadAttrs.has(attr)) fanOut(host);
          }
          if (hostDeps) {
            /*
             * Host state changed on a `:scope[attr] …` rule, or a
             * descendant named in `:scope:has(…)`. The host is the first
             * path segment, so re-run the rule for its subtree.
             */
            const affected =
              element === host
                ? hostDeps.selfAttrs.has(attr) || hostDeps.looseAttrs.has(attr)
                : hostDeps.hasAttrs.has(attr) || hostDeps.broadAttrs.has(attr);
            if (affected) fanOut(host);
          }
        }
      });
    });
    // find the most distant ancestors
    outermostElements([...roots]).forEach((ancestor) => {
      /*
       * Scoped rules clamp to the host so fan-out from an ancestor
       * above it (cross-sheet binding owners, providers above scope)
       * never leaks into sibling scopes. Unscoped rules run in the
       * root context, so a host-level fan-out (RUN_ALL) expands to the
       * root.
       */
      const queryRoot = this.isScoped
        ? host.contains(ancestor)
          ? ancestor
          : host
        : ancestor === host
          ? (host.getRootNode() as Document | HTMLElement)
          : ancestor;
      if (targetsHost) {
        if (queryRoot.contains(host)) elementsToMutate.add(host);
      } else {
        if (queryRoot instanceof Element) coverage?.add(queryRoot);
        queryRoot.querySelectorAll(runSelector).forEach((el) => {
          elementsToMutate.add(el as HTMLElement);
        });
      }
      this.numberOfRuns++;
    });
    // execute mutations
    if (elementsToMutate.size > 0 && isInfoLogging()) {
      QuarkLogger.info({
        method: "foundElements",
        runId: options.runId,
        sheetId: this.quarkInstance.id,
        ruleId: this.id,
        elements: [[Array.from(elementsToMutate)]],
        options,
      });
    }
    elementsToMutate.forEach((element) => {
      this.runProps(mutationMap, element, options);
    });
  }
  /**
   * Whether `el` is compound `c`'s element: it matches the selector up
   * to and including that compound, host-scoped when the rule is.
   */
  matchesPrefix(el: Element, c: CompoundDependency): boolean {
    // a leading combinator (`> span` after `:scope`) is only valid scoped;
    // other prefixes stay bare, the fan-out root is clamped to the host
    const selector =
      c.prefixNeedsScope && this.isScoped ? this.scoped(c.prefix) : c.prefix;
    return tc(() => el.matches(selector)) === true;
  }
  /** Whether `el` is a subject of this rule under `host` (scope-aware). */
  matchesElement(el: Element, host: HTMLElement): boolean {
    if (this.hostCompound !== null && !this.matchSelector) return el === host;
    return (
      !!this.matchSelector &&
      (!this.isScoped || host.contains(el)) &&
      el.matches(this.isScoped ? this.scopedSelector() : this.matchSelector)
    );
  }
  /** Selector cache for the current scope id (rebuilt after re-register). */
  private scopedCache: { id: string; selectors: Map<string, string> } | null =
    null;
  /**
   * `selector` prefixed with the host's `q-scope` marker so the native
   * engine clamps every compound to strict descendants of the host (CSS
   * `@scope`, see scope-id.ts). Bare selector until the sheet is
   * registered.
   */
  scoped(selector: string): string {
    const id = this.quarkInstance.scopeId;
    if (!id) return selector;
    if (this.scopedCache?.id !== id) {
      this.scopedCache = { id, selectors: new Map() };
    }
    let scoped = this.scopedCache.selectors.get(selector);
    if (!scoped) {
      scoped = `[${SCOPE_ATTR}="${id}"] ${selector}`;
      this.scopedCache.selectors.set(selector, scoped);
    }
    return scoped;
  }
  /** The whole `matchSelector`, host-scoped (see `scoped`). */
  scopedSelector(): string {
    return this.scoped(this.matchSelector);
  }

  /** True when a property body reads this name via literal `attr("x")`. */
  readsAttr(attr: string): boolean {
    const inProps = (p: Variable | Attribute | Listener) =>
      p.referencedAttrNames.includes(attr);
    return (
      this.variables.some(inProps) ||
      this.attributes.some(inProps) ||
      this.listeners.some(inProps) ||
      this.diagnostics.some(inProps) ||
      this.delays.some(inProps)
    );
  }

  runProps(
    mutationMap: MutationMap,
    element: HTMLElement,
    options: QuarkOptions
  ) {
    const { propertiesToRun } = options;
    const mutatedProperties = Array.from(
      mutationMap.get(element as HTMLElement) || []
    );

    const trace = this.quarkInstance.runTrace;
    const shouldRunProperty = (property: Variable | Attribute | Listener) => {
      if (propertiesToRun && !propertiesToRun.includes(property)) return false;
      // this second check ensures that we avoid running a given property if
      // that property is what triggered the change to begin with. `class`
      // is exempt: its tokens are separate facts (`.a { class: (b: true) }`
      // must apply when `a` arrives); class cycles are cut by the loop guard
      if (
        property.key !== "class" &&
        mutatedProperties.includes(property.key)
      ) {
        // not refreshed by this run: a deferred write it reads must reach it
        if (trace) recordSeq(trace.visited, element, property, 0);
        return false;
      }
      return true;
    };

    this.variables.forEach((v) => {
      if (shouldRunProperty(v)) {
        v.run(element, options);
      }
    });
    this.listeners.forEach((l) => {
      if (shouldRunProperty(l)) {
        l.run(element, options);
      }
    });
    this.attributes.forEach((a) => {
      if (shouldRunProperty(a)) {
        a.run(element, options);
      }
    });
    // after the writes: a diagnostic reads what this pass set; a delay
    // restarts on every application of the rule
    this.diagnostics.forEach((d) => {
      if (shouldRunProperty(d)) {
        d.run(element, options);
      }
    });
    this.delays.forEach((d) => {
      if (shouldRunProperty(d)) {
        d.run(element, options);
      }
    });
  }
  filterPropertiesToRun(options: QuarkOptions) {
    const allProps = [
      ...this.variables,
      ...this.attributes,
      ...this.listeners,
      ...this.diagnostics,
      ...this.delays,
    ];
    return !options.properties
      ? allProps
      : allProps.filter((prop) => {
          return options.properties?.includes(prop);
        });
  }
}
