/**
 * AST-contract helpers.
 *
 * Quark consumes `@excom/quark-parser` statements directly. These
 * keep AST walks in one place so `Rule` and `Quark` stay small. They
 * slice the exact source for selectors / keys / values, so downstream
 * string handling (expression cache keys, `&` expansion) is
 * byte-identical to the old path.
 */
import type {
  ActionRule,
  Declaration,
  DelayRule,
  EventName,
  ListenerOption,
  ListenerRule,
  Rule as RuleNode,
  Statement,
  TransitionRule,
  UseRule,
  ValueAtRule,
} from "@excom/quark-parser";

export type {
  ActionRule,
  Declaration,
  DelayRule,
  EventName,
  ListenerRule,
  RuleNode,
  Statement,
  TransitionRule,
  UseRule,
  ValueAtRule,
};

/** The at-rule names `viewBlock` reports as diagnostics. */
export const DIAGNOSTIC_LEVELS = ["warn", "debug", "error"] as const;
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];

export interface SpanNode {
  start: number;
  end: number;
}

export const sliceNode = (source: string, node: SpanNode): string =>
  source.slice(node.start, node.end);

/** Comma-separated selector texts of a rule, in source order. */
export const ruleSelectorTexts = (rule: RuleNode, source: string): string[] =>
  rule.selector.selectors.map((sel) => sliceNode(source, sel).trim());

/** `key` / `value` strings of a declaration, matching legacy processing. */
export const declarationStrings = (
  declaration: Declaration,
  source: string
): { key: string; value: string } => ({
  key: sliceNode(source, declaration.property).trim(),
  value: (declaration.value ? sliceNode(source, declaration.value) : "").trim(),
});

/**
 * Event / command names of an `@on` / `@dispatch` / `@command` at-rule as
 * written: `click, "my:evt"`.
 */
export const eventNamesText = (names: EventName[]): string =>
  names.map((n) => (n.quoted ? `"${n.name}"` : n.name)).join(", ");

/**
 * One at-rule option (`@on`, `@view-transition`) as the runtime sees it:
 * its name plus the value source.
 */
export interface ListenerOptionSource {
  name: string;
  /** Value expression source, or `null` for a bare flag (`once`). */
  text: string | null;
  /** The bare identifier name when the value is one (`host: window`). */
  ident: string | null;
}

/** At-rule options as `{ name, text, ident }` records, in source order. */
export const listenerOptionSources = (
  node: { options: ListenerOption[] },
  source: string
): ListenerOptionSource[] =>
  node.options.map((option) => ({
    name: option.name,
    text: option.value ? sliceNode(source, option.value).trim() : null,
    ident:
      option.value?.type === "identifier"
        ? (option.value as { name: string }).name
        : null,
  }));

/** Display form of an options group: ` (target: "li", once)`; `""` when absent. */
export const listenerOptionsText = (sources: ListenerOptionSource[]): string =>
  sources.length
    ? ` (${sources
        .map((o) => (o.text === null ? o.name : `${o.name}: ${o.text}`))
        .join(", ")})`
    : "";

export interface BlockView {
  declarations: Declaration[];
  /** `@on` at-rules, in source order. */
  listeners: ListenerRule[];
  /** `@dispatch` / `@command` statements, in source order. */
  actions: ActionRule[];
  /** `@warn` / `@debug` / `@error` statements, in source order. */
  diagnostics: ValueAtRule[];
  /** `@delay` blocks, in source order. */
  delays: DelayRule[];
  /** Nested rules and `@view-transition` blocks, in source order. */
  children: Array<RuleNode | TransitionRule>;
}

/**
 * Split a block body into the statements Quark executes. `@use` is
 * handled at sheet level (see `collectUseRules`); `@on` becomes a
 * listener; `@dispatch` / `@command` become actions (event blocks only,
 * see `Rule`); `@warn` / `@debug` / `@error` become diagnostics; `@delay`
 * becomes a deferred block; nested rules and `@view-transition` blocks
 * become rules.
 */
export const viewBlock = (body: Statement[]): BlockView => {
  const declarations: Declaration[] = [];
  const listeners: ListenerRule[] = [];
  const actions: ActionRule[] = [];
  const diagnostics: ValueAtRule[] = [];
  const delays: DelayRule[] = [];
  const children: Array<RuleNode | TransitionRule> = [];
  for (const statement of body) {
    if (statement.type === "rule") {
      children.push(statement);
    } else if (statement.type === "atrule" && statement.name === "on") {
      listeners.push(statement as ListenerRule);
    } else if (
      statement.type === "atrule" &&
      (statement.name === "dispatch" || statement.name === "command")
    ) {
      actions.push(statement as ActionRule);
    } else if (
      statement.type === "atrule" &&
      (DIAGNOSTIC_LEVELS as readonly string[]).includes(statement.name)
    ) {
      diagnostics.push(statement as ValueAtRule);
    } else if (statement.type === "atrule" && statement.name === "delay") {
      delays.push(statement as DelayRule);
    } else if (
      statement.type === "atrule" &&
      statement.name === "view-transition"
    ) {
      children.push(statement as TransitionRule);
    } else if (statement.type === "declaration") {
      declarations.push(statement);
    }
    // comments, @use and @scope are intentionally skipped here
  }
  return { declarations, listeners, actions, diagnostics, delays, children };
};

/** Display form of a `@view-transition` block: `@view-transition (types: "t")`. */
export const transitionSourceText = (
  node: TransitionRule,
  source: string
): string =>
  `@view-transition${listenerOptionsText(listenerOptionSources(node, source))}`;

/** Collect `@use` rules from anywhere in the statement tree. */
export const collectUseRules = (body: Statement[]): UseRule[] =>
  body.flatMap((statement) => {
    if (statement.type === "atrule" && statement.name === "use") {
      return [statement as UseRule];
    }
    if (statement.type === "rule") {
      return collectUseRules(statement.block.body);
    }
    // other block-bearing at-rules (notably the `@scope` sheet wrapper)
    if (
      statement.type === "atrule" &&
      "block" in statement &&
      statement.block
    ) {
      return collectUseRules(statement.block.body);
    }
    return [];
  });
