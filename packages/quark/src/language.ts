/**
 * Language metadata as data: value keywords, declaration kinds, built-ins,
 * and methods an expression may call. The engine never imports this
 * module. Prose-free tables live in `language-tables.ts`
 * (`METHOD_ALLOWLIST`, `PSEUDO_CLASS_SUPPORT`) so docs stay out of
 * production. Tests check `variables.ts` / `constants.ts` against it;
 * `support/scripts/build-language-docs.mjs` renders the README language
 * reference. Published as `@excom/quark/language`. No deps, so plain
 * Node can import it.
 */
import {
  ALLOWED_METHOD_NAMES,
  METHOD_ALLOWLIST,
  PSEUDO_CLASS_SUPPORT,
  type PseudoClassKind,
  type PseudoClassSupport,
} from "./language-tables";

export {
  ALLOWED_METHOD_NAMES,
  METHOD_ALLOWLIST,
  PSEUDO_CLASS_SUPPORT,
  type PseudoClassKind,
  type PseudoClassSupport,
};

export interface KeywordDoc {
  name: string;
  description: string;
}

/**
 * Bare words with a fixed meaning in every expression scope. Resolve
 * before `@use` exports and built-ins.
 */
export const VALUE_KEYWORDS: readonly KeywordDoc[] = [
  {
    name: "none",
    description:
      "`null`: removes the attribute / CSS variable, clears content, " +
      "or stores `null` in a `$variable`.",
  },
  {
    name: "preserve",
    description:
      "Explicit no-op: leaves the attribute / content / binding exactly " +
      "as it is. Idiom for loading states: `content: $todo.title or preserve`.",
  },
  {
    name: "unset",
    description:
      "`$variables` only: deletes the binding from the matched element so " +
      "consumers fall through to the next ancestor. On any other target it " +
      "degrades to a wipe.",
  },
];

export interface DeclarationKindDoc {
  /** Key shape as written in a sheet. */
  key: string;
  /** What the resolved value does to the matched element. */
  description: string;
  /** Accepted result shapes, in prose. */
  accepts: string;
}

/**
 * Declaration kinds, dispatched on the property key. First matching row
 * wins (`$…` before `--…`, named keys before the attr fallback).
 * Listeners are not declarations: see `AT_RULES`.
 */
export const DECLARATION_KINDS: readonly DeclarationKindDoc[] = [
  {
    key: "$name",
    description:
      "Stores a binding on each matched element; consumers resolve it " +
      "by walking up from their own element (CSS custom-property " +
      "semantics, shared across sheets).",
    accepts: "Any value. `unset` deletes the binding.",
  },
  {
    key: "--name",
    description:
      "Writes the CSS custom property `--name` on the element's inline " +
      "style. Write-only: Quark never reads CSS variables back. A trailing " +
      "`!important` inside the string sets the priority.",
    accepts:
      'A string or number. CSS literals must be quoted (`"#ccc"`, ' +
      '`"10px"`); bare `#hex` / unit numbers are rejected at build.',
  },
  {
    key: "content",
    description:
      "Replaces the element's rendered children (a source `<template>` " +
      "child is kept). Promises are awaited. Writing into a `<template>` " +
      "targets its `.content`. On a `<textarea>` a text result is also " +
      "mirrored to the live `.value` (the text is only the default value).",
    accepts:
      "A string (text), a `Node` / `NodeList`, or the result of " +
      "`template()` / `iterate()` / `dangerous-html()`. Wipe values clear.",
  },
  {
    key: "class",
    description: "Sets the `class` attribute.",
    accepts:
      "A string (replaces), an array (joined with spaces), or an object " +
      "(`{ name: boolean }` toggles each class). Wipe values remove the " +
      "attribute.",
  },
  {
    key: "dataset",
    description:
      "Writes one `data-*` attribute per key (camelCase → dash-case) and " +
      "removes `data-*` attributes this sheet set earlier.",
    accepts:
      "An object. Strings / numbers write as-is, booleans as present / " +
      "absent, string arrays space-joined, objects and other arrays as " +
      "their length.",
  },
  {
    key: "ariaset",
    description: "Same as `dataset`, with the `aria-` prefix.",
    accepts: "An object (same conversions as `dataset`).",
  },
  {
    key: "<anything else>",
    description:
      "Sets the attribute of that name on the matched element (`none` " +
      "removes it). Always contains a dash in practice; " +
      '`autofocus: ""` sets a boolean attribute. On native form controls ' +
      "the attribute is authoritative: `value` / `checked` on `<input>` " +
      "and `selected` on `<option>` also set the live property, so a " +
      "control the user has edited still follows the rule.",
    accepts:
      'A string or number (written as text), a boolean (`true` → `""`, ' +
      "`false` → removed), or a wipe value.",
  },
];

export interface AtRuleDoc {
  /** Statement shape as written in a sheet. */
  syntax: string;
  description: string;
}

/**
 * Quark's at-rules — the whole set the language has. Any other name
 * (`@media`, `@if`, `@keyframes`, …) is a parse error.
 */
export const AT_RULES: readonly AtRuleDoc[] = [
  {
    syntax: '@use "url" [as name | as *];',
    description:
      "Imports a JS module anywhere in the sheet. The namespace defaults to " +
      "the URL's last path segment without its extension; `as *` merges " +
      "exports into the bare scope, last import winning. A `with (…)` " +
      "clause is a parse error.",
  },
  {
    syntax: "@scope { … }",
    description:
      "Rules inside stay anchored to the host in a global sheet (the " +
      "implicit wrapper of a scoped sheet). It takes no prelude.",
  },
  {
    syntax: "@on <event>[, <event>] [(options)] { … }",
    description:
      "Inside a rule: listens for the events (bare names such as `click` " +
      "or `super-form-success`, or strings; a comma list shares one " +
      "listener) on the matched element and applies the block once per " +
      "event — a one-shot transaction. The block is an ordinary rule body: " +
      "declarations write the matched element (attributes, `$variables`, " +
      "`--props`, `content`), nested rules write its matching descendants, " +
      "or its siblings when the nested selector starts with `+` / `~`, " +
      "`@dispatch` / `@command` statements fire after those writes are " +
      "queued. `event` names the DOM event and `target` the delegate (or " +
      "`event.target`) inside the block and in its per-event options. " +
      "`@on` inside a block is not supported.",
  },
  {
    syntax: "@on <event> (option, option: value) …",
    description:
      "An options group after the events gates and configures the " +
      "listener; with it the block is optional (`@on submit " +
      "(prevent-default);`). A bare name is a flag. Filters: `target: " +
      '"<selector>"` (delegation — fires only when the event target is ' +
      "inside a matching descendant; that element is `target` in the " +
      "block), `self` (only when the event target is the matched " +
      'element), `key: "Escape"` / `"Shift+K"` (keyboard chords; ' +
      "space-separated alternatives). Event flags: `prevent-default`, " +
      "`stop-propagation`, `stop-immediate-propagation`. Timing: " +
      "`debounce: <ms>`, `throttle: <ms>`. JS: `handle: fn` — a function " +
      "(or a call returning one, or a list `(a, b)`) called with the event " +
      "before the block, `this` being the element. Registration: `once` " +
      "(removed after the first event that passes the filters), `passive`, " +
      "`capture`, `host: window` / `host: document` (listen there while the " +
      "element is connected; `target` then resolves against the whole " +
      "document). `target`, `key`, `debounce`, `throttle` and `handle` are " +
      "evaluated when the event fires, in the block's scope; the rest once " +
      "per match. Two `@on`s for one event may coexist when their options " +
      "differ.",
  },
  {
    syntax: "@dispatch <event>[, <event>] [(options)];",
    description:
      "Inside an `@on` block (or a nested rule / `@delay` block within " +
      "one): dispatches a `CustomEvent` of each name from the block's " +
      "element after the block's writes are queued — synchronously, " +
      "before they paint, so the event is an occurrence, not a delivery " +
      "of State. Options, evaluated per event: `detail: <expression>`; " +
      '`target: "<selector>"` (every match in the element\'s document; ' +
      "`:scope` = the block's element, not the sheet host — resolved as " +
      "`<event-handler target-ref>` is) or `target: <element | list>` " +
      '(`closest("provider-fetch")`); `host: window` / `host: document`; ' +
      '`form: "<selector>"` or `form: <form>` (its field values become ' +
      "the detail, an explicit `detail` map merges over them); the flags " +
      "`bubbles` (default true), `cancelable` (default true), `composed` " +
      "(default false), each settable to `false`. Dispatching the " +
      "enclosing `@on` event is refused; every dispatch is one loop-guard " +
      "hop, so an event cycle is cut. Not allowed at rule level: a rule " +
      "matching is not an occurrence.",
  },
  {
    syntax: "@command <name>[, <name>] [(target: …)];",
    description:
      "Inside an `@on` block: invokes each command on the target elements " +
      "(the block's element by default; `target` as for `@dispatch`) the " +
      "way a `<button command commandfor>` would — native commands " +
      "(`show-modal`, `close`, `request-close`, `show-popover`, " +
      "`hide-popover`, `toggle-popover`) and custom `--names`, which " +
      "reach the target as a `command` event. Where the browser lacks the " +
      "Invoker Commands API, custom commands are dispatched as a synthetic " +
      "`command` event and native ones call the element's method. Only " +
      "`target` is an option.",
  },
  {
    syntax: "@view-transition [(options)] { … }",
    description:
      "Inside a rule, around rules, or inside an `@on` block: every paint " +
      "of the writes in the block — its declarations (on the rule's " +
      "element) and its nested rules' — commits inside " +
      "`document.startViewTransition()`, so CSS animates the change " +
      "(`view-transition-name`, `::view-transition-*`). It scopes *how* " +
      "writes land, never *when* rules run. The transition waits for " +
      "Quark to settle before the new state is captured, so writes that " +
      "react to these land in the same cut. Committed without a " +
      "transition: writes that change nothing, the sheet's first render, " +
      "`prefers-reduced-motion: reduce`, browsers without the API, and " +
      "writes while another view transition is active.",
  },
  {
    syntax: "@view-transition (option, option: value) { … }",
    description:
      '`types: "a b"` names the transition for ' +
      "`:active-view-transition-type()` (a string or a list). " +
      "`timeout: <ms>` caps the settle wait (default 300). " +
      "`delay: <ms>` holds these writes back first. `first-render` also " +
      "animates the sheet's first render. `if-active: skip | replace`: " +
      "while another transition runs, commit unanimated (default) or " +
      "start anyway, which skips the running one. " +
      '`until: "<selector>"` keeps the transition open until the ' +
      "block's element matches the selector, `until: <promise>` until " +
      "it settles (default timeout 1000; the page is frozen meanwhile, so " +
      "for short waits only). Values are evaluated per write.",
  },
  {
    syntax: "@delay <ms> { … }",
    description:
      "Inside a rule or an `@on` / `@delay` block: applies the block once, " +
      "`<ms>` milliseconds (an expression) after the rule applied or the " +
      "event fired — provided the element is still in the document and " +
      "the rule still matches; otherwise the block is dropped. Applying " +
      "the rule again restarts the timer (one per element). The block is " +
      "an ordinary rule body (declarations write the matched element, " +
      "nested rules its descendants; `event` / `target` are kept inside an " +
      "`@on` block). Timers keep the loop guard's causal depth and are " +
      "cleared when the sheet unregisters.",
  },
  {
    syntax: "@warn <expression>; / @debug <expression>; / @error <expression>;",
    description:
      "Inside a rule or a block: evaluates the expression on the matched " +
      "element and reports it — to the console at that level (`@debug` " +
      "is silent below debug logging) and to DevTools as " +
      "`quark/diagnostic`. The selector is the condition " +
      '(`img:not([alt]) { @warn "img needs alt"; }`). `@warn` / `@error` ' +
      "speak once per element and rule; `@debug` speaks on every " +
      "application, so it re-logs when a binding or `prop()` it reads " +
      "changes. A comma list reports one value per item.",
  },
];

export interface BuiltinDoc {
  name: string;
  /** Call signature, or the bare name for value built-ins. */
  signature: string;
  description: string;
  /** Presentation group in the reference. */
  group: "element" | "loop" | "render" | "event" | "state" | "util" | "debug";
}

/**
 * Built-in expression names. Resolved after value keywords and `@use`
 * exports, so a same-name module export shadows the built-in. Runtime
 * lives in `variables.ts` (`BUILTINS`); a test keeps the lists in sync.
 */
export const BUILTIN_FUNCTIONS: readonly BuiltinDoc[] = [
  {
    name: "attr",
    signature: 'attr("name")',
    description:
      "The matched element's attribute value (`null` when absent). " +
      '`attr("content")` returns its `innerHTML`. A literal name is ' +
      "observed: the rule re-runs when that attribute changes, even if it " +
      "is not in the selector. `attr($name)` reads but does not subscribe.",
    group: "element",
  },
  {
    name: "prop",
    signature: 'prop("name")',
    description:
      'The matched element\'s JS property (`prop("provision")` reads a ' +
      "Neutron provision). A literal name is observed: the rule re-runs " +
      "when JS assigns `element.name` (coalesced per microtask). In-place " +
      "mutation and browser-driven native state are not observed. " +
      "`prop($name)` reads but does not subscribe.",
    group: "element",
  },
  {
    name: "closest",
    signature: 'closest("selector")',
    description:
      "`element.closest(selector)` from the matched element: the nearest " +
      "ancestor-or-self matching the selector, else `null`. Not observed.",
    group: "element",
  },
  {
    name: "element",
    signature: "element",
    description:
      "The matched element itself — the node the rule is applied to " +
      "(inside an `@on … { }` block the listening element; `target` is the " +
      "delegate). Hand it to `@use` functions that need the node: " +
      "`@on click fire(element)`, `$chart: mount(element)`. Reads through " +
      "it are not observed — use `attr()` / `prop()` for reactive reads.",
    group: "element",
  },
  {
    name: "item",
    signature: "item",
    description:
      "Inside an `iterate()` row: the current collection item (the value " +
      "for objects). `undefined` outside a row.",
    group: "loop",
  },
  {
    name: "index",
    signature: "index",
    description:
      "Inside an `iterate()` row: the current position (the key for " +
      "objects). `undefined` outside a row.",
    group: "loop",
  },
  {
    name: "iterate",
    signature: 'iterate(collection, "template-ref"?, "key-property"?)',
    description:
      "For `content`: renders one clone of the element's `<template>` " +
      "child (or the template at `template-ref`, a selector / URL) per " +
      "array item or object entry, keyed by `key-property` (else a content " +
      "hash) so existing rows are reused. `null` / `undefined` wipes the " +
      "rows; an empty collection clears them; a non-collection no-ops.",
    group: "render",
  },
  {
    name: "template",
    signature: 'template("template-ref"?)',
    description:
      "For `content`: renders one clone of the referenced `<template>` " +
      "(selector or URL; defaults to the element's own `<template>` " +
      "child).",
    group: "render",
  },
  {
    name: "dangerous-html",
    signature: "dangerous-html(html)",
    description:
      "For `content`: sets `innerHTML` to the string. No sanitizing: " +
      "never pass user-controlled markup.",
    group: "render",
  },
  {
    name: "event",
    signature: "event",
    description:
      "Inside an `@on … { }` block, its per-event options and its " +
      "`@dispatch` / `@command` statements: the DOM event being handled " +
      "(`event.target`, `event.detail`, …). `undefined` elsewhere.",
    group: "event",
  },
  {
    name: "target",
    signature: "target",
    description:
      "Inside an `@on … { }` block and its per-event options: the element " +
      "the `target:` option matched (the delegate), or `event.target` " +
      "without that option. `undefined` elsewhere.",
    group: "event",
  },
  {
    name: "prevent-default",
    signature: "prevent-default",
    description:
      "A listener that calls `event.preventDefault()`, for `handle:`. The " +
      "`(prevent-default)` flag is the shorter form.",
    group: "event",
  },
  {
    name: "stop-propagation",
    signature: "stop-propagation",
    description:
      "A listener that calls `event.stopPropagation()`, for `handle:`. The " +
      "`(stop-propagation)` flag is the shorter form.",
    group: "event",
  },
  {
    name: "ternary",
    signature: "ternary(condition, whenTrue, whenFalse?)",
    description:
      "`whenTrue` if `condition` is truthy, else `whenFalse` (`null` when " +
      "omitted). Prefer `if()` for multi-arm conditionals.",
    group: "util",
  },
  {
    name: "log",
    signature: "log(...values)",
    description: "Logs the values to the console and returns them as an array.",
    group: "debug",
  },
  {
    name: "debug",
    signature: "debug(...values)",
    description:
      "Hits a `debugger` statement and returns the values as an array.",
    group: "debug",
  },
];

export interface ModuleFunctionDoc {
  name: string;
  /** Call signature (`clamp(min, value, max)`), or the bare name for values (`$pi`). */
  signature: string;
  description: string;
}

export interface ModuleDoc {
  /** Module name without the scheme: `math` for `@use "quark:math"`. */
  name: string;
  description: string;
  functions: readonly ModuleFunctionDoc[];
}

/**
 * Built-in modules, imported like JS modules (`@use "quark:math" as math;`
 * or `as *`); nothing here is global. Grouped the way Sass groups
 * `sass:math` / `sass:list` / `sass:map` / `sass:string`. Every function is
 * pure and null-tolerant: a missing collection reads as empty, a missing
 * value passes through, and results are copies. Collection functions take
 * a dot path (`"user.name"`) instead of a callback. Runtime lives in
 * `builtin-modules.ts` (`QUARK_MODULES`); a test keeps the lists in sync.
 */
export const BUILTIN_MODULES: readonly ModuleDoc[] = [
  {
    name: "math",
    description:
      "Numbers. Arguments are coerced with `parseFloat`; the CSS argument order is kept.",
    functions: [
      { name: "$pi", signature: "math.$pi", description: "π." },
      { name: "$e", signature: "math.$e", description: "Euler's number." },
      {
        name: "min",
        signature: "min(...values)",
        description: "The smallest value (lists are flattened).",
      },
      {
        name: "max",
        signature: "max(...values)",
        description: "The largest value (lists are flattened).",
      },
      {
        name: "clamp",
        signature: "clamp(min, value, max)",
        description: "`value` limited to the range, in CSS argument order.",
      },
      {
        name: "round",
        signature: "round(value, digits?)",
        description: "Rounded to `digits` decimals (default 0).",
      },
      {
        name: "floor",
        signature: "floor(value)",
        description: "Rounded down.",
      },
      { name: "ceil", signature: "ceil(value)", description: "Rounded up." },
      { name: "abs", signature: "abs(value)", description: "Absolute value." },
      {
        name: "mod",
        signature: "mod(value, divisor)",
        description:
          "Wrapping modulo: `mod(-1, 3)` is `2` (the `%` operator keeps the sign). `NaN` for a zero divisor.",
      },
      {
        name: "pow",
        signature: "pow(base, exponent)",
        description: "`base` to the power `exponent`.",
      },
      { name: "sqrt", signature: "sqrt(value)", description: "Square root." },
      {
        name: "percentage",
        signature: "percentage(fraction)",
        description:
          '`"25%"` for `0.25` — a string, ready for an attribute or CSS variable.',
      },
    ],
  },
  {
    name: "list",
    description:
      'Arrays (an object counts as the list of its values). `"path"` arguments are dot paths into each item; comparisons are loose (`==`), like `find()`.',
    functions: [
      {
        name: "count",
        signature: 'count(list, "path"?, value?)',
        description:
          "The number of items; with a path, the items whose value at it is non-empty; with a value too, the items equal to it. `0` for a missing list.",
      },
      {
        name: "find",
        signature: 'find(list, "path", value)',
        description:
          "The first item whose value at the path equals `value`, else `undefined` (was a global built-in before 2026-09-13).",
      },
      {
        name: "filter",
        signature: 'filter(list, "path", value?)',
        description:
          "The items whose value at the path equals `value` — or is non-empty when `value` is omitted.",
      },
      {
        name: "reject",
        signature: 'reject(list, "path", value?)',
        description: "The complement of `filter`.",
      },
      {
        name: "pluck",
        signature: 'pluck(list, "path")',
        description: "The value at the path of every item.",
      },
      {
        name: "sort-by",
        signature: 'sort-by(list, "path"?, "desc"?)',
        description:
          'A sorted copy: numbers numerically, everything else with a locale-aware, numeric-aware comparison; `null` last. `"desc"` reverses.',
      },
      {
        name: "sum",
        signature: 'sum(list, "path"?)',
        description:
          "The total of the items (or of their value at the path); non-numbers count as 0.",
      },
      {
        name: "range",
        signature: "range(end) / range(start, end, step?)",
        description:
          "`range(3)` → `[0, 1, 2]`; `range(1, 4)` → `[1, 2, 3]`; counts down when `start > end`. For skeleton rows and pagination.",
      },
      {
        name: "unique",
        signature: 'unique(list, "path"?)',
        description:
          "A copy without duplicates (by the value at the path when given), first occurrence kept.",
      },
      {
        name: "group-by",
        signature: 'group-by(list, "path")',
        description:
          "A map from each distinct value at the path to the items carrying it.",
      },
      {
        name: "first",
        signature: "first(list)",
        description: "The first item, or `undefined`.",
      },
      {
        name: "last",
        signature: "last(list)",
        description: "The last item, or `undefined`.",
      },
      {
        name: "reverse",
        signature: "reverse(list)",
        description:
          "A reversed copy (was a global built-in before 2026-09-13).",
      },
      {
        name: "compact",
        signature: "compact(list)",
        description:
          'A copy without `null`, `undefined`, `""`, empty lists and empty maps.',
      },
    ],
  },
  {
    name: "map",
    description:
      "Plain objects (`(key: value)` literals, provisions, `dataset`-shaped data). Never mutates; returns copies.",
    functions: [
      {
        name: "get",
        signature: 'get(map, "path", fallback?)',
        description:
          "The value at the dot path, or `fallback` when it is missing.",
      },
      {
        name: "has-key",
        signature: 'has-key(map, "path")',
        description: "Whether the dot path resolves to a value.",
      },
      {
        name: "keys",
        signature: "keys(map)",
        description: "The keys, in insertion order.",
      },
      {
        name: "values",
        signature: "values(map)",
        description: "The values, in insertion order.",
      },
      {
        name: "entries",
        signature: "entries(map)",
        description:
          "`[(key: …, value: …), …]` — iterate a map with `item.key` / `item.value` in the rows.",
      },
      {
        name: "merge",
        signature: "merge(...maps)",
        description: "A shallow merge, later maps winning.",
      },
      {
        name: "pick",
        signature: "pick(map, ...keys)",
        description: "A copy holding only the named keys.",
      },
      {
        name: "omit",
        signature: "omit(map, ...keys)",
        description: "A copy without the named keys.",
      },
    ],
  },
  {
    name: "string",
    description:
      'Text. Values are stringified first; `null` / `undefined` read as `""`.',
    functions: [
      {
        name: "plural",
        signature: "plural(count, forms, locale?)",
        description:
          'The form for `count` from a map keyed by `Intl.PluralRules` category (`one`, `other`, `few`, …); `#` in the form is replaced by the count: `plural($n, (one: "# item", other: "# items"))`.',
      },
      {
        name: "escape-html",
        signature: "escape-html(value)",
        description:
          "`& < > \" '` escaped, for text that goes through `dangerous-html()`.",
      },
      {
        name: "truncate",
        signature: "truncate(value, max, suffix?)",
        description:
          "Cut to `max` characters including the suffix (default `…`).",
      },
      {
        name: "capitalize",
        signature: "capitalize(value)",
        description: "First character upper-cased.",
      },
      {
        name: "slugify",
        signature: "slugify(value)",
        description:
          'Lower-case ASCII with dashes: `"Héllo World!"` → `"hello-world"`.',
      },
    ],
  },
  {
    name: "date",
    description:
      'Dates arrive as strings; these parse and format them. Every function accepts a `Date`, an ISO string or a timestamp and returns `null` / `""` for an unparseable value.',
    functions: [
      {
        name: "parse",
        signature: "parse(value)",
        description:
          "A `Date`, or `null` — for the allowed date methods (`toLocaleDateString()`, `toISOString()`).",
      },
      {
        name: "is-valid",
        signature: "is-valid(value)",
        description: "Whether the value parses as a date.",
      },
      {
        name: "format",
        signature: "format(value, locale?, options?)",
        description:
          '`Intl.DateTimeFormat` output: `format($when, "en-GB", (dateStyle: "medium"))`.',
      },
      {
        name: "add",
        signature: "add(value, amount, unit?)",
        description:
          'A new date `amount` units later (`"days"` by default; seconds … weeks, months, years — months and years step the calendar).',
      },
      {
        name: "diff",
        signature: "diff(later, earlier, unit?)",
        description:
          'Whole units between two dates (`"days"` by default), negative when `later` is earlier.',
      },
    ],
  },
  {
    name: "url",
    description: "Query strings, via `URLSearchParams`.",
    functions: [
      {
        name: "query",
        signature: "query(map)",
        description:
          '`"q=a+b&page=2"` from a map; `null` / `""` values are dropped, lists repeat the key.',
      },
      {
        name: "params",
        signature: "params(url)",
        description:
          "The query of a URL (or a bare query string) as a map; repeated keys become lists.",
      },
      {
        name: "encode",
        signature: "encode(value)",
        description: "`encodeURIComponent`.",
      },
    ],
  },
  {
    name: "util",
    description: "Small value helpers.",
    functions: [
      {
        name: "coalesce",
        signature: "coalesce(...values)",
        description:
          'The first value that is not `null` / `undefined` (`or` also skips `0`, `""` and `false`).',
      },
      {
        name: "is-empty",
        signature: "is-empty(value)",
        description:
          '`true` for `null`, `undefined`, `""`, an empty list or an empty map.',
      },
      {
        name: "type-of",
        signature: "type-of(value)",
        description:
          '`"string"`, `"number"`, `"boolean"`, `"list"`, `"map"`, `"date"`, `"null"`, `"undefined"` or `"function"`.',
      },
      {
        name: "to-json",
        signature: "to-json(value, indent?)",
        description: "`JSON.stringify`, for `content` or a `data-*` attribute.",
      },
      {
        name: "from-json",
        signature: "from-json(text)",
        description: "`JSON.parse`, or `null` when the text is not JSON.",
      },
    ],
  },
];

export type MethodReceiver = "string" | "array" | "number" | "date" | "element";

export interface MethodDoc {
  name: string;
  /** Receiver types the method is meaningful on. */
  on: readonly MethodReceiver[];
  /** Call shape, without the receiver. */
  signature: string;
  description: string;
}

/**
 * Prototype methods an expression may call via the dot accessor
 * (`item.name.toLowerCase()`). Anything else throws. Own-property
 * functions (`@use` namespaces, provided objects) are callable without
 * being listed. Names must match `ALLOWED_METHOD_NAMES` in
 * `language-tables.ts` (tested).
 */
export const ALLOWED_METHODS: readonly MethodDoc[] = [
  // string
  {
    name: "toLowerCase",
    on: ["string"],
    signature: "toLowerCase()",
    description: "Lower-cased copy.",
  },
  {
    name: "toUpperCase",
    on: ["string"],
    signature: "toUpperCase()",
    description: "Upper-cased copy.",
  },
  {
    name: "trim",
    on: ["string"],
    signature: "trim()",
    description: "Copy without leading / trailing whitespace.",
  },
  {
    name: "split",
    on: ["string"],
    signature: "split(separator, limit?)",
    description: "Array of substrings.",
  },
  {
    name: "charAt",
    on: ["string"],
    signature: "charAt(index)",
    description: "The character at `index`.",
  },
  {
    name: "startsWith",
    on: ["string"],
    signature: "startsWith(search, position?)",
    description: "Boolean.",
  },
  {
    name: "endsWith",
    on: ["string"],
    signature: "endsWith(search, length?)",
    description: "Boolean.",
  },
  {
    name: "padStart",
    on: ["string"],
    signature: "padStart(length, fill?)",
    description: "Left-padded copy.",
  },
  {
    name: "padEnd",
    on: ["string"],
    signature: "padEnd(length, fill?)",
    description: "Right-padded copy.",
  },
  {
    name: "replace",
    on: ["string"],
    signature: "replace(search, replacement)",
    description: "Copy with the first match replaced (string search only).",
  },
  {
    name: "replaceAll",
    on: ["string"],
    signature: "replaceAll(search, replacement)",
    description: "Copy with every match replaced (string search only).",
  },
  {
    name: "toString",
    on: ["string", "array", "number", "date"],
    signature: "toString()",
    description: "String form.",
  },
  // string + array
  {
    name: "includes",
    on: ["string", "array"],
    signature: "includes(search)",
    description: "Boolean.",
  },
  {
    name: "slice",
    on: ["string", "array"],
    signature: "slice(start?, end?)",
    description: "Sub-range copy.",
  },
  {
    name: "indexOf",
    on: ["string", "array"],
    signature: "indexOf(search)",
    description: "First position, or `-1`.",
  },
  {
    name: "lastIndexOf",
    on: ["string", "array"],
    signature: "lastIndexOf(search)",
    description: "Last position, or `-1`.",
  },
  {
    name: "concat",
    on: ["string", "array"],
    signature: "concat(...values)",
    description: "Joined copy.",
  },
  {
    name: "at",
    on: ["string", "array"],
    signature: "at(index)",
    description: "Element at `index`; negative counts from the end.",
  },
  // array
  {
    name: "join",
    on: ["array"],
    signature: "join(separator?)",
    description: "String of the items.",
  },
  {
    name: "flat",
    on: ["array"],
    signature: "flat(depth?)",
    description: "Flattened copy.",
  },
  // number
  {
    name: "toFixed",
    on: ["number"],
    signature: "toFixed(digits?)",
    description: "Fixed-point string.",
  },
  {
    name: "toLocaleString",
    on: ["number", "date", "array"],
    signature: "toLocaleString(locale?, options?)",
    description: "Locale-formatted string.",
  },
  // date
  {
    name: "toLocaleDateString",
    on: ["date"],
    signature: "toLocaleDateString(locale?, options?)",
    description: "Locale-formatted date.",
  },
  {
    name: "toLocaleTimeString",
    on: ["date"],
    signature: "toLocaleTimeString(locale?, options?)",
    description: "Locale-formatted time.",
  },
  {
    name: "toISOString",
    on: ["date"],
    signature: "toISOString()",
    description: "ISO 8601 string.",
  },
  // DOM reads
  {
    name: "getAttribute",
    on: ["element"],
    signature: 'getAttribute("name")',
    description: "Attribute value or `null`. Not observed.",
  },
  {
    name: "hasAttribute",
    on: ["element"],
    signature: 'hasAttribute("name")',
    description: "Boolean. Not observed.",
  },
  {
    name: "matches",
    on: ["element"],
    signature: 'matches("selector")',
    description: "Boolean.",
  },
  {
    name: "closest",
    on: ["element"],
    signature: 'closest("selector")',
    description: "Nearest ancestor-or-self matching the selector, or `null`.",
  },
];

/** Method names the evaluator accepts on prototype lookups. */
export interface CombinatorDoc {
  /** As written between two compounds. */
  syntax: string;
  description: string;
}

/**
 * Selector combinators and how the observer follows each. The native
 * engine matches; these rows say which changes re-run a rule that uses
 * them.
 */
export const COMBINATORS: readonly CombinatorDoc[] = [
  {
    syntax: "a b",
    description:
      "Descendant. An attribute change on `a` re-runs the rule for the " +
      "matching `b`s below it.",
  },
  {
    syntax: "a > b",
    description: "Child. Same observation as the descendant combinator.",
  },
  {
    syntax: "a + b",
    description:
      "Next sibling. An attribute change on `a` re-runs the rule from the " +
      "parent; elements inserted or removed under that parent re-run it too.",
  },
  {
    syntax: "a ~ b",
    description: "Subsequent siblings. Same observation as `+`.",
  },
];

export interface PseudoClassRow {
  /** Name without the colon (`nth-child`). */
  name: string;
  /** As written, with a placeholder argument where one is taken. */
  syntax: string;
  description: string;
}

export interface PseudoClassDoc extends PseudoClassRow, PseudoClassSupport {}

/**
 * Pseudo-classes and what Quark observes. `kind` / `attributes` come
 * from `PSEUDO_CLASS_SUPPORT` in `language-tables.ts`; `selector-utils.ts`
 * classifies from that table, so a pseudo cannot be observed without a
 * row here (tested both ways). Anything missing is `unobserved`: first
 * run only, warned at build.
 */
const PSEUDO_CLASS_ROWS: readonly PseudoClassRow[] = [
  // logical
  {
    name: "is",
    syntax: ":is(…)",
    description:
      "Attributes anywhere in the argument list are observed like the " +
      "compound's own. A complex argument (`:is(section[x] li)`) re-runs " +
      "the rule from the changed element down.",
  },
  {
    name: "where",
    syntax: ":where(…)",
    description: "Same as `:is()` (Quark has no specificity).",
  },
  {
    name: "not",
    syntax: ":not(…)",
    description: "Same observation as `:is()`.",
  },
  // relational
  {
    name: "has",
    syntax: ":has(…)",
    description:
      "Attributes named in the argument are observed on descendants, and " +
      "elements inserted or removed below a candidate re-check it: the " +
      "rule re-runs for every matching ancestor of the change. " +
      "Sibling-relative arguments (`:has(+ …)`, `:has(~ …)`) and a `:has()` " +
      "nested in a complex `:is()` / `:not()` argument re-run the whole " +
      "rule from the host instead. Without rule reversion, pair it with " +
      "the inverse `:not(:has(…))` rule.",
  },
  // structural
  {
    name: "first-child",
    syntax: ":first-child",
    description:
      "Sibling position: re-runs when elements are inserted or removed " +
      "under the parent.",
  },
  {
    name: "last-child",
    syntax: ":last-child",
    description: "Same as `:first-child`.",
  },
  {
    name: "only-child",
    syntax: ":only-child",
    description: "Same as `:first-child`.",
  },
  {
    name: "nth-child",
    syntax: ":nth-child(An+B [of S])",
    description:
      "Same as `:first-child`. With `of S`, attributes in `S` are observed " +
      "on the siblings and each change re-runs the rule from the parent.",
  },
  {
    name: "nth-last-child",
    syntax: ":nth-last-child(An+B [of S])",
    description: "Same as `:nth-child()`.",
  },
  {
    name: "first-of-type",
    syntax: ":first-of-type",
    description: "Same as `:first-child`.",
  },
  {
    name: "last-of-type",
    syntax: ":last-of-type",
    description: "Same as `:first-child`.",
  },
  {
    name: "only-of-type",
    syntax: ":only-of-type",
    description: "Same as `:first-child`.",
  },
  {
    name: "nth-of-type",
    syntax: ":nth-of-type(An+B)",
    description: "Same as `:first-child`.",
  },
  {
    name: "nth-last-of-type",
    syntax: ":nth-last-of-type(An+B)",
    description: "Same as `:first-child`.",
  },
  {
    name: "empty",
    syntax: ":empty",
    description:
      "Re-checked when elements are inserted or removed below the " +
      "element. Text-only changes are not observed.",
  },
  // attribute-backed
  {
    name: "disabled",
    syntax: ":disabled",
    description:
      "Observes `disabled` on the element and on ancestors (a disabled " +
      "`<fieldset>`).",
  },
  {
    name: "enabled",
    syntax: ":enabled",
    description: "Same as `:disabled`.",
  },
  {
    name: "required",
    syntax: ":required",
    description: "Observes `required`.",
  },
  {
    name: "optional",
    syntax: ":optional",
    description: "Same as `:required`.",
  },
  {
    name: "read-only",
    syntax: ":read-only",
    description:
      "Observes `readonly`, `disabled` and `contenteditable` on the " +
      "element and its ancestors.",
  },
  {
    name: "read-write",
    syntax: ":read-write",
    description: "Same as `:read-only`.",
  },
  {
    name: "any-link",
    syntax: ":any-link",
    description: "Observes `href`.",
  },
  {
    name: "lang",
    syntax: ":lang(…)",
    description: "Observes `lang` on the element and its ancestors.",
  },
  {
    name: "open",
    syntax: ":open",
    description:
      "Observes the `open` attribute (`<details>`, `<dialog>`). A " +
      "`<select>` / `<input>` picker opening is not observed.",
  },
  // static
  {
    name: "scope",
    syntax: ":scope",
    description: "The host; never changes.",
  },
  {
    name: "root",
    syntax: ":root",
    description: "The document element; never changes.",
  },
  // unobserved (match on the first run only)
  ...Object.keys(PSEUDO_CLASS_SUPPORT)
    .filter((name) => PSEUDO_CLASS_SUPPORT[name].kind === "unobserved")
    .map((name) => ({
      name,
      syntax: `:${name}${name === "dir" ? "(…)" : ""}`,
      description:
        "Interaction or browser state with no attribute behind it: matches " +
        "on the first run only (warned at build). Select on reflected " +
        "attributes instead.",
    })),
];

export const PSEUDO_CLASSES: readonly PseudoClassDoc[] = PSEUDO_CLASS_ROWS.map(
  (row) => ({ ...row, ...PSEUDO_CLASS_SUPPORT[row.name] })
);

/** Pseudo-class name → its row, for the selector classifier. */
export const PSEUDO_CLASS_DOCS: ReadonlyMap<string, PseudoClassDoc> = new Map(
  PSEUDO_CLASSES.map((doc) => [doc.name, doc])
);
