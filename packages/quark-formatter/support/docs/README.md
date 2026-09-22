# quark-formatter

Prettier-style formatting for Quark sheets — one call, one canonical style, nothing to configure.

```js
import { format } from "@excom/quark-formatter";

format(`provider-fetch[is-success]{$todos:prop("provision").body;ul{content:iterate($todos)}}`);
// provider-fetch[is-success] {
//   $todos: prop("provision").body;
//   ul {
//     content: iterate($todos);
//   }
// }
```

## Features

- **One style** Two-space indent, 80-column wrapping, one selector per line, single blank lines between groups
- **Safe** Invalid Quark throws instead of rewriting; comments stay where they were written; formatting is idempotent
- **Editor / CLI ready** Powers Format Document in the [Nucleus & Quark extension](/nucleus/packages/nucleus-quark-highlighter) and the monorepo `format` script
- **Self-contained** Parser bundled in; runs in Node, bundlers and browsers

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

`format(source, options?)` returns the formatted sheet as a string. The only option is `indent` (default two spaces).

<include-content data-language="js"><template>import { format } from "@excom/quark-formatter";

const pretty = format(source, { indent: "\t" });</template></include-content>

Invalid input throws `QuarkParseError` (from `@excom/quark-parser`) with the line and column, so callers leave the original file untouched:

<include-content data-language="js"><template>try {
  fs.writeFileSync(file, format(fs.readFileSync(file, "utf8")));
} catch (error) {
  console.error(`${file}: ${error.message}`);
}</template></include-content>

### What gets normalized

- Whitespace, indentation and blank lines (at most one preserved between statements)
- Selector lists: one per line at rule heads, `, `-joined inside `:not()` / `:is()`
- Operator spacing, with only the parentheses the expression needs: `($a or $b) and $c`
- Accessors and call chains print compactly: `$todo.title`, `$row["id"]`, `closest("li").getAttribute("id")`
- Comments (`/* … */` only) keep their position, including trailing same-line comments
- Lines wrap at 80 columns the way prettier wraps CSS: maps, call arguments, `if()` arms, `@on` / `@dispatch` / `@command` / `@view-transition` options and `@delay` durations that overflow break one item per line, operator chains wrap like text, a comma list of multi-word values breaks one value per line

```quark
dataset: (
  trip: event.target.form.elements["data-trip"].value,
  outbound: event.target.form.elements["data-outbound"].value
);
data-mode: if(
  event.target.name == "data-mode": event.target.value;
  else: preserve
);
```

Strings, selectors and interpolations never wrap, so a long `content: "…#{…}…"` stays on one line. Listener at-rules print as `@on input, change (debounce: 300, handle: save) {` — the event list as written, the options group like a map — and `@dispatch` / `@command` statements the same way; `@view-transition (types: "todo-change") {` prints its options like `@on`'s and always opens a block, as does `@scope {`.

Quark is a derivative of CSS, not a superset: the formatter prints Quark's own at-rules — `@use`, `@scope`, `@on`, `@dispatch`, `@command`, `@view-transition`, `@delay`, `@warn`, `@debug`, `@error` — and nothing else. Anything the parser rejects (`@media` and the other CSS at-rules, SCSS's `@if` / `@each` / `@mixin`, `%placeholder` selectors, `#{…}` outside a string, `!important` / `!default`, nested property blocks, `@use … with (…)`) throws rather than being reformatted.

### In the editor

Install the [Nucleus & Quark Syntax Highlighter](/nucleus/packages/nucleus-quark-highlighter) to format `.quark` files with Format Document and inline `<quark-sheet>` blocks with a command.
