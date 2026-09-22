export * from "./types";
import { collectUseRules, type Statement, type TransitionRule } from "./ast";
import {
  BINDING_CHANGE_EVENT,
  type BindingChangeDetail,
  dispatchBindingChange,
} from "./bindings";
import {
  BUILTIN_MODULE_SCHEME,
  builtinModuleName,
  QUARK_MODULES,
  resolveBuiltinModule,
} from "./builtin-modules";
import { warnStaticCycles } from "./cycle-check";
import { attachDevtools, publicize } from "./devtools-hook";
import { installElementApi } from "./element-api";
import { listen, observe, unobserve } from "./observer";
import type { Attribute, Listener, Variable } from "./properties";
import {
  PROP_CHANGE_EVENT,
  type PropChangeDetail,
  subscribeProp,
} from "./props";
import { getQuarkInternal } from "./quark-internal";
import { Rule, transitionSpec } from "./rule";
import { acquireScopeId, releaseScopeId } from "./scope-id";
import { addBusyCheck, whenSettled } from "./settle";
import type {
  MutationMap,
  QuarkListenerConfig,
  QuarkOptions,
  RunTrace,
  TransitionSpec,
  Vars,
} from "./types";
import {
  getQuarkHost,
  getQuarkMin,
  isInfoLogging,
  QuarkLogger,
  stringToHash,
} from "./utils";
import { LoopGuard, resolveModuleReference } from "@excom/kit-utils";
import type { UseRule } from "@excom/quark-parser";
import { parse } from "@excom/quark-parser";

/*
 * Loop-guard trips show in DevTools as orchestration errors. The
 * Orchestrator is where a runaway attr / effect / event cycle is
 * reasoned about, whichever engine dropped the write.
 */
// `element.quark` — the JS side of bindings, on every element
installElementApi();

LoopGuard.onTrip((trip) => {
  const element = trip.target instanceof Element ? trip.target : null;
  publicize(["quark", "error"], {
    ...(element ? { weakElement: new WeakRef(element) } : {}),
    tag: element?.localName ?? null,
    selector: null,
    ruleId: null,
    sheetId: null,
    runId: null,
    key: trip.name,
    expression: null,
    errorMessage: trip.message,
    errorName: trip.kind === "batch" ? "LoopGuardBatch" : "LoopGuardDepth",
  });
});

/** Deepest loop-guard stamp among the changes a run reacts to. */
const inheritedDepth = (mutationMap: MutationMap) => {
  let depth = 0;
  mutationMap.forEach((attrs, element) =>
    attrs.forEach((attr) => {
      depth = Math.max(depth, LoopGuard.depthOf(element, attr));
    })
  );
  return depth;
};

interface TQuarkRegistry {
  sheets: WeakRef<Quark>[];
  add: (sheet: Quark) => void;
  remove: (sheet: Quark) => void;
  findRules: (selectorOrId: string | number) => Rule[];
}

export const QuarkRegistry: TQuarkRegistry = {
  sheets: [],
  add: (sheet: Quark) => {
    QuarkRegistry.sheets.push(new WeakRef(sheet));
  },
  remove: (sheet: Quark) => {
    QuarkRegistry.sheets = QuarkRegistry.sheets.filter(
      (q: WeakRef<Quark>) => q.deref() !== sheet
    );
  },
  findRules: (selectorOrId: string | number) => {
    return QuarkRegistry.sheets
      .map((q: WeakRef<Quark>) => q.deref())
      .filter((q: Quark | undefined) => q)
      .flatMap((q: Quark) =>
        q.rules.filter((r: Rule) => {
          const isNumber = typeof selectorOrId === "number";
          return isNumber
            ? r.id === selectorOrId
            : String(r.selector)
                .split(" ")
                .slice(-1)[0]
                .includes(String(selectorOrId));
        })
      );
  },
};

if ((import.meta as any).env?.DEV) {
  (window as any).QuarkRegistry = QuarkRegistry;
}

// settle (see settle.ts): a registered sheet is busy while a rule pass is
// queued or running, or while its `@use` modules load before the first run
addBusyCheck(() =>
  QuarkRegistry.sheets.some((ref) => {
    const sheet = ref.deref();
    return (
      !!sheet &&
      (sheet.isRunningRules ||
        sheet.isLoadingModules ||
        sheet.ELEMENTS_TO_MATCH.size > 0)
    );
  })
);

export const DEFAULT_OPTIONS = {
  observe: true,
  autoRegister: true,
};

let quarkIdTotal = 0;
export class Quark {
  /**
   * Loads a `@use "url"` JS module. Resolves against the document origin.
   * Overridable (stubbed in tests, or a bundler-aware loader).
   */
  static moduleLoader: (url: string) => Promise<Vars> = resolveModuleReference;
  /**
   * Install the Nucleus DevTools hook (shared with
   * `Neutron.attachDevtools`). Chrome extensions install the global at
   * `document_start`; this is for tests and late attach.
   */
  static attachDevtools = attachDevtools;
  /**
   * Resolve once Quark is idle — no queued or running rule pass, no paint
   * waiting to commit, no async `content` or `@use` load pending — or
   * after `timeout` ms (default 1000): `"settled"`, `"until"` or
   * `"timeout"`. For tests and tools; sheets have no after-render hook.
   */
  static whenSettled = whenSettled;
  id: number;
  rules: Rule[] = [];
  host: WeakRef<HTMLElement>;
  listenerConfig: QuarkListenerConfig;
  src: string;
  hash: string;
  options: QuarkOptions;
  isRegistered: boolean = false;
  /** The host's `q-scope` marker id; set while registered (see scope-id.ts). */
  scopeId: string | null = null;
  observer: MutationObserver | null = null;
  /** `prop()` subscriptions this sheet holds, released on unregister. */
  private propSubscriptions: Map<Element, Map<string, () => void>> = new Map();
  ELEMENTS_TO_MATCH: MutationMap = new Map();
  allAttrs: string[] = [];
  /**
   * `$name` → properties in this sheet that reference it. Bindings
   * cascade across sheets (CSS custom-property semantics), so writers
   * are not known statically, but a sheet always knows its readers.
   * Cheap dismiss of `quark-binding-change` for unreferenced names.
   */
  bindingIndex: Map<string, Array<Variable | Attribute | Listener>> = new Map();
  /** property name → properties in this sheet that read it via `prop()`. */
  propIndex: Map<string, Array<Variable | Attribute | Listener>> = new Map();
  /** Namespaced module buckets from `@use` rules, once all imports settle. */
  pendingModules: Promise<{ [key: string]: Vars }> | null = null;
  /** Timers of pending `@delay` blocks (cleared on unregister). */
  delayTimers = new Set<ReturnType<typeof setTimeout>>();
  /**
   * Set while this sheet is inside the outermost `run()`: what ran, in
   * order. `$binding` writes meanwhile are queued (`queueBindingChange`)
   * and announced when the run completes, with the trace so consumers
   * that already ran after a write are skipped. A def under `tbody td`
   * no longer nests a run per cell for readers this pass already hits.
   */
  runTrace: RunTrace | null = null;
  private runDepth = 0;
  private pendingBindingChanges: Map<
    Element,
    Map<string, Omit<BindingChangeDetail, "name">>
  > = new Map();
  /** `writeBinding` notifier used mid-run: remember, dispatch after. */
  queueBindingChange = (owner: Element, detail: BindingChangeDetail) => {
    const { name, ...rest } = detail;
    let names = this.pendingBindingChanges.get(owner);
    if (!names) this.pendingBindingChanges.set(owner, (names = new Map()));
    // the latest write wins: a consumer is stale unless it ran after it
    names.set(name, { ...rest, sinceSeq: this.runTrace?.seq ?? 0 });
    this.runTrace?.written.add(name);
  };
  /**
   * Announce the run's deferred writes. A write is `selfCovered` (this
   * sheet ignores its own event) when every rule of this sheet reading
   * the name fanned out over the owner's subtree with its full property
   * set (each reader below the owner was visited) and no reader below
   * the owner was visited before the write. Readers visited after it
   * already evaluated with the new value (`written` gating in
   * `Property.run`).
   */
  private flushBindingChanges(trace: RunTrace) {
    const pending = this.pendingBindingChanges;
    if (!pending.size) return;
    this.pendingBindingChanges = new Map();
    const stale = new Set<Omit<BindingChangeDetail, "name">>();
    // readers visited before the write they depend on
    trace.visited.forEach((byProperty, element) =>
      byProperty.forEach((seq, property) =>
        property.referencedVarNames.forEach((name) => {
          if (!trace.written.has(name)) return;
          const entry = nearestPending(pending, element, name);
          if (entry && seq < (entry.sinceSeq ?? 0)) stale.add(entry);
        })
      )
    );
    const host = this.host.deref();
    pending.forEach((names, owner) =>
      names.forEach((detail, name) => {
        const readers = this.bindingIndex.get(name);
        const selfCovered =
          !!host &&
          !!readers?.length &&
          !stale.has(detail) &&
          readers.every((reader) => isCovered(trace, reader, owner, host));
        dispatchBindingChange(owner, { name, ...detail, trace, selfCovered });
      })
    );
  }
  // `isRunningRules` is for debouncing
  isRunningRules = false;
  /** Registered, first run waiting on `@use` modules (settle busy source). */
  isLoadingModules = false;
  /** Some rule sits inside a `@view-transition` block. */
  hasTransitions = false;
  /**
   * From `register()` until that registration's first run settles. Paints
   * resolved meanwhile are the first render and never start a view
   * transition, unless their block says `first-render`.
   */
  isFirstRender = true;
  private registrations = 0;
  runRules() {
    const mapToRun = new Map(this.ELEMENTS_TO_MATCH);
    this.ELEMENTS_TO_MATCH.clear();
    mapToRun.forEach((_, element) => {
      if (!element.isConnected) {
        mapToRun.delete(element);
      }
    });
    // the causal depth the queued changes inherited (see queueRunRules)
    const depth = this.pendingDepth;
    this.pendingDepth = 0;
    if (mapToRun.size) {
      LoopGuard.run(depth, () => this.run(mapToRun));
    }
  }
  /**
   * Loop-guard depth for the next `runRules()`: deepest chain among the
   * queued changes. Read when a change is queued (MutationObserver is
   * still in the write's task, so the `(element, attribute)` stamp is
   * live) and carried across the debounce.
   */
  private pendingDepth = 0;
  queueRunRules = ({
    element,
    attribute,
  }: {
    element: HTMLElement;
    attribute: string;
  }) => {
    this.pendingDepth = Math.max(
      this.pendingDepth,
      LoopGuard.current(),
      LoopGuard.depthOf(element, attribute)
    );
    if (this.ELEMENTS_TO_MATCH.has(element)) {
      this.ELEMENTS_TO_MATCH.get(element)?.add(attribute);
    } else {
      this.ELEMENTS_TO_MATCH.set(element, new Set([attribute]));
    }
    if (!this.isRunningRules) {
      this.isRunningRules = true;
      // todo: clean up - double setTimeout(0) ensures that a new quark run is triggered after the current paint is complete.
      setTimeout(() => {
        setTimeout(() => {
          this.runRules();
          this.isRunningRules = false;
        }, 0);
      }, 0);
    }
  };
  constructor({
    src,
    options = {},
  }: {
    src: string;
    modules?: { [key: string]: Vars };
    options?: QuarkOptions;
  }) {
    this.id = quarkIdTotal;
    quarkIdTotal++;
    const min = getQuarkMin(src);
    const hash = stringToHash(min);
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    /*
     * `isScoped` wraps the sheet in `@scope`, anchoring every rule to
     * the host (CSS inline-<style> scoping; quark-sheet passes it unless
     * `is-global` is set). Otherwise top-level rules run in the root
     * context and authors write `@scope { }` themselves.
     */
    this.src = this.options.isScoped ? wrapInScope(min) : min;
    this.hash = hash;
    const ast = parse(this.src);
    // Kick off @use imports immediately so the fetch overlaps rule
    // construction, registration, and the initial DOM matching pass.
    const useRules = collectUseRules(ast.body);
    if (useRules.length) {
      this.pendingModules = loadUseModules(useRules);
    }
    const buildRules = (
      statements: Statement[],
      scoped: boolean,
      transition: TransitionSpec | null = null
    ) =>
      statements.forEach((statement) => {
        if (statement.type === "rule") {
          new Rule({
            quarkInstance: this,
            statement,
            source: this.src,
            scoped,
            transition,
          });
        } else if (
          statement.type === "atrule" &&
          statement.name === "scope" &&
          statement.block
        ) {
          buildRules(statement.block.body, true, transition);
        } else if (
          statement.type === "atrule" &&
          statement.name === "view-transition"
        ) {
          // sheet-level block: its rules transition, owned by the host
          buildRules(
            (statement as TransitionRule).block.body,
            scoped,
            transitionSpec(statement as TransitionRule, this.src, null)
          );
        } else if (
          statement.type === "atrule" &&
          ["warn", "debug", "error", "delay"].includes(statement.name)
        ) {
          // no element to evaluate against outside a rule
          QuarkLogger.error({
            method: "rule",
            message: `Quark: @${statement.name} must be written inside a rule`,
          });
        } else if (
          statement.type === "atrule" &&
          (statement.name === "dispatch" || statement.name === "command")
        ) {
          QuarkLogger.error({
            method: "rule",
            message: `Quark: @${statement.name} must be written inside an @on block`,
          });
        }
      });
    buildRules(ast.body, false);
    this.rules.forEach((rule) =>
      [
        ...rule.variables,
        ...rule.attributes,
        ...rule.listeners,
        ...rule.diagnostics,
        ...rule.delays,
      ].forEach((prop) => {
        prop.referencedVarNames.forEach((name) =>
          this.bindingIndex.set(name, [
            ...(this.bindingIndex.get(name) ?? []),
            prop,
          ])
        );
        prop.referencedPropNames.forEach((name) =>
          this.propIndex.set(name, [...(this.propIndex.get(name) ?? []), prop])
        );
      })
    );
    // rules that write each other's selector attributes: warn at build
    warnStaticCycles(this);
  }

  /**
   * A binding changed somewhere in the DOM (any sheet, or JS via
   * `element.quark.setProperty()`). If this sheet references the name and the owner is in
   * scope, re-run those properties for the owner's subtree.
   */
  handleBindingChange(e: CustomEvent<BindingChangeDetail>) {
    this.applyBindingChange(e.target as HTMLElement, e.detail);
  }
  applyBindingChange(owner: HTMLElement, detail?: BindingChangeDetail) {
    const { name, sheetId, runId, sinceSeq, trace, selfCovered } =
      detail ?? ({} as BindingChangeDetail);
    // this sheet's own run already refreshed every reader of that write
    if (selfCovered && sheetId === this.id) return;
    const properties = this.bindingIndex.get(name);
    if (!properties?.length) return;
    const host = this.host.deref();
    if (!host) return;
    // owner must be an ancestor-or-self of this sheet's scope, or within it
    if (!(host.contains(owner) || owner.contains(host))) return;
    this.runElement(owner, [name], {
      runId,
      properties,
      isAsyncRun: true,
      changedBinding: { name, origin: new WeakRef(owner), sinceSeq, trace },
    });
  }

  run(mutationMap: MutationMap, options: QuarkOptions = {}) {
    const host = this.host.deref();
    if (!host) return QuarkLogger.error("Quark: Host not found");
    const runId = options?.runId || generateID();
    if (isInfoLogging()) {
      QuarkLogger.info({
        method: "run",
        sheetId: this.id,
        runId: runId,
        changes: new Map(
          [...mutationMap].map(([key, set]) => [key, [...set].join(",")])
        ),
      });
    }
    const trace = (this.runTrace ??= {
      seq: 0,
      ran: new Map(),
      visited: new Map(),
      written: new Set(),
      coverage: new Map(),
    });
    this.runDepth++;
    try {
      /*
       * A sync trigger (binding / prop change) carries the chain in the
       * stamps of the changed names. Observer-driven runs already opened
       * their context in runRules().
       */
      LoopGuard.run(inheritedDepth(mutationMap), () =>
        this.rules?.forEach((rule) => {
          if (
            !options.properties ||
            options.properties.find((p) => p.parent === rule)
          ) {
            rule.run(mutationMap, {
              host,
              options: {
                runId,
                ...this.options,
                ...options,
              },
            });
          }
        })
      );
    } finally {
      this.runDepth--;
      if (this.runDepth === 0) {
        this.runTrace = null;
        this.flushBindingChanges(trace);
      }
    }
  }

  runElement(scope: Element, attrs: string[], options: QuarkOptions = {}) {
    const mutationMap = new Map();
    mutationMap.set(scope, new Set(attrs));
    this.run(mutationMap, options);
  }

  runAll(options: QuarkOptions = {}) {
    const host = this.host.deref();
    if (!host) return QuarkLogger.error("Quark: Host not found");
    this.runElement(host, ["RUN_ALL"], {
      ...options,
      isFirstRun: true,
    });
  }

  register({
    sheetElement,
    modules,
  }: {
    sheetElement: HTMLElement;
    modules?: { [key: string]: Vars };
  }) {
    if (this.isRegistered) {
      throw new Error("Quark: Quark sheet already registered");
    }
    {
      // CAREFUL using this variable. Needs to be garbage collectable.
      const __h = getQuarkHost(sheetElement.parentElement);
      this.host = new WeakRef(__h);
      // scoped selector matching rides on the host marker; only mark when a
      // rule actually queries descendants
      if (this.rules.some((r) => r.isScoped && r.matchSelector)) {
        this.scopeId = acquireScopeId(__h);
      }
      // new children are seen by the MutationObserver (childList), whoever
      // inserted them, no render event contract with elements
      this.listenerConfig = [
        [
          // property changes bubble from the element that owns them
          new WeakRef(__h.getRootNode()),
          PROP_CHANGE_EVENT,
          (e) => this.handlePropChange(e as CustomEvent<PropChangeDetail>),
        ],
        [
          // bindings cascade across sheets, so listen at the root, an
          // owner above this sheet's host is still a valid writer
          new WeakRef(__h.getRootNode()),
          BINDING_CHANGE_EVENT,
          (e) =>
            this.handleBindingChange(e as CustomEvent<BindingChangeDetail>),
        ],
      ];
      const elementInternal = getQuarkInternal(this.host);
      elementInternal.addModules(this.hash, modules);
      QuarkRegistry.add(this);
      this.isRegistered = true;
      this.isFirstRender = true;
      const registration = ++this.registrations;
      publicize(["quark", "sheet", "registered"], {
        weakElement: this.host,
        tag: __h.localName,
        sheetId: this.id,
        hash: this.hash,
        ruleCount: this.rules.length,
        isScoped: !!this.options.isScoped,
      });
      const finish = () => {
        this.isLoadingModules = false;
        // the sheet may have been unregistered while @use modules loaded
        if (!this.isRegistered) return;
        if (this.options.observe) {
          /*
           * Listeners first: binding changes announced during the first
           * run (this run's deferred defs) must reach
           * readers that already ran, whatever the rule order.
           */
          listen(this.listenerConfig);
        }
        this.runAll();
        if (this.hasTransitions) {
          // the first render ends once this run's cascade settles
          whenSettled().then(() => {
            if (this.registrations === registration) {
              this.isFirstRender = false;
            }
          });
        } else {
          this.isFirstRender = false;
        }
        if (this.options.observe) {
          this.allAttrs = this.reduceAttrs();
          const o = observe(this.host, this.allAttrs, this.queueRunRules, {
            childRemovals: this.rules.some((rule) => rule.reactsToRemovals),
            classNames: this.allAttrs.includes("class")
              ? this.reduceClassNames()
              : null,
          });
          if (!o) return QuarkLogger.error("Quark: Observer not created");
          this.observer = o;
        }
      };
      if (this.pendingModules) {
        // First run (and observation) is gated on @use imports so every
        // rule sees its modules; the fetches started at parse time.
        this.isLoadingModules = true;
        this.pendingModules.then((useModules) => {
          const current = elementInternal.getModules(this.hash);
          elementInternal.addModules(this.hash, {
            ...useModules,
            // `as *` exports merge into the bare (dfault) bucket rather
            // than replacing modules passed to register()
            dfault: { ...current?.dfault, ...useModules.dfault },
          });
          finish();
        });
      } else {
        finish();
      }
    }
  }

  unregister() {
    const host = this.host?.deref();
    if (this.isRegistered && host) {
      publicize(["quark", "sheet", "unregistered"], {
        weakElement: this.host,
        tag: host.localName,
        sheetId: this.id,
        hash: this.hash,
      });
    }
    QuarkRegistry.remove(this);
    this.isLoadingModules = false;
    // a delayed block must not fire into a sheet that let go
    this.delayTimers.forEach((timer) => clearTimeout(timer));
    this.delayTimers.clear();
    unobserve(this.observer, this.listenerConfig);
    this.observer = null;
    this.propSubscriptions.forEach((byName) =>
      byName.forEach((release) => release())
    );
    this.propSubscriptions = new Map();
    this.isRegistered = false;
    if (this.scopeId) {
      const host = this.host?.deref();
      if (host) releaseScopeId(host);
      this.scopeId = null;
    }
  }

  /**
   * Observe `element[name]` for this sheet (once per element + name).
   * Called from `prop()` on the first read by a property that statically
   * references the name.
   */
  subscribeProp(element: Element, name: string) {
    if (!this.isRegistered) return;
    let byName = this.propSubscriptions.get(element);
    if (!byName) this.propSubscriptions.set(element, (byName = new Map()));
    if (!byName.has(name)) byName.set(name, subscribeProp(element, name));
  }

  /**
   * A property changed on an element (coalesced per microtask, see
   * props.ts). Re-run this sheet's readers of those names on that
   * element.
   */
  handlePropChange(e: CustomEvent<PropChangeDetail>) {
    const names = e.detail?.names ?? [];
    const properties = names.flatMap((name) => this.propIndex.get(name) ?? []);
    if (!properties.length) return;
    const host = this.host.deref();
    if (!host) return;
    const element = e.target as HTMLElement;
    if (this.options.isScoped && element !== host && !host.contains(element)) {
      return;
    }
    // the assignment that fired this event stamped `(element, name)`
    LoopGuard.run(
      Math.max(0, ...names.map((name) => LoopGuard.depthOf(element, name))),
      () => this.runElement(element, ["PROP"], { properties, isAsyncRun: true })
    );
  }

  private reduceAttrs() {
    const attrs = new Set<string>();
    this.rules.forEach((rule) => {
      rule?.observedAttrs?.forEach((attr) => attrs.add(attr));
    });
    return Array.from(attrs);
  }

  /**
   * Class tokens the rules select on (`.x`), so the observer can drop
   * `class` records that touch none of them. `null` when any class
   * change matters: `[class~="x"]`, an escaped name, `attr("class")`.
   */
  private reduceClassNames(): Set<string> | null {
    const names = new Set<string>();
    for (const rule of this.rules) {
      if (rule.readsAttr("class")) return null;
      for (const deps of [rule.deps, rule.hostDeps]) {
        if (!deps) continue;
        if (!deps.classNames) return null;
        deps.classNames.forEach((name) => names.add(name));
      }
    }
    return names;
  }
}

/** Nearest ancestor-or-self of `element` with a pending write of `name`. */
const nearestPending = (
  pending: Map<Element, Map<string, Omit<BindingChangeDetail, "name">>>,
  element: Element,
  name: string
) => {
  for (let el: Element | null = element; el; el = el.parentElement) {
    const entry = pending.get(el)?.get(name);
    if (entry) return entry;
  }
  return undefined;
};

/**
 * Did the run reach every element below `owner` that `reader`'s rule
 * matches? True when the rule fanned out (full property set) from an
 * ancestor of `owner`, or from `owner` itself if the reader was
 * visited there too or the rule cannot match `owner` (a fan-out
 * root's own properties are not part of a children fan-out).
 */
const isCovered = (
  trace: RunTrace,
  reader: Variable | Attribute | Listener,
  owner: Element,
  host: HTMLElement
): boolean => {
  const roots = trace.coverage.get(reader.parent);
  if (!roots?.size) return false;
  for (let el = owner.parentElement; el; el = el.parentElement) {
    if (roots.has(el)) return true;
  }
  if (!roots.has(owner)) return false;
  return (
    trace.visited.get(owner)?.has(reader) ||
    !reader.parent.matchesElement(owner, host)
  );
};

function generateID() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Wrap sheet source in the implicit `@scope{}`, after any leading `@use`
 * statements. Imports are sheet-level, not scope-level, so they must
 * stay outside the block.
 */
function wrapInScope(min: string): string {
  const insertAt =
    parse(min).body.find(
      (statement) => !(statement.type === "atrule" && statement.name === "use")
    )?.start ?? min.length;
  return `${min.slice(0, insertAt)}@scope{${min.slice(insertAt)}}`;
}

/**
 * `"/mods/string-utils.js"` -> `"string-utils"` (SCSS-style default ns);
 * `"quark:math"` -> `"math"`.
 */
function deriveUseNamespace(url: string): string {
  const path = url.split(/[?#]/)[0].replace(BUILTIN_MODULE_SCHEME, "");
  const segment = path.split("/").filter(Boolean).pop() ?? "";
  return segment.replace(/\.[a-zA-Z]+$/, "");
}

/**
 * Import all `@use` modules in parallel. `as *` exports land in the bare
 * `dfault` bucket; others under their given or derived namespace. Failed
 * imports are logged and skipped so one bad module does not block the
 * sheet.
 */
function loadUseModules(useRules: UseRule[]): Promise<{ [key: string]: Vars }> {
  return Promise.all(
    useRules.map(async (use) => {
      try {
        // `quark:` urls are the built-in modules (no fetch, no loader)
        if (builtinModuleName(use.url) !== null) {
          const mod = resolveBuiltinModule(use.url);
          if (!mod) {
            throw new Error(
              `unknown built-in module; available: ${Object.keys(QUARK_MODULES)
                .map((name) => `"${BUILTIN_MODULE_SCHEME}${name}"`)
                .join(", ")}`
            );
          }
          return { use, mod };
        }
        return { use, mod: await Quark.moduleLoader(use.url) };
      } catch (error) {
        QuarkLogger.error({
          method: "use",
          message: `Quark: Failed to load @use module "${use.url}"`,
          error: [error],
        });
        return null;
      }
    })
  ).then((loaded) => {
    const modules: { [key: string]: Vars } = {};
    for (const entry of loaded) {
      if (!entry) continue;
      const namespace =
        entry.use.namespace ?? deriveUseNamespace(entry.use.url);
      if (namespace === "*") {
        modules.dfault = { ...modules.dfault, ...entry.mod };
      } else {
        modules[namespace] = { ...entry.mod };
      }
    }
    return modules;
  });
}
