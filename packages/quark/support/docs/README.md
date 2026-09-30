# quark

CSS-like orchestration for your HTML — bind attributes, render lists, and wire events without a component tree.

Quark is a derivative of CSS, written in CSS syntax. Selectors, nesting, declarations and comments are CSS's own; the few additions Quark makes, such as variables, expressions and at-rules of its own, stay compatible with that syntax, so anyone who can read a stylesheet can read a sheet. What differs is the runtime: a stylesheet paints, a Quark sheet writes State — attributes, content and variables on the elements it matches. Media queries, keyframes and the rest of the browser's style engine stay in your stylesheet.

Prefer `<quark-sheet>` for apps; use the `Quark` class when you need a programmatic host (tests, tooling).

## Features

- **CSS-like sheets** Selectors + nested rules that mutate the live DOM
- **`$variables`** Scoped values that nest and resolve in expressions
- **JS writes** `element.quark.setProperty()` hands values app JS already holds to the document as `$variables`
- **CSS variables** Write `--custom-props` from state; style via `var()`
- **Content rendering** `content`, `template()`, `iterate()`, `dangerous-html()`
- **Element properties** `prop("provision")` reads Neutron provisions / any JS property, re-running on assignment
- **Events** `@on` at-rules with delegation, key, timing and host options, plus `prevent-default` / `stop-propagation`
- **View transitions** `@view-transition` commits a block's writes inside `document.startViewTransition()`, so CSS animates list changes, removals included
- **Delayed writes** `@delay 2000 { … }` applies a block after a pause — flashes, toasts, undo windows — dropped if the rule stopped matching
- **Diagnostics** `@warn` / `@debug` / `@error` report from a rule; the selector is the condition
- **Built-in modules** `@use "quark:math"`, `quark:list`, `quark:map`, `quark:string`, `quark:date`, `quark:url`, `quark:util` — pure helpers, imported like JS modules
- **Attribute helpers** `dataset`, `ariaset`, `class`, `none` to clear
- **JS modules** Pure functions from `@use "/url"`, called in expressions
- **Scoped host** Sheet + targets share a parent; updates follow DOM mutations
- **DevTools** `Quark.attachDevtools()` reports rule applications and `$variables` to the Nucleus DevTools extension

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

App authors almost always load Quark through `<quark-sheet>`:

```html
<section>
  <quark-sheet>
    details[open] [bind-status] {
      content: "Open";
    }
    details:not([open]) [bind-status] {
      content: "Closed";
    }
  </quark-sheet>
  <details>
    <summary>Panel</summary>
    <span bind-status></span>
  </details>
</section>
```

Programmatic API (tests / custom hosts):

```ts
import { Quark } from "@excom/quark";

const quark = new Quark({
  src: `span { content: "four times two equals #{twice(4)}"; }`,
  modules: { dfault: { twice: (n) => n * 2 } },
});
quark.register({ sheetElement }); // host = sheetElement.parentElement
// …
quark.unregister();
```

### Documentation

Syntax

- [Sheets & scoping](./SHEETS.md) — `<quark-sheet>`, `@scope`, `is-global`, what runs
- [Syntax](./SYNTAX.md) — rules, declarations, literals, operators, `if()`

Selectors

- [Selectors](./SELECTORS.md) — combinators and pseudo-classes, what is observed
- [Reactivity](./REACTIVITY.md) — when a rule re-runs, loops, timing
- [No reversion](./NO_REVERSION.md) — write the inverse rule

Declarations

- [Declaration kinds](./DECLARATIONS.md) — what a key does
- [Attributes](./ATTRIBUTES.md) — attributes, `class` / `dataset` / `ariaset`, form controls
- [Content](./CONTENT.md) — `content`, `template()`, `iterate()`, `dangerous-html()`
- [CSS variables](./CSS_VARIABLES.md) — `--custom-props`

Values & expressions

- [Variables](./VARIABLES.md) — `$variables`, cascade, `unset`, raising state
- [Writing from JS](./JS_WRITES.md) — `element.quark.setProperty()`
- [Values & keywords](./VALUES.md) — `none` / `preserve` / `unset`, wipes and no-ops
- [Expressions](./EXPRESSIONS.md) — name resolution, operators, `if()`, lists and maps
- [Built-in functions](./BUILTINS.md) — `attr()`, `prop()`, `iterate()`, `event`, …
- [Allowed methods](./METHODS.md) — `.toFixed()`, `.join()`, …
- [Built-in modules](./MODULES.md) — `@use "quark:math"`, `quark:list`, `quark:map`, `quark:string`, `quark:date`, `quark:url`, `quark:util`
- [Element properties](./ELEMENT_PROPERTIES.md) — `prop("provision")`, `element`

At-rules

- [At-rules](./AT_RULES.md) — the ones that run
- [`@use`](./USE.md) — JS modules, asynchronous work
- [`@on`](./ON.md) — events, blocks, options
- [`@dispatch` / `@command`](./DISPATCH.md) — outgoing events and commands
- [`@view-transition`](./VIEW_TRANSITION.md) — animated writes
- [`@delay`](./DELAY.md) — deferred writes
- [`@warn` / `@debug` / `@error`](./DIAGNOSTICS.md) — diagnostics from a rule

Runtime

- [JS API](./JS_API.md) — `Quark`, `whenSettled()`, DevTools
- [Loop guard](./LOOP_GUARD.md) — runaway chains are cut
- [Limitations](./LIMITATIONS.md) — beta limits and pitfalls

The grammar (EBNF, precedence, AST) is the `quark-parser` package's *Language reference*.

### Examples

#### React to element state

Native element state drives content — no JS, no listeners:

<include-content data-demo="toggle-content"></include-content>

#### List from a provider

`prop("provision")` pulls the fetch payload; `iterate()` renders a row per item and re-renders on every provision:

<include-content data-demo="provider-list"></include-content>

#### Call a module helper

```html
<quark-sheet>
  @use "/helpers.js" as *;

  #out { content: formatPrice($amount); }
</quark-sheet>
```

#### Hand a value from app JS

App JS that already holds a rich value (feature flags, a messages dictionary) hands it to the document with `element.quark.setProperty()`, and every rule reading that `$variable` below the element re-runs. See [Writing from JS](./JS_WRITES.md).

<include-content data-demo="js-api"></include-content>
