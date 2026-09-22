# data-table

Sortable, filterable tables from plain custom tags — one behavior owner
(`<data-table>` + `<data-th>`), everything else is CSS.

<include-content data-demo="simple"></include-content>

## Features

- **Sort** Click a `<data-th>` to visually sort by string, number, or date
- **Filter** `filter-value` hides non-matching rows
- **Export** The `--export` command downloads visible / all rows as CSV / JSON
- **DOM-stable** Sort / filter via CSS only. Does not conflict with DOM owners, such as Quark.
- **Bindable counts** `.provision` is `{ totalRows, visibleRows, sortColumnIndex, sortDirection, filterValue }` — a "12 of 40 rows" readout is one Quark rule
- **Plain structural tags** `<data-thead>` / `<data-tbody>` / `<data-tr>` /
  `<data-td>` are CSS-only — no registration cost

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Only `<data-table>` and `<data-th>` are registered custom elements.
`<data-thead>`, `<data-tbody>`, `<data-tr>`, `<data-td>`, `<data-tfoot>`, and `<data-tf>` are plain tags — this package's CSS styles them as a table (or apply the equivalent `.tag-data-*` classes).

Sort and filter are visual only (CSS `order` / `display`).
Row nodes never move or leave the DOM, so Quark bindings and `iterate()` tables keep working.

```html
<data-table>
  <data-thead>
    <data-tr>
      <data-th column-type="string" sort-direction="asc">Name</data-th>
      <data-th column-type="number">Age</data-th>
    </data-tr>
  </data-thead>
  <data-tbody>
    <data-tr><data-td>Adam</data-td><data-td>36</data-td></data-tr>
    <data-tr><data-td>Beau</data-td><data-td>29</data-td></data-tr>
  </data-tbody>
</data-table>
```

`<data-tbody>` is required — sorting and filtering both operate on its
`<data-tr>` children.

`.provision` reports the row counts and the active sort / filter, recomputed after connect, after a sort, and after every filter change.
Read it from a rule matching the table:

```quark
data-table {
  $visible: prop("provision").visibleRows;
  $total: prop("provision").totalRows;
  [bind-count] { content: "#{$visible} of #{$total} rows"; }
}
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Filter rows + export as CSV

Filtering is State: write `filter-value` / `filter-casing` on the table — here a Quark `@on input` block copies the search field into them. Matching is case-insensitive unless `filter-casing` is set.

Invoke `--export` on the table (`<button command="--export" commandfor="…">`) to download its visible rows (visual sort order). The button's `data-file-type` is `csv` (default) or `json`; `data-file-name` sets the download name; `data-full` downloads every row in DOM order, regardless of filtering / sorting.

The first export button is the happy path (the table as you see it, including active filter / sort). The form below it writes `data-file-type` / `data-file-name` / `data-full` onto its button.

<include-content data-demo="filter"></include-content>

