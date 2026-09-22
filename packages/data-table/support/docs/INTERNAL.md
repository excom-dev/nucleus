Leftover TODOs:

- Pagination. Not implemented — would need its own attribute(s)
  (e.g. `page-size` / `page`) and likely a `data-tfoot` slot for controls.
- `column-type` only supports `string` | `number` | `date` (see
  `CELL_SORTER_MAP` in `data-table.ts`). Don't add `boolean` without a
  comparator.
