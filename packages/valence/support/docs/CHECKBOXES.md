# Checkboxes, radios & switches

Native `checkbox` and `radio` inputs are restyled with the primary color; `role="switch"` turns a checkbox into a toggle.

## Usage

<include-content data-demo="checkboxes"></include-content>

```html
<label><input type="checkbox" checked /> Checked</label>
<label><input type="radio" name="r" /> Radio</label>
<label><input type="checkbox" role="switch" /> Switch</label>
```

- A checkbox in the `indeterminate` state (set from JS) shows a minus.
- A `label` that wraps a checkbox / radio shrinks to its content and gets a pointer cursor; labels after the input (`input ~ label`) stay inline.
- `aria-invalid="true"` / `"false"` recolor the checked control.

## Switch

`[type="checkbox"][role="switch"]` is a `2.25em × 1.25em` track (`--v-switch-background-color`, checked `--v-switch-checked-background-color`) with an animated thumb; inside a [group](./GROUP.md) a switch label becomes an attached segment.
