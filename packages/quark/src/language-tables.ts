/**
 * Runtime language tables, the prose-free half of `language.ts`. The
 * engine imports only this module (evaluator method allowlist, selector
 * classifier's pseudo-class support), so the docs in `language.ts` stay
 * out of production. `language.ts` builds its documented rows on these
 * tables; `language-docs.test.ts` keeps the two in step.
 */

/**
 * Prototype methods an expression may call via the dot accessor
 * (`item.name.toLowerCase()`). Anything else throws. Own-property
 * functions (`@use` namespaces, provided objects) are callable without
 * being listed. Documented in `language.ts` `ALLOWED_METHODS`.
 */
export const ALLOWED_METHOD_NAMES: readonly string[] = [
  // string
  "toLowerCase",
  "toUpperCase",
  "trim",
  "split",
  "charAt",
  "startsWith",
  "endsWith",
  "padStart",
  "padEnd",
  "replace",
  "replaceAll",
  "toString",
  // string + array
  "includes",
  "slice",
  "indexOf",
  "lastIndexOf",
  "concat",
  "at",
  // array
  "join",
  "flat",
  // number / date
  "toFixed",
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toISOString",
  // element
  "getAttribute",
  "hasAttribute",
  "matches",
  "closest",
];

export const METHOD_ALLOWLIST: ReadonlySet<string> = new Set(
  ALLOWED_METHOD_NAMES
);

export type PseudoClassKind =
  | "logical"
  | "relational"
  | "structural"
  | "attribute"
  | "static"
  | "unobserved";

export interface PseudoClassSupport {
  kind: PseudoClassKind;
  /** `attribute` kind: the attribute names the pseudo-class reflects. */
  attributes?: readonly string[];
}

const attribute = (...attributes: string[]): PseudoClassSupport => ({
  kind: "attribute",
  attributes,
});

/**
 * Pseudo-class name (no colon) → how Quark observes it.
 * `selector-utils.ts` classifies from this table; anything missing is
 * `unobserved` (first run only, warned at build). Every entry has a row
 * in `language.ts` `PSEUDO_CLASSES`.
 */
export const PSEUDO_CLASS_SUPPORT: Readonly<
  Record<string, PseudoClassSupport>
> = {
  // logical
  is: { kind: "logical" },
  where: { kind: "logical" },
  not: { kind: "logical" },
  // relational
  has: { kind: "relational" },
  // structural
  "first-child": { kind: "structural" },
  "last-child": { kind: "structural" },
  "only-child": { kind: "structural" },
  "nth-child": { kind: "structural" },
  "nth-last-child": { kind: "structural" },
  "first-of-type": { kind: "structural" },
  "last-of-type": { kind: "structural" },
  "only-of-type": { kind: "structural" },
  "nth-of-type": { kind: "structural" },
  "nth-last-of-type": { kind: "structural" },
  empty: { kind: "structural" },
  // attribute-backed
  disabled: attribute("disabled"),
  enabled: attribute("disabled"),
  required: attribute("required"),
  optional: attribute("required"),
  "read-only": attribute("readonly", "disabled", "contenteditable"),
  "read-write": attribute("readonly", "disabled", "contenteditable"),
  "any-link": attribute("href"),
  lang: attribute("lang"),
  open: attribute("open"),
  // static
  scope: { kind: "static" },
  root: { kind: "static" },
  // unobserved (interaction / browser state with no attribute behind it)
  hover: { kind: "unobserved" },
  focus: { kind: "unobserved" },
  "focus-within": { kind: "unobserved" },
  "focus-visible": { kind: "unobserved" },
  active: { kind: "unobserved" },
  visited: { kind: "unobserved" },
  link: { kind: "unobserved" },
  target: { kind: "unobserved" },
  checked: { kind: "unobserved" },
  indeterminate: { kind: "unobserved" },
  default: { kind: "unobserved" },
  valid: { kind: "unobserved" },
  invalid: { kind: "unobserved" },
  "in-range": { kind: "unobserved" },
  "out-of-range": { kind: "unobserved" },
  "placeholder-shown": { kind: "unobserved" },
  "popover-open": { kind: "unobserved" },
  modal: { kind: "unobserved" },
  fullscreen: { kind: "unobserved" },
  defined: { kind: "unobserved" },
  dir: { kind: "unobserved" },
};
