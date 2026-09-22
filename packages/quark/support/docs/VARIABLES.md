# Variables

`$variables` behave like CSS custom properties: stored on the elements a rule matches, resolved up the DOM, shared across sheets.

## Declaring and reading

```quark
main {
  $label: "Ready";
  $count: twice(21);
  [bind-label] { content: $label; }
  [bind-count] { content: $count; }
}
```

A `$variable` declaration stores its value on each element the rule matches, and a consumer resolves it by walking up from its own element to the nearest ancestor (self included) that holds the binding. They cascade across sheets — a sheet can read a binding another sheet set on an ancestor. Nesting rules is still good style, but a sibling rule's (or another sheet's) variable resolves fine as long as the binding lives on a DOM ancestor of the consumer:

```quark
main { $theme: "dark"; }
[bind-theme] { content: $theme; } /* resolves if inside <main> */
```

## Shadowing and namespaces

When bindings shadow, the nearest DOM ancestor wins (like CSS inheritance). Because storage is shared per element, same-named writers collide (last writer wins) — namespace app bindings (e.g. `$app-theme`) to avoid clashes.

## `unset`

Use `unset` to delete a binding from the matched elements so consumers fall through to the next ancestor — here the open `<details>` shadows the host's binding, and closing it falls back:

<include-content data-demo="unset"></include-content>

## Raising state

A `$variable` declared on a descendant *shadows* the ancestor's; it does not update it. To change an owner's binding from below, write it **on the owner**: an `@on` block on the owner rule, with `target:` delegation when the interaction happens in a descendant:

```quark
:scope {
  $count: 0;
  [bind-count] { content: $count; }
  @on click (target: "button") { $count: $count + 1; }
}
```

A row that raises state reflects a dash-named attribute the owner can read: `ul { @on click (target: "li[data-id]") { $selected: target.getAttribute("data-id"); } }`.

Writing a binding from JavaScript: [Writing from JS](./JS_WRITES.md).
