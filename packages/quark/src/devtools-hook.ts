import { evaluateExpression, getExpressionAst } from "./evaluator";
import { type Quark, QuarkRegistry } from "./quark";
import type { QuarkInternal, TQuarkElement } from "./quark-internal";
import type { Rule } from "./rule";
import { createScope } from "./variables";
import {
  type DevtoolsRenderer,
  NUCLEUS_DEVTOOLS_HOOK_VERSION,
  registerRenderer,
  toDevtoolsJson,
} from "@excom/kit-devtools";

/**
 * Quark DevTools probe. Hook is in `@excom/kit-devtools`; this
 * adds the Quark renderer and helpers.
 *
 *   publicize(["quark", "sheet", "registered"], { weakElement: host, sheetId, … })
 *   publicize(["quark", "sheet", "unregistered"], { weakElement: host, sheetId })
 *   publicize(["quark", "apply"], { weakElement, selector, key, expression, result, … })
 *   publicize(["quark", "error"], { weakElement, selector, key, expression, errorMessage, … })
 *
 * `apply` is one property resolve (selector ≡ lifecycle, `{ key: result }`
 * ≡ effect). Group a rule run by `runId`.
 */
export {
  attachDevtools,
  type DevtoolsHook,
  getDevtoolsHook,
  publicize,
} from "@excom/kit-devtools";

export type QuarkInspectSnapshot = {
  tag: string;
  id: string | null;
  /** `$variable` bindings owned by this element. */
  vars: Record<string, unknown>;
  /** Attributes Quark has written on this element, with their current value. */
  attributes: Record<string, string | null>;
  /** CSS custom properties Quark has written on this element's inline style. */
  styleProperties: Record<string, string | null>;
  /**
   * Listeners from Quark `@on` at-rules, per event type, one entry per
   * attached function, tagged with the declaration that produced it
   * (`$expression`, e.g. `setOutputFromDetail`).
   */
  listeners: Record<string, DevtoolsFunctionRef[]>;
  /** `iterate()` row context, when this element is a rendered row. */
  loop: { index: unknown; key: unknown } | null;
  /** Sheet hashes that have touched this element. */
  sheets: string[];
};

/** JSON-safe stand-in for a function, as rendered by DevTools. */
export type DevtoolsFunctionRef = {
  $constructor: "Function";
  /** Quark declaration source that produced it, when known. */
  $expression: string | null;
};

/** `@on <events> [(options)]` handle text of a registered rule, if found. */
const listenerExpression = (
  sheetHash: string,
  ruleId: number,
  slot: string
): string | null => {
  const rule = QuarkRegistry.findRules(ruleId).find(
    (r) => r.quarkInstance.hash === sheetHash
  );
  const listener = rule?.listeners.find((l) => l.key === slot);
  if (!listener) return null;
  // `@on click (handle: a) { … }` → "a { … }"; a bare block shows as "{ … }"
  return [listener.handleText, listener.block ? "{ … }" : ""]
    .filter(Boolean)
    .join(" ");
};

/** One declaration of a rule, as authored (`key: value`). */
export type QuarkDeclarationInfo = {
  key: string;
  value: string;
  /** The `@view-transition` block the write sits in (`@view-transition (types: "t")`). */
  transition?: string;
};

/** One `@warn` / `@debug` / `@error` statement of a rule. */
export type QuarkDiagnosticInfo = {
  level: "warn" | "debug" | "error";
  /** The statement's expression as authored. */
  expression: string;
};

/** One `@delay` block of a rule. */
export type QuarkDelayInfo = {
  /** The duration expression as authored (`2000`, `$ms * 2`). */
  duration: string;
};

/** One `@on` at-rule of a rule. */
export type QuarkListenerInfo = {
  /** Display key: `@on click`, `@on keydown (key: "Escape")`, `@on input, change (handle: save)`. */
  key: string;
  /** DOM event types the listener registers for. */
  events: string[];
  /** The `handle:` option as written, `""` when absent. */
  handlers: string;
  hasBlock: boolean;
};

/** A rule as the agent tooling sees it (no element references). */
export type QuarkRuleInfo = {
  sheetId: number;
  ruleId: number;
  /** Authored selector, nested rules expanded to their full line. */
  selector: string;
  isScoped: boolean;
  numberOfRuns: number;
  declarations: QuarkDeclarationInfo[];
  listeners: QuarkListenerInfo[];
  diagnostics: QuarkDiagnosticInfo[];
  delays: QuarkDelayInfo[];
};

/** A registered sheet. `host` is live; callers serialize it themselves. */
export type QuarkSheetInfo = {
  sheetId: number;
  hash: string;
  host: Element | null;
  scopeId: string | null;
  isScoped: boolean;
  isRegistered: boolean;
  ruleCount: number;
  src: string;
  rules: QuarkRuleInfo[];
};

export type QuarkRenderer = DevtoolsRenderer & {
  kind: "quark";
  isQuarkElement: (el: Element) => boolean;
  inspect: (el: Element) => QuarkInspectSnapshot | null;
  /** Every registered sheet with its rules (agent tooling). */
  sheets: () => QuarkSheetInfo[];
  /**
   * Rules whose selector matches `el` right now, in definition order
   * across sheets (later wins on conflicting writes). Scope-aware.
   */
  matchingRules: (el: Element) => QuarkRuleInfo[];
  /**
   * Evaluate a Quark expression as if declared on a rule matching `el`
   * (`$bindings`, `attr()`, `prop()`, `@use` modules of `sheetId` or of the
   * first sheet touching the element). Returns the raw value; throws the
   * evaluator's error. Read-only by the language's design, but a `@use`
   * function may still side-effect.
   */
  evaluate: (el: Element, expression: string, sheetId?: number) => unknown;
};

const liveSheets = (): Quark[] =>
  QuarkRegistry.sheets
    .map((ref) => ref.deref())
    .filter((sheet): sheet is Quark => !!sheet);

const ruleInfo = (rule: Rule): QuarkRuleInfo => ({
  sheetId: rule.quarkInstance.id,
  ruleId: rule.id,
  selector: rule.selector,
  isScoped: rule.isScoped,
  numberOfRuns: rule.numberOfRuns,
  declarations: [...rule.variables, ...rule.attributes].map(
    ({ key, value, transition }) => ({
      key,
      value,
      ...(transition ? { transition: transition.source } : {}),
    })
  ),
  listeners: rule.listeners.map((listener) => ({
    key: listener.key,
    events: listener.eventTypes,
    handlers: listener.handleText,
    hasBlock: !!listener.block,
  })),
  diagnostics: rule.diagnostics.map(({ level, value }) => ({
    level,
    expression: value,
  })),
  delays: rule.delays.map(({ value }) => ({ duration: value })),
});

const sheetInfo = (sheet: Quark): QuarkSheetInfo => ({
  sheetId: sheet.id,
  hash: sheet.hash,
  host: sheet.host?.deref() ?? null,
  scopeId: sheet.scopeId,
  isScoped: !!sheet.options.isScoped,
  isRegistered: sheet.isRegistered,
  ruleCount: sheet.rules.length,
  src: sheet.src,
  rules: sheet.rules.map(ruleInfo),
});

const rulesMatching = (el: Element): Rule[] =>
  liveSheets().flatMap((sheet) => {
    const host = sheet.host?.deref();
    if (!host || !sheet.isRegistered) return [];
    return sheet.rules.filter((rule) => rule.matchesElement(el, host));
  });

const evaluateOn = (
  el: Element,
  expression: string,
  sheetId?: number
): unknown => {
  // module scope comes from a rule's sheet; pick the requested sheet, else
  // the first one whose rules match the element, else any registered sheet
  const sheets = liveSheets();
  const sheet =
    sheetId !== undefined
      ? sheets.find((s) => s.id === sheetId)
      : (rulesMatching(el)[0]?.quarkInstance ?? sheets[0]);
  const rule = sheet?.rules[0];
  const scope = createScope({
    element: el as HTMLElement,
    options: rule ? { rule } : {},
  });
  return evaluateExpression(getExpressionAst(expression), {
    scope,
    element: el,
  });
};

const inspectInternal = (
  el: Element,
  internal: QuarkInternal
): QuarkInspectSnapshot => {
  const vars: Record<string, unknown> = {};
  for (const name of Object.keys(internal.vars)) {
    try {
      vars[name] = toDevtoolsJson(internal.getVar(name));
    } catch {
      vars[name] = "[unreadable]";
    }
  }
  const attributes: Record<string, string | null> = {};
  const styleProperties: Record<string, string | null> = {};
  const listeners: Record<string, DevtoolsFunctionRef[]> = {};
  const style = (el as HTMLElement).style;
  for (const [sheetHash, instance] of Object.entries(internal.instances)) {
    for (const name of Object.keys(instance.attributes)) {
      if (name === "content") continue;
      if (name.startsWith("--")) {
        const value = style?.getPropertyValue(name);
        styleProperties[name] = value ? value : null;
      } else {
        attributes[name] = el.getAttribute(name);
      }
    }
    for (const [ruleId, rule] of Object.entries(instance.rules)) {
      for (const [slot, fns] of Object.entries(rule.listeners)) {
        const attached = fns.filter(Boolean);
        if (!attached.length) continue;
        const $expression = listenerExpression(sheetHash, Number(ruleId), slot);
        // keyed by events plus options: `click`, `keydown (key: "Escape")`, `input, change (debounce: 300)`
        const eventType = slot.replace(/^@on /, "");
        listeners[eventType] = [
          ...(listeners[eventType] ?? []),
          ...attached.map(() => ({
            $constructor: "Function" as const,
            $expression,
          })),
        ];
      }
    }
  }
  const { index, key } = internal.loop;
  return {
    tag: el.localName,
    id: el.id || null,
    vars,
    attributes,
    styleProperties,
    listeners,
    loop:
      index !== undefined || key !== undefined
        ? { index: index ?? null, key: toDevtoolsJson(key ?? null) }
        : null,
    sheets: Object.keys(internal.instances),
  };
};

const renderer: QuarkRenderer = {
  version: NUCLEUS_DEVTOOLS_HOOK_VERSION,
  kind: "quark",
  isQuarkElement: (el) => !!(el as TQuarkElement)?._q_,
  inspect: (el) => {
    const internal = (el as TQuarkElement)?._q_;
    if (!internal) return null;
    return inspectInternal(el, internal);
  },
  sheets: () => liveSheets().map(sheetInfo),
  matchingRules: (el) => rulesMatching(el).map(ruleInfo),
  evaluate: evaluateOn,
};

registerRenderer(renderer);
