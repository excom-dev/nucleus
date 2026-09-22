# quark-parser

Fast, zero-dependency tokenizer and AST parser for the Quark language — the one grammar definition shared by the runtime, the formatter, and tooling.

## Features

- **The whole Quark grammar** CSS-shaped statements and selectors, Quark's own at-rules, and structured expressions: dot / bracket accessors and CSS-style `if()`
- **Real AST** expressions are typed nodes, not token lists; every node carries source spans
- **Three entry points** `parse` (sheet), `parseExpression` (one value), `parseSelectorList` (one selector list)
- **Fast** single-pass charcode tokenizer, Pratt expression parser, no regexes on the hot path
- **Author-facing errors** `QuarkParseError` reports line / column
- **Grammar tables exported** operator precedence, attribute operators, selector pseudos, Quark's at-rules

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

```ts
import { parse, parseExpression, parseSelectorList, tokenize, QuarkParseError } from "@excom/quark-parser";

const ast = parse(`
  provider-fetch[is-success] {
    $items: prop("provision").body;
    ul { content: iterate($items); }
    [bind-label] { content: "Index: #{index}. ID: #{item.id}"; }
  }
`);
// ast.type === "stylesheet"; ast.body[0].type === "rule"; ...

const expr = parseExpression(`iterate($items, ":scope > template", "id")`);
// expr.type === "function"
```

## Language reference

This section defines what **parses**. What the runtime does with a parsed sheet — declaration kinds, value keywords, built-in functions, allowed methods — is the `quark` package's documentation (one page per topic: declaration kinds, values, built-ins, allowed methods, selectors). Quark is a derivative of CSS: rules, selectors, and declarations carry over, the at-rules are its own, and a construct the engine never ran is a parse error rather than a statement the runtime skips (see *Rejected on purpose*).

Notation is EBNF: `=` defines, `|` alternates, `{ x }` repeats zero or more times, `[ x ]` is optional, `"x"` is literal text, and `ws` is whitespace. Every `quark` code block on this page is parsed by the package's tests; blocks marked *invalid* must fail.

### Lexical structure

The tokenizer emits `ident`, `variable`, `at`, `string`, `number`, `hash`, `url`, and `punct` tokens. Whitespace is **not** a token: it sets a `ws` flag on the token that follows, and that flag decides descendant combinators, space-separated lists, and sign handling. Comments are `/* … */` only — a `//` raises `Line comments are not supported, use /* */`, so a sheet stays tokenizable by a CSS engine. They are collected separately and surface as `comment` statements between other statements; they never appear inside a selector or a value.

```ebnf
ws          = ( " " | "\t" | "\n" | "\r" | "\f" ) { " " | "\t" | "\n" | "\r" | "\f" }
comment     = "/*" … "*/"
ident       = ident-start { ident-char } | "-" ident-start { ident-char }
ident-start = letter | "_" | "\" any-char | non-ASCII
ident-char  = ident-start | digit | "-"
variable    = "$" ident-char { ident-char }
at          = "@" ident
string      = '"' { char | "\" any-char | interpolation } '"' | "'" { … } "'"
number      = [ "-" | "+" ] ( digits [ "." digits ] | "." digits ) [ ( "e" | "E" ) [ "-" | "+" ] digits ] [ unit ]
unit        = "%" | ident
hash        = "#" ident-char { ident-char }
url         = "url" "(" raw-text ")"
punct       = "==" | "!=" | "<=" | ">=" | "::" | "*=" | "~=" | "^=" | "|=" | "$=" | "#{" | "..." | any-other-char
```

- **Identifiers** may contain dashes, so `prevent-default`, `dangerous-html`, `-webkit-mask`, and `--accent` are single tokens. The leading `-` joins the identifier only where a value can start (see *Signs*). `and`, `or`, `not`, `true`, `false`, `null`, `if`, and `else` are ordinary identifiers that the parser recognizes by position.
- **Variables** keep their name without the `$`; the name may start with a digit.
- **Strings** keep escapes verbatim (`\"`, `\n`) and may contain `#{…}` interpolation, which is parsed as a nested value.
- **Numbers** split into value and unit: `10px` → `10` + `px`, `50%` → `50` + `%`. `2e3` is an exponent; `2em` is a unit.
- **Hash** tokens become a `color` node when every character is hex (`#ccc`, `#0f0f0f`) and an `identifier` named with the `#` otherwise.
- **Unquoted `url(…)`** is scanned raw when its contents hold no whitespace, quote, `$`, or `(`; otherwise `url(` tokenizes normally and parses as a function call.

#### Signs

`-` and `+` directly followed by a digit (or `.digit`) are part of the number when they stand where a value starts, or when whitespace precedes them and none follows — the CSS `margin: 10px -5px` convention. Everywhere else they are binary operators. The same start-of-value rule lets `-` begin an identifier.

```quark
a {
  sum: $x + 1;      /* addition */
  sum-tight: $x+1;  /* addition */
  list: $x +1;      /* space list: $x, +1 */
  spaced: 10px -5px;
  vendor: -webkit-mask;
}
```

### Statements

```ebnf
stylesheet  = { statement }
statement   = rule | declaration | at-rule | comment | ";"
rule        = selector-list block
block       = "{" { statement } "}"
declaration = key ":" value [ ";" ]
key         = property | variable
property    = ( ident | "*" ) { ident | "*" }
```

- A declaration's `;` is optional before `}` and at end of input; stray `;` are skipped.
- Declarations are allowed at the top level of a sheet (a Quark extension; CSS has none).
- A variable key is a bare `$name`; a dot chain after it (`$sig.value:`, the former signal write) is a parse error that points at the owner-side forms (`@on` block on the owner, `element.quark.setProperty()` from JS).

```quark
$app-theme: "dark";
main {
  $count: 0;
  data-theme: $app-theme;
  [bind-count] { content: $count; }
  @on click (target: "button") { $count: $count + 1; }
}
```

#### Declaration or rule?

The parser scans ahead (skipping `(…)`, `[…]`, and `#{…}`) to the first top-level `{`, `;`, `}`, or end of input, noting the first top-level `:`.

| Terminator | Shape | Result |
| --- | --- | --- |
| `;` / `}` / end | has a top-level `:` | declaration |
| `;` / `}` / end | no `:` | parse error |
| `{` | `ident ":"` at the start **and** whitespace or `{` after the colon | parse error: a nested property block |
| `{` | anything else | rule |

So `a:hover { … }` is a rule, while `a: hover { … }` is the nested property syntax Quark rejects.

### Selectors

```ebnf
selector-list  = selector { "," selector }
selector       = compound { combinator compound }
combinator     = ">" | "+" | "~" | ws
compound       = simple { simple }
simple         = ident | "*" | "." ident | "#" ident-chars | "&" [ ident ]
               | attribute | pseudo-class | pseudo-element
attribute      = "[" ident [ attr-op attr-value [ "i" | "s" ] ] "]"
attr-op        = "=" | "*=" | "^=" | "$=" | "|=" | "~="
attr-value     = string | ident | number
pseudo-class   = ":" ident [ "(" ( selector-list | raw-text ) ")" ]
pseudo-element = "::" ident [ "(" raw-text ")" ]
```

- Whitespace between two simple selectors is a descendant combinator; whitespace around `>`, `+`, `~` is ignored.
- `&` takes an adjacent identifier as its suffix (`&-open`, `&__title`); `&:hover` and `&[open]` are `&` followed by another simple selector.
- The argument of `:not`, `:is`, `:where`, `:has`, `:matches`, `:any`, `:-webkit-any`, `:-moz-any`, `:host`, `:host-context`, and `:current` parses as a selector list; every other pseudo argument is kept as raw text (`:nth-child(2n + 1)`). The `(` must follow the name directly.
- Attribute values are literals only — no expressions and no interpolation inside `[…]`.

```quark
details[open] > summary, .card:not([is-loading]) [bind-status] { content: "Open"; }
li:nth-child(2n + 1)::before { content: "•"; }
.tab {
  &-active { is-active: ""; }
  &[aria-selected="true" i] { tabindex: "0"; }
}
```

### Expressions

Declaration values are expressions, not token lists. A value is a comma list of space lists of operator expressions:

```ebnf
value         = space-list { "," space-list } [ "," ]
space-list    = expression { expression }
expression    = unary { binary-op expression }
binary-op     = "or" | "and" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "+" | "-" | "*" | "/" | "%"
unary         = ( "-" | "+" ) unary | "not" expression | postfix
postfix       = primary { "." ident | "." variable | "[" expression "]" | "(" arguments ")" }
primary       = number | string | color | "true" | "false" | "null" | variable | identifier | "&"
              | interpolation | url | if-function | parens | bracket-list
parens        = "(" ")" | "(" space-list ")" | "(" space-list { "," space-list } [ "," ] ")" | "(" map-entry { "," map-entry } [ "," ] ")"
map-entry     = space-list ":" space-list
bracket-list  = "[" { space-list [ "," ] } "]"
arguments     = [ argument { "," argument } [ "," ] ]
argument      = [ variable ":" ] space-list [ "..." ]
if-function   = "if" "(" if-arm { ";" if-arm } [ ";" ] ")"
if-arm        = ( expression | "else" ) ":" value
interpolation = "#{" value "}"
```

#### Precedence

Lowest to highest. All binary operators are left-associative.

| Level | Operators |
| --- | --- |
| 1 | `or` |
| 2 | `and` |
| 3 | `not` (unary) |
| 4 | `==` `!=` |
| 5 | `<` `>` `<=` `>=` |
| 6 | `+` `-` |
| 7 | `*` `/` `%` |
| — | unary `-` `+` |
| — | `.` `[…]` `(…)` (postfix) |

`not` takes everything tighter than itself as its operand: `not $a == $b` is `not ($a == $b)`, while `not $a and $b` is `(not $a) and $b`. Parentheses group; a parenthesized expression keeps the parens in its span so sliced source re-parses.

```quark
a {
  ready: $a and not $b == $c or $d;
  math: ($x + 1) * 2 % 5 - -$y;
  text: "Total: " + $n + " / " + $total; /* `+` concatenates; prefer "Total: #{$n} / #{$total}" */
}
```

#### Space lists

Two operands with no operator between them form a space-separated list, exactly as in CSS (`1px solid red`). A value can start with an identifier, variable, string, number, hash, `(`, `[`, `#{`, or `&`; the characters `, ; ) ] } { : !` always end a list. A `$variable` followed by `(` is therefore a list of two items, not a call — only identifiers, member chains, and interpolations are callable.

```quark
a {
  border: 1px solid $color;
  pair: $x (1 + 2);
  tags: "a", "b", "c";
}
```

#### Accessors and calls

`.` reads a field (`$obj.field`, `item.name`), `.$name` reads a namespaced variable (`math.$pi`), and `[…]` indexes when the bracket is adjacent to its object (`$tags[$i]`, `$obj["key"]`). A space before `[` starts a bracket list instead. Calls take positional, named (`$name: value`), and spread (`$args...`) arguments; a call on a member chain is a method call.

```quark
a {
  title: item.meta.title.toUpperCase();
  first: "#{$tags[0]} #{$obj["display-name"]}";
  ns: math.$pi * math.round($r);
  named: fetch-user($id: 7, $opts...);
  self: closest(&);
  chained: prop("provision").body.items[index].name;
}
```

#### CSS-style `if()`

`if(` parses as a conditional when its parentheses contain a `:` at depth one; each arm is `condition: value` separated by `;`, and an optional `else:` arm must come last. A colon-less `if(a, b, c)` is an ordinary function call.

```quark
a {
  label: if($n == 0: "none"; $n == 1: "one"; else: "many");
  style: if($active: "bold" "underline"; else: "normal");
  size: if($big: 20; else: 10).toFixed(1);
  fallback: if($a, $b, $c);
}
```

#### Lists and maps

Comma and space lists nest; parentheses and square brackets give a list explicit boundaries. A parenthesized `key: value` sequence is a map.

```quark
a {
  csv: 1, 2, 3;
  spaced: 1 2 3;
  grouped: (1 2) (3 4);
  bracketed: [1, 2, 3];
  empty: ();
  map: (name: "Ada", tags: ("a" "b"), nested: (x: 1));
  interpolated: "Hello #{$user.name}!";
}
```

#### Rejected syntax

JavaScript syntax that appears in legacy sheets is a parse error, with a message naming the alternative. Conditionals use `if()` or `ternary()`; null-safe access is runtime behavior (accessing a field of `null` / `undefined` yields `undefined`), not syntax.

```quark invalid
a { x: $a ? $b : $c; }
```

```quark invalid
a { x: $a?.b; }
```

```quark invalid
a { x: $a ?? $b; }
```

```quark invalid
a { x: $a === $b; }
```

```quark invalid
a { x: $a || $b; }
```

```quark invalid
a { x: $a && $b; }
```

```quark invalid
a { @on click () => go(); }
```

```quark invalid
a { @on click go, prevent-default; }
```

```quark invalid
form { @off submit save; }
```

```quark invalid
button { @on click { @dispatch ping { } } }
```

```quark invalid
ul { @view-transition (types: "todo-change"); }
```

### At-rules

Quark's at-rules are the whole set — `"@use"`, `"@scope"`, `"@on"`, `"@dispatch"`, `"@command"`, `"@view-transition"`, `"@delay"`, `"@warn"`, `"@debug"`, `"@error"` — and each has a dedicated node. One table, `QUARK_AT_RULES`, types the parser's dispatch map, so any other name is a parse error: CSS's `@media` / `@supports` / `@keyframes` / `@font-face` / `@layer` and SCSS's control flow, mixins, and module rules are not part of the language.

```ebnf
at-rule   = "@use" string [ "as" ( ident | "*" ) ] [ ";" ]
          | "@scope" block
          | "@on" name-list [ options ] ( block | [ ";" ] )
          | ( "@dispatch" | "@command" ) name-list [ options ] [ ";" ]
          | "@view-transition" [ options ] block
          | "@delay" value block
          | ( "@warn" | "@debug" | "@error" ) value [ ";" ]
options   = "(" [ option { "," option } ] ")"
option    = ident [ ":" space-list ]
name-list = ( ident | string ) { "," ( ident | string ) }
```

`@use` imports a JS module and takes no `with (…)` clause. `@scope` takes a block and no prelude. `@on` handlers live in the options group (`handle: fn` or `handle: (a, b)`); a bare expression after the event names — the handler list of earlier versions — is an error that points there, and so is an `@on` statement with neither options nor a block (nothing to do). `@off` is not part of the language (it was removed once `@on` gained options and blocks). `@dispatch` and `@command` are statements: a block is an error. `@view-transition` and `@delay` have no statement form: a missing block is an error, and so is a missing `@delay` duration.

```quark
@use "/helpers.js" as *;
@use "/api-client.js" as api;
@scope {
  #out { content: api.getAmount(); }
  form {
    @on submit (prevent-default, handle: api.save);
    @on input, change (debounce: 300) { data-draft: event.target.value; }
    @on keydown (key: "Escape", host: window) { is-open: none; }
    @on click (target: "li[data-id]", once, handle: pick);
    @on reset (prevent-default) {
      data-draft: none;
      @dispatch draft-cleared (detail: (at: event.timeStamp), target: "#status");
      @command --refresh (target: "#preview");
    }
  }
  button[data-copy] {
    @on click {
      data-copied: "";
      @delay 2000 { data-copied: none; }
    }
  }
  img:not([alt]) { @warn "img needs alt"; }
  provider-fetch[is-success] {
    @view-transition (types: "todo-change", timeout: 500) {
      ul { content: iterate($todos, none, "id"); }
    }
  }
}
```

### Rejected on purpose

Quark keeps the CSS the engine runs and nothing else, so what it does not run does not parse. Every rejection names the construct, with the line and column.

| Construct | Message |
| --- | --- |
| an at-rule that is not Quark's own | `@media is not a Quark at-rule` |
| `%placeholder` selectors | `Placeholder selectors are not supported` |
| `#{…}` outside a string — a selector, a property name, an attribute value | `Interpolation is only supported inside strings` |
| `!important`, `!default`, `!global` | `!important is not supported` |
| nested property blocks | `Nested property blocks are not supported` |
| a `@use` configuration | `@use does not take a with clause` |

```quark invalid
@media (width < 600px) { nav { is-compact: ""; } }
```

```quark invalid
@each $name, $glyph in $icons { .icon-#{$name} { content: $glyph; } }
```

```quark invalid
%error-message { content: $message; }
```

```quark invalid
.icon-#{$name} { content: $glyph; }
```

```quark invalid
li[data-id=#{$id}] { is-current: ""; }
```

```quark invalid
a { border-#{$side}-radius: 3px; }
```

```quark invalid
a { color: red !important; }
```

```quark invalid
a { font: { size: 1rem; } }
```

```quark invalid
@use "/theme.js" with ($accent: "red");
```

### AST

`types.ts` is the contract. Every node has `type`, `start`, and `end` (offsets into the source), so consumers slice original text instead of re-serializing.

| Source | Node `type` |
| --- | --- |
| sheet | `stylesheet` → `body: Statement[]` |
| `selector { … }` | `rule` → `selector: selector_list`, `block` |
| `key: value;` | `declaration` → `property` (a `property` with a `name`, or a `variable`), `value` |
| `@use "/x.js" as api;` | `atrule` → `name: "use"`, `url`, `namespace` (`null` = derived from the url, `"*"` = global) |
| `@scope { … }` | `atrule` → `name: "scope"`, `block` |
| `@on click, submit (once, handle: a) { … }` / `@on click (handle: a);` | `atrule` → `name: "on"`, `events: event_name[]` (each `name`, `quoted`), `options: listener_option[]` (each `name`, `value: Expression \| null` — `null` for a flag), `block` (`null` in the statement form) |
| `@dispatch cart-add (detail: $d);` / `@command --refresh (target: "#x");` | `atrule` → `name: "dispatch" \| "command"`, `names: event_name[]`, `options: listener_option[]` |
| `@view-transition (types: "t") { … }` | `atrule` → `name: "view-transition"`, `options: listener_option[]` (same node as `@on`'s), `block` |
| `@delay 2000 { … }` | `atrule` → `name: "delay"`, `duration: Expression`, `block` |
| `@warn "…";` / `@debug $x;` / `@error "…";` | `atrule` → `name: "warn" \| "debug" \| "error"`, `value: Expression` |
| comment | `comment` → `text` |

Expression nodes: `string` (`parts`, `value`), `number` (`value`, `unit`), `color`, `boolean`, `null`, `identifier`, `variable`, `parent_reference` (`&`), `interpolation`, `url`, `function` (`callee`, `args`), `if` (`arms`), `member` (`object`, `property`, `variable`), `index`, `unary`, `binary`, `list` (`separator`, `brackets`, `parens`), `map`.

Selector parts: `type_selector`, `class_selector`, `id_selector`, `attribute_selector`, `pseudo_class_selector`, `pseudo_element_selector`, `parent_selector`, `combinator`.

### Grammar tables

The data-driven parts of the grammar are exported so tooling never re-types them:

| Export | Holds |
| --- | --- |
| `BINARY_BP` | binary operator → binding power (the precedence table above) |
| `NOT_BP` | binding power of unary `not` |
| `ATTR_OPERATORS` | attribute selector operators |
| `SELECTOR_PSEUDOS` | pseudo-classes whose argument is a selector list |
| `QUARK_AT_RULES` | Quark's at-rule names; every other name is rejected |

## Design notes

- Single-pass, charcode-based tokenizer (no regexes on the hot path). Whitespace is a flag on tokens, not a token; comments are collected separately so expression parsing never has to skip them.
- Recursive-descent statement parser + Pratt expression parser. Node naming loosely follows `salesforce-ux/scss-parser` (`stylesheet`, `rule`, `declaration`, `atrule`, `function`, `variable`, ...), but values are structured expression nodes rather than token lists.
- Every node carries `start` / `end` source offsets. `QuarkParseError` reports line / column.
- `QUARK_AT_RULES` types the parser's dispatch map, so an at-rule is one table entry plus one method, and the same table rejects every other name.
