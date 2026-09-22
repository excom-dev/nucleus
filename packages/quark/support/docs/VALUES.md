# Values & keywords

Three bare words steer what a write does — remove, leave alone, or fall through — and every expression result maps onto one of them.

## Keywords

Bare words with a fixed meaning in every expression. *Generated.*

<!-- generated:value-keywords -->
| Keyword | Meaning |
| --- | --- |
| `none` | `null`: removes the attribute / CSS variable, clears content, or stores `null` in a `$variable`. |
| `preserve` | Explicit no-op: leaves the attribute / content / binding exactly as it is. Idiom for loading states: `content: $todo.title or preserve`. |
| `unset` | `$variables` only: deletes the binding from the matched element so consumers fall through to the next ancestor. On any other target it degrades to a wipe. |
<!-- /generated -->

## Wipes and no-ops

- `none` → `null`: removes the target attribute / clears content.
- An expression resolving to `undefined` or `null` also **wipes** its target (a matched declaration that resolves to nothing clears what it manages).
- `preserve`: explicit no-op — leaves the current attribute / content / binding untouched. Handy for loading states: `content: $todo.title or preserve;`
- `unset`: variables only — deletes the binding (falls through to ancestors).
- A failed expression evaluation never wipes; it logs and no-ops — the Orchestrator never destroys state by mistake.

## Literals

Unitless numbers are numbers; a number with a unit (`10px`, `50%`) and a color (`#ccc`) evaluate to strings; `true`, `false`, `null` are themselves. Strings unescape `\n`, `\t`, `\r`, and `\x` → `x`; interpolated strings (`"Hello #{$name}"`) and `url(…)` join their parts, with `null` / `undefined` parts rendered empty. Lists (space or comma separated) evaluate to arrays; maps (`(name: "Ada")`) to objects — see [Expressions](./EXPRESSIONS.md).
