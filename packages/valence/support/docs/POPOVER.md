# Popover

A native `[popover]` opened by a `popovertarget` button is styled as a bubble and anchored to its invoker; `data-placement` picks the side.

## Usage

<include-content data-demo="popover"></include-content>

```html
<button popovertarget="tip">Info</button>
<div id="tip" popover data-placement="bottom">Bubble content</div>
```

- Anchored with CSS anchor positioning (`position-anchor` on the invoker's parent); `data-placement` is `top` (default), `bottom`, `left` or `right`.
- Fades in and out (`@starting-style`, `transition-behavior: allow-discrete`); the UA backdrop is hidden.
- `--v-popover-max-width` (20rem), `--v-popover-background-color`, `--v-popover-border-color`, `--v-popover-color`, `--v-popover-box-shadow`.
- Open state is `:--popover--open`: `:popover-open` or `aria-expanded="true"` (`.tag-popover` for custom hosts).

For text-only hints use a [tooltip](./TOOLTIP.md).
