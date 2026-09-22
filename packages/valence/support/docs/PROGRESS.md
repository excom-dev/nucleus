# Progress

`progress` is a slim primary bar; without a `value` it animates as indeterminate.

## Usage

<include-content data-demo="progress"></include-content>

```html
<progress value="35" max="100"></progress>
<progress></progress>
```

Tokens: `--v-progress-background-color`, `--v-progress-color`. The indeterminate animation respects `prefers-reduced-motion`. `[role="progressbar"]` / `.tag-progress` hosts get the track and, with `aria-valuenow`, the bar color on their `::before` (custom hosts size the bar themselves).
