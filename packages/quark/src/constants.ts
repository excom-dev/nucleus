/**
 * Mutation kind queued on the parent when elements are removed below it.
 * Only rules whose match depends on children or sibling position react
 * (`Rule.reactsToRemovals`). A sheet observes removals only if a rule
 * does.
 */
export const CHILD_REMOVED = "CHILD_REMOVED";

// names Quark never observes (engine markers, inline style, the `content` key);
// `class` / `id` are observed (`.x` / `#x` gate like attributes)
export const ATTRIBUTE_BLACKLIST_REGEXES = [
  /^q-/,
  /^n-/,
  /^style$/,
  /^content$/,
];

/*
 * What an expression result does. Kept here so resolvers stay dumb:
 *
 * - wipe: remove the attr / clear content. `undefined` wipes too. A
 *   declaration that resolves to nothing clears its target (fresh over
 *   stale).
 * - no-op: leave the target as-is. Opt-in via `preserve` (`content:
 *   $todo.title or preserve;` for loading). Failed evals also no-op,
 *   never wipe.
 * - unset: variables only. Deletes the binding so descendants fall
 *   through (CSS `unset` / inherit). On attr / content it degrades to a
 *   wipe.
 */
export const SYMBOL_NOOP = Symbol("preserve");
export const SYMBOL_UNSET = Symbol("unset");

export const TYPES_WIPE: unknown[] = [undefined, null, SYMBOL_UNSET];

export const TYPES_NOOP: unknown[] = [SYMBOL_NOOP];

/** Keyword → value bindings available in every expression scope. */
export const VALUE_MAP = {
  none: null,
  preserve: SYMBOL_NOOP,
  unset: SYMBOL_UNSET,
};

export const isWipe = (value: unknown): boolean => TYPES_WIPE.includes(value);

export const isNoop = (value: unknown): boolean => TYPES_NOOP.includes(value);
