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
/** A failed evaluation: a no-op like `preserve`, told apart where it matters (`@warn` speaks once). */
export const SYMBOL_FAILED = Symbol("failed");

export const TYPES_WIPE: unknown[] = [undefined, null, SYMBOL_UNSET];

export const TYPES_NOOP: unknown[] = [SYMBOL_NOOP, SYMBOL_FAILED];

/** Keyword → value bindings available in every expression scope. */
export const VALUE_MAP = {
  none: null,
  preserve: SYMBOL_NOOP,
  unset: SYMBOL_UNSET,
};

/**
 * Thrown by a read with no value yet that will get one: an unbound
 * `$binding` while hydrating, `item` / `index` of a server row `iterate()`
 * has not adopted. The declaration preserves and re-runs once it is there.
 */
export const PENDING_READ = new Error(
  "Quark: no value yet, the rendered content is kept"
);

export const isWipe = (value: unknown): boolean => TYPES_WIPE.includes(value);

export const isNoop = (value: unknown): boolean => TYPES_NOOP.includes(value);

export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value &&
  typeof value === "object" &&
  typeof (value as PromiseLike<unknown>).then === "function";

/*
 * Promises of Quark's own render built-ins (`template()`, `iterate()`):
 * the only ones `content:` awaits. Any other promise is refused.
 */
const RENDER_PROMISES = new WeakSet<object>();

export const markRenderPromise = <T>(value: T): T => {
  if (isThenable(value)) RENDER_PROMISES.add(value);
  return value;
};

export const isRenderPromise = (value: unknown): boolean =>
  RENDER_PROMISES.has(value as object);
