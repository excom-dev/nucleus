# Table

Tables are full-width with bordered rows; `.striped` alternates rows, `thead.sticky` pins the header, and `aria-sort` draws sort markers.

## Usage

<include-content data-demo="table"></include-content>

```html
<table class="striped">
  <thead><tr><th scope="col" aria-sort="ascending">Planet</th>…</tr></thead>
  <tbody>…</tbody>
  <tfoot>…</tfoot>
</table>
```

## Modifiers

| Modifier | Effect |
| --- | --- |
| `.striped` | Odd body rows get `--v-table-row-stripped-background-color` |
| `thead.sticky` | Header cells stick to `--v-table-sticky-top` (default `0px`) while the table scrolls |
| `th[aria-sort]` | A `▲▼` marker; `"ascending"` / `"descending"` show one arrow, and the cell gets a pointer cursor |

Corner cells are rounded (`--v-border-radius`); the last row loses its bottom border so a table sits flush in a card.

## Role-based tables

`[role="table"]`, `[role="row"]`, `[role="columnheader"]` / `[role="rowheader"]`, `[role="cell"]` and `[role="rowgroup"]` (or the `.tag-table` … `.tag-td` classes) render as table parts, so a custom element such as `<data-table>` can build a grid from `div`s and still look like a table. `thead` / `tbody` are told apart by their cells (`th[scope="col"]` vs `th[scope="row"]` / `td`); `tfoot` has no role equivalent.
