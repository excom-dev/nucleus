# Tooltip

`role="tooltip"` with an `aria-description` shows the text in a bubble on hover and focus, above the element by default.

## Usage

<include-content data-demo="tooltip"></include-content>

```html
<span role="tooltip" aria-description="Shown above">Hover me</span>
<button role="tooltip" aria-description="Placed below" data-placement="bottom">Bottom</button>
```

- `data-placement`: `top` (default), `bottom`, `left`, `right`.
- Plain elements get a dotted underline and help cursor; links, buttons and inputs keep their own look.
- Pure CSS (`::before` / `::after` read `aria-description`), with a slide animation on fine pointers; `--v-tooltip-background-color`, `--v-tooltip-color`.

The docs site uses it on its icon buttons (`role="tooltip" aria-description="Copy source"`). For rich content use a [popover](./POPOVER.md).
