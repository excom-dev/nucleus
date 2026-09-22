# Grid

`.grid` lays its children out in equal auto-fit columns from 768px up, and stacks them below.

## Usage

<include-content data-demo="grid"></include-content>

```html
<div class="grid">
  <div>1</div>
  <div>2</div>
  <div>3</div>
</div>
```

Gaps are `--v-grid-column-gap` / `--v-grid-row-gap` (both `--v-spacing`). Children get `min-width: 0` so overflowing content scrolls instead of stretching the column.

Inside a form, `.grid` also carries the helper-text rule: a `small` right after a `.grid` of inputs is a muted note (see [Forms](./FORMS.md)).
