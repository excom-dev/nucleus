# Expressions

A value is an expression: names resolve through keywords, modules, built-ins and `$bindings`; operators follow JS; accessors never throw.

## Evaluation

- **Names** resolve in order: value keywords → `@use` exports (bare `as *` exports, then namespaces) → built-in functions → `$bindings`. A `$binding` is read by walking up from the matched element to the nearest ancestor-or-self that holds it; an unbound `$name` is `undefined` (a wipe), while an unknown bare identifier is an error (a no-op). A module export shadows a built-in of the same name.
- **Literals**: unitless numbers are numbers; a number with a unit (`10px`, `50%`) and a color (`#ccc`) evaluate to strings. Strings unescape `\n`, `\t`, `\r`, and `\x` → `x`. Interpolated strings and `url(…)` join their parts, with `null` / `undefined` parts rendered empty.
- **`&`** in an expression is the matched element's tag name.
- **Accessors** never throw: `.field` and `[index]` on `null` / `undefined` yield `undefined`. `object.$name` reads the property literally named `$name` (namespaced variables: `math.$pi`).
- **Calls**: a bare callee resolves through the name order above and must be a function. A method call on a value (`item.name.trim()`) is allowed for own-property functions (a `@use` namespace, a provided object) and for the [allowed prototype methods](./METHODS.md); anything else is an error. Calling a method on `null` / `undefined` yields `undefined`. Named arguments are passed positionally (the name is ignored); `$list...` spreads an array.
- **Operators**: `and` / `or` short-circuit and return an operand (JS semantics, so `$title or preserve` works); `not` returns a boolean; `==` / `!=` are loose; `+` concatenates when either side is a string (prefer `#{$x}` interpolation for building strings); `-` `*` `/` `%` and comparisons follow JS.
- **`if()`** returns the value of the first arm whose condition is truthy; with no match and no `else` it is `undefined` (a wipe). `ternary()` is the two-arm function form.
- **Lists** (space or comma separated) evaluate to arrays; **maps** to objects, with bare identifier keys taken literally (`(name: "Ada")` → `{ name: "Ada" }`) and other keys stringified.
- **Results**: listeners and `$variables` apply synchronously; attributes, CSS variables, and content are painted in a batch. A `content` result that is a promise is awaited.

## Example

```quark
[data-user] {
  $user: prop("provision");
  label: $user.profile.name or "Anonymous";
  title: if($user.role == "admin": "Administrator"; else: $user.role);
  data-tags: $user.tags.join(", ");
  --progress: "#{($user.done / $user.total * 100).toFixed(0)}%";
}
```

## Facts over `if()`

Several rules branching on the same condition with `if()` is a smell: derive the condition once as an attribute (`data-is-admin: $user.role == "admin";` — a boolean writes `""` or removes the attribute) and select on it from Quark and CSS.
