/**
 * Grammar tables, the data-driven parts of the Quark grammar, kept in one
 * dependency-free module so the parser, the formatter, tooling, and the
 * language reference (`support/docs/README.md`, locked by tests) read the
 * same values.
 */

/**
 * Binary operator binding powers (Pratt parser). Higher binds tighter; all
 * operators are left-associative. `not` is unary and sits at `NOT_BP`.
 */
export const BINARY_BP: Readonly<Record<string, number>> = {
  or: 1,
  and: 2,
  "==": 4,
  "!=": 4,
  "<": 5,
  ">": 5,
  "<=": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};

/** Binding power of the unary `not` operator (between `and` and `==`). */
export const NOT_BP = 3;

/** Attribute selector operators: `[name<op>value]`. */
export const ATTR_OPERATORS: ReadonlySet<string> = new Set([
  "=",
  "*=",
  "^=",
  "$=",
  "|=",
  "~=",
]);

/**
 * Pseudo-classes whose argument parses as a selector list; every other
 * pseudo-class argument is kept as raw text (`:nth-child(2n+1)`).
 */
export const SELECTOR_PSEUDOS: ReadonlySet<string> = new Set([
  "not",
  "is",
  "where",
  "has",
  "matches",
  "any",
  "-webkit-any",
  "-moz-any",
  "host",
  "host-context",
  "current",
]);

/**
 * Quark's at-rules — the whole set. Each has a dedicated AST node and a
 * parse method; any other name (`@media`, `@if`, `@keyframes`, …) is a
 * parse error, since Quark is a derivative of CSS, not a superset.
 */
export const QUARK_AT_RULES = [
  "use",
  "scope",
  "on",
  "dispatch",
  "command",
  "view-transition",
  "delay",
  "warn",
  "debug",
  "error",
] as const;

export type QuarkAtRuleName = (typeof QUARK_AT_RULES)[number];
