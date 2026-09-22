# Input

Text-like inputs share one look; `search`, date / time, `color` and `file` add their own affordances.

## Types

<include-content data-demo="input"></include-content>

| Type | Extra |
| --- | --- |
| `text`, `email`, `password`, `number`, `tel`, `url` | The base look: `--v-form-element-*` tokens, focus ring |
| `search` | Pill radius (`5rem`) and a leading search icon |
| `date`, `datetime-local`, `month`, `time`, `week` | Trailing calendar / clock icon over the native picker |
| `color` | Swatch fills the control |
| `file` | Borderless, with a secondary-flavored selector button |
| `range` | See [Range](./RANGE.md) |

## States

- `placeholder` uses `--v-form-element-placeholder-color`.
- `aria-invalid="true"` / `"false"` — border, focus ring and a trailing icon (see [Forms](./FORMS.md)).
- `readonly` keeps the resting look on focus; `disabled` fades the control.

## Sizing

Height is derived from the tokens (`1rem × --v-line-height + 2 × --v-form-element-spacing-vertical + 2 × --v-border-width`), so a button and an input line up in a [group](./GROUP.md).
