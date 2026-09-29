# Syntax

Quark is a derivative of CSS, written in CSS syntax. Selectors, nesting, declarations and comments are CSS's own. The few additions Quark makes — `$variables`, expressions, `#{…}` interpolation inside strings, and at-rules of its own (`@use`, `@scope`, `@on`, `@dispatch` / `@command`, `@view-transition`, `@delay`, `@warn` / `@debug` / `@error`) — stay compatible with that syntax, so anyone who can read a stylesheet can read a sheet. What differs is the runtime: a stylesheet paints, a Quark sheet writes State. Features of the browser's style engine, such as media queries and keyframes, stay in your stylesheet.

## Essentials

The full grammar (EBNF, precedence, disambiguation rules) is the `quark-parser` package's *Language reference*; the essentials:

- **Rules** `selector { … }` nest. A nested selector is a descendant of its parent unless it uses `&` (`&[open]`, `&-active`). Lists use `,`; combinators are whitespace, `>`, `+`, `~`.
- **Declarations** `key: value;` — the `;` is optional before `}`, and a declaration takes no `!important`. Keys are attribute names, `$variables`, `--css-vars`, `content`, `class`, `dataset`, `ariaset`.
- **At-rules** `@use "url" as *;` imports; `@on click, change (options) { … }` wires listeners inside a rule (a comma list of event names, an optional `(options)` map, then a block applied once per event, or just the options — a JS listener is `handle: fn` in the map); `@dispatch` / `@command` send events from within an `@on` block; `@scope { … }` anchors rules to the host.
- **Literals** `"strings"` / `'strings'` with `\` escapes and `#{$interpolation}`; numbers `42`, `1.5`, `10px` (a unit makes it a string); `#ccc` colors (strings); `true`, `false`, `null`. Bare words are value keywords, `@use` exports, or built-ins.
- **Operators**, loosest to tightest: `or` · `and` · `not` · `==` `!=` · `<` `>` `<=` `>=` · `+` `-` · `*` `/` `%` · unary `-` `+` · `.` `[…]` `(…)`. Parentheses group.
- **Accessors and calls** `$obj.field`, `$list[0]`, `$obj["key"]`, `ns.$var`; methods `item.name.trim()`; calls `fn($a, $b)`, named `fn($opt: 1)`, spread `fn($args...)`. Only bare names and member chains are callable, not `$variables`.
- **Conditionals** `if($cond: a; $other: b; else: c)` or `ternary($cond, a, b)`.
- **Lists and maps** `1, 2, 3` and `1px solid red` both evaluate to arrays; `(a: 1, b: 2)` is a map. Spacing around a sign matters: `$x +1` is a two-item list, `$x + 1` / `$x+1` add.
- **Comments** `/* … */` only, anywhere whitespace is allowed. `//` is not a comment in CSS, so it is not one in a sheet either: a `//` line is a parse error.
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
  button[data-action="clear"] { @on click { @dispatch cart-clear; } }
}
```

How each declaration key is interpreted: [Declaration kinds](./DECLARATIONS.md). How values evaluate: [Expressions](./EXPRESSIONS.md).
