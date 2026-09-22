import { Neutron, TEvent } from "@excom/neutron";

export type DataThSortEvent = TEvent & {
  type: "data-th-sort";
  detail: void;
};

/**
 * Sortable column header. Clicking toggles `sort-direction` between `asc`
 * / `desc`; the parent `<data-table>` listens for the resulting
 * `data-th-sort` event to drive sorting and to track which header is
 * active. Renders no chrome of its own — style via `.tag-data-th` or the
 * sort-direction indicators in `data-table`'s stylesheet.
 *
 * @summary Sortable column header — click toggles sort direction.
 *
 * @fires data-th-sort - Dispatched whenever `sort-direction` is set,
 *   whether by a click or programmatically. Bubbles to the parent
 *   `<data-table>`.
 * @type DataThSortEvent
 */
export const DataTh = Neutron({
  tag: "data-th",
  props: {
    /**
     * @option
     * Sort comparator to use for this column's cell values.
     * `data-table` treats `null` as "string".
     * @values string | number | date
     */
    columnType: String,
    /**
     * @option
     * @state
     * Current sort direction. A click toggles between `asc` / `desc`;
     * setting it (by any means) fires `data-th-sort`. Only one `data-th`
     * per table should carry this at a time — the parent `<data-table>`
     * clears the previously active header when a new one is set.
     * @values asc | desc
     */
    sortDirection: String,
  },
})
  .onEvent("click", ({ sortDirection }) => ({
    sortDirection: sortDirection === "asc" ? "desc" : "asc",
  }))
  .onPropSet("sortDirection", () => ({
    emit: ["data-th-sort"],
  }));
