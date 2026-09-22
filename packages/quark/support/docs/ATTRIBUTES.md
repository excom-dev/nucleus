# Attributes

Any property that is not `$…` / `content` / `class` / `dataset` / `ariaset` becomes an attribute of the matched element; `none` removes it.

## Writing attributes

```quark
dialog[open] input {
  autofocus: "";
}
dialog:not([open]) input {
  autofocus: none;
}
```

A string or number is written as text, a boolean writes `""` (present) or removes the attribute, and a wipe value (`none`, `null`, `undefined`) removes it. Custom attributes always contain a dash (`data-is-empty`, `is-open`) so they can never collide with a native one.

## Reading attributes

A literal `attr("x")` in an expression subscribes to `x` — the rule re-runs when that attribute changes, even if `x` is not in the selector. `attr($name)` does not subscribe.

## Attribute helpers

- `class:` sets the `class` attribute from a string (replaces), an array (joined) or an object (`{ name: boolean }` toggles each class).
- `dataset:` writes one `data-*` attribute per key (camelCase → dash-case) and removes the `data-*` attributes this sheet set earlier; `ariaset:` does the same with the `aria-` prefix. Unpack a pre-defined object (`dataset: item`) rather than constructing a map for it.

## Form controls

On `<input>` and `<option>` the `value` / `checked` / `selected` attributes are only defaults; once the user has touched the control the browser stops mirroring them into the live property. Quark keeps the attribute authoritative: writing `value:` / `checked:` on an `<input>` or `selected:` on an `<option>` also sets the live property, so an edited control follows the rule whenever it writes (even to the value the attribute already holds). Custom elements are not touched, and `<select>` has no `value` attribute (write `selected:` on its options). The sync is one-way: typing never updates an attribute and is not observed.

```quark
[data-unit="f"] input {
  value: ($celsius * 9 / 5 + 32).toFixed(1); /* shows even after the user typed */
}
```

A text result painted into a `<textarea>` is mirrored the same way — see [Content](./CONTENT.md).
