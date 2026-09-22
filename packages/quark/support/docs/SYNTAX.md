# Syntax

Quark is a derivative of CSS with CSS-compatible syntax. A CSS engine tokenizes a Quark sheet and drops what it does not understand, so a Quark construct never breaks the CSS around it. Nested rules, `&`, custom properties and `/* */` comments are CSS's own — Quark inherits them rather than inventing them. On top of CSS it adds `$variables`, expressions, `#{…}` interpolation inside strings, and its own at-rules: `@use`, `@scope`, `@on`, `@dispatch` / `@command`, `@view-transition`, `@delay`, `@warn` / `@debug` / `@error`. It is a derivative, not a superset: those at-rules are the only ones the language has, and every other one — `@media`, `@keyframes`, `@supports`, SCSS's `@if` / `@mixin` and the rest — is a parse error, as are `%placeholder` selectors, `#{…}` outside a string, `!important` / `!default` / `!global`, and nested property blocks.

## Essentials

The full grammar (EBNF, precedence, disambiguation rules) is the `quark-parser` package's *Language reference*; the essentials:

- **Rules** `selector { … }` nest. A nested selector is a descendant of its parent unless it uses `&` (`&[open]`, `&-active`). Lists use `,`; combinators are whitespace, `>`, `+`, `~`.
- **Declarations** `key: value;` — the `;` is optional before `}`. Keys are attribute names, `$variables`, `--css-vars`, `content`, `class`, `dataset`, `ariaset`.
- **At-rules** `@use "url" as *;` imports; `@on click, change (options) { … }` wires listeners inside a rule (a comma list of event names, an optional `(options)` map, then a block applied once per event, or just the options — JS callouts are `handle: fn` in the map); `@dispatch` / `@command` send events from an `@on` block; `@scope { … }` anchors rules to the host.
- **Literals** `"strings"` / `'strings'` with `\` escapes and `#{$interpolation}`; numbers `42`, `1.5`, `10px` (a unit makes it a string); `#ccc` colors (strings); `true`, `false`, `null`. Bare words are value keywords, `@use` exports, or built-ins.
- **Operators**, loosest to tightest: `or` · `and` · `not` · `==` `!=` · `<` `>` `<=` `>=` · `+` `-` · `*` `/` `%` · unary `-` `+` · `.` `[…]` `(…)`. Parentheses group.
- **Accessors and calls** `$obj.field`, `$list[0]`, `$obj["key"]`, `ns.$var`; methods `item.name.trim()`; calls `fn($a, $b)`, named `fn($opt: 1)`, spread `fn($args...)`. Only bare names and member chains are callable, not `$variables`.
- **Conditionals** `if($cond: a; $other: b; else: c)` or `ternary($cond, a, b)`.
- **Lists and maps** `1, 2, 3` and `1px solid red` both evaluate to arrays; `(a: 1, b: 2)` is a map. Spacing around a sign matters: `$x +1` is a two-item list, `$x + 1` / `$x+1` add.
- **Comments** `/* … */` only, anywhere whitespace is allowed. `//` is not a comment: a sheet has to stay tokenizable by a CSS engine, and CSS tokenizers read `//` as text, so a `//` line is a parse error.
- **Not supported** `? :`, `?.`, `??`, `===`, `||`, `&&`, arrow functions — parse errors by design.

## Example

```quark
/* a comment */
[data-cart] {
  $items: prop("provision").items;
  $total: $items.length or 0;
  data-is-empty: $total == 0; /* a boolean writes "" or removes the attribute */
  [bind-summary] { content: if($total == 1: "1 item"; else: "#{$total} items"); }
  &[data-is-empty] [bind-summary] { content: "Empty"; }
  &[data-is-empty] button[data-action="clear"] { disabled: ""; }
  &:not([data-is-empty]) button[data-action="clear"] { disabled: none; }
  button { @on click (prevent-default, handle: clearCart($items)); }
}
```

How each declaration key is interpreted: [Declaration kinds](./DECLARATIONS.md). How values evaluate: [Expressions](./EXPRESSIONS.md).
