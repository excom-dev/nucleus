import type { DataTh } from "./data-th";
import type { DataThSortEvent } from "./data-th";
import { getChildren } from "@excom/kit-utils";
import { ConstructorType, Neutron, TEvent } from "@excom/neutron";

export type { DataThSortEvent };

type TDataThElement = typeof DataTh.CustomElement;

const determineSortNumber = (input: number) =>
  input === 0 ? 0 : input > 0 ? 1 : -1;

const CELL_SORTER_MAP = {
  asc: {
    string: (a: string, b: string) => a.localeCompare(b),
    number: (a: string, b: string) =>
      determineSortNumber(parseFloat(a) - parseFloat(b)),
    date: (a: string, b: string) =>
      determineSortNumber(new Date(b).getTime() - new Date(a).getTime()),
  },
  desc: {
    string: (a: string, b: string) => b.localeCompare(a),
    number: (a: string, b: string) =>
      determineSortNumber(parseFloat(b) - parseFloat(a)),
    date: (a: string, b: string) =>
      determineSortNumber(new Date(a).getTime() - new Date(b).getTime()),
  },
};

type Directions = keyof typeof CELL_SORTER_MAP;
type SortableTypes = keyof typeof CELL_SORTER_MAP.asc;

export type DataTableSortDetail = {
  sortDirection: "asc" | "desc";
  columnType: "string" | "number" | "date";
  columnIndex: number;
  sortFn: (a: string, b: string) => number;
  rows: HTMLElement[];
};

/**
 * Options the `--export` invoker carries as `data-*` attributes
 * (`data-file-type="json"`, `data-file-name="people"`, `data-full`).
 */
export type DataTableExportOptions = {
  full?: boolean;
  fileType?: "csv" | "json";
  fileName?: string;
};

export type DataTableSortEvent = TEvent & {
  type: "data-table-sort";
  detail: DataTableSortDetail;
};

/** Row counts and the active sort / filter of a `<data-table>`. */
export interface DataTableProvision {
  /** `data-tbody > data-tr` rows in the DOM. */
  totalRows: number;
  /** Rows the filter leaves visible (`--data-tr-display` is not `none`). */
  visibleRows: number;
  /** Index of the active `data-th` among its siblings; `null` when unsorted. */
  sortColumnIndex: number | null;
  /** Direction of the active sort; `null` when unsorted. */
  sortDirection: "asc" | "desc" | null;
  /** The current `filter-value`; `null` when no filter is applied. */
  filterValue: string | null;
}

const isSameProvision = (
  a: DataTableProvision | null | undefined,
  b: DataTableProvision
) =>
  !!a &&
  a.totalRows === b.totalRows &&
  a.visibleRows === b.visibleRows &&
  a.sortColumnIndex === b.sortColumnIndex &&
  a.sortDirection === b.sortDirection &&
  a.filterValue === b.filterValue;

const ROW_CONVERSION_MAP = {
  csv: (rows: HTMLElement[]): string => {
    const csv: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row: string[] = [];
      const cols = rows[i].querySelectorAll(
        "data-td, data-th"
      ) as NodeListOf<HTMLElement> | null;
      if (cols) {
        for (let j = 0; j < cols.length; j++) {
          // Strip newlines / doubled spaces so CSV cells stay one line
          let data = cols[j].innerText
            .replace(/(\r\n|\n|\r)/gm, "")
            .replace(/(\s\s)/gm, " ");
          // CSV: escape `"` as `""`
          data = data.replace(/"/g, '""');
          // Quoted cell
          row.push('"' + data + '"');
        }
        csv.push(row.join(","));
      }
    }
    return csv.join("\n");
  },
  json: (rows: HTMLElement[]): string => {
    const json: any[] = [];
    const fields = [...rows[0].querySelectorAll("data-th")].map(
      (th) => th.innerText
    );
    for (let i = 1; i < rows.length; i++) {
      const row: any = {};
      const cols = rows[i].querySelectorAll(
        "data-td, data-th"
      ) as NodeListOf<HTMLElement> | null;
      if (cols) {
        for (let j = 0; j < cols.length; j++) {
          row[fields[j]] = cols[j].innerText;
        }
        json.push(row);
      }
    }
    return JSON.stringify(json, null, 2);
  },
};

/**
 * Sortable, filterable table built from plain custom tags. `<data-table>`
 * and `<data-th>` are the only registered elements — `<data-thead>`,
 * `<data-tbody>`, `<data-tr>`, `<data-td>`, `<data-tfoot>`, and `<data-tf>`
 * are inert structural tags styled by this package's CSS (or the
 * equivalent `.tag-data-*` classes); they carry no behavior of their own.
 * Sort / filter are visual only (CSS `order` / `display`) so row nodes
 * stay put — Quark bindings and `iterate()` tables keep working.
 *
 * `.provision` holds the row counts and the active sort / filter
 * (`{ totalRows, visibleRows, sortColumnIndex, sortDirection, filterValue }`)
 * so a "12 of 40 rows" readout binds with `prop("provision")`.
 *
 * @summary Sortable / filterable data table — plain tags, one behavior owner.
 *
 * @descendant data-th - Sortable column header. Clicking toggles its
 *   `sort-direction` and fires `data-th-sort`, which becomes the active
 *   column.
 * @descendant data-tbody - Required row container. Sorting and filtering
 *   both operate on its `data-tr` children.
 * @descendant data-tr - Row, direct child of `data-tbody`. Gets
 *   `--data-tr-order` on sort and `--data-tr-display` on filter. DOM
 *   order is unchanged.
 * @descendant data-td - Cell within a `data-tr`, read as sortable /
 *   export cell content.
 *
 * @listens data-th-sort - Bubbled up from a descendant `data-th` when its
 *   `sort-direction` changes. Sets that header as the active sort column
 *   (clearing `sort-direction` from the previously active one) and emits
 *   `data-table-sort`.
 * @type DataThSortEvent
 * @command --export - Builds a file from the table's `data-tr` / `data-td`
 *   / `data-th` text content and downloads it. Options are `data-*` on the
 *   invoker: `data-file-type` (`csv`, the default, or `json`),
 *   `data-file-name` (default `export_table_<locale-date>`), and `data-full`
 *   to download every row in DOM order instead of only the visible rows in
 *   visual sort order. Filtering needs no command: write `filter-value` /
 *   `filter-casing`.
 *
 * @fires data-table-sort - Cancelable. Dispatched when the active sort
 *   column / direction changes: on connect (if a `data-th` already has
 *   `sort-direction`) and after every `data-th-sort`. Call
 *   `preventDefault()` to take over sorting yourself.
 * @type DataTableSortEvent
 *
 * @default-action data-table-sort - Sorts `event.detail.rows` by
 *   `columnIndex` with `sortFn` and sets `--data-tr-order` on each row
 *   (visual CSS `order` — DOM order is unchanged).
 */
export const DataTable = Neutron({
  tag: "data-table",
  props: {
    // options
    /**
     * @option
     * Hides `data-tr` rows (via `--data-tr-display: none`) whose text
     * content doesn't include this value. Case-insensitive unless
     * `filter-casing` is set. Unset / empty clears the filter. Rows stay
     * in the DOM so Quark bindings survive.
     */
    filterValue: String,
    /**
     * @option
     * Match `filter-value` case-sensitively instead of the default
     * case-insensitive comparison.
     */
    filterCasing: Boolean,
    /**
     * @provision
     * `{ totalRows, visibleRows, sortColumnIndex, sortDirection,
     * filterValue }` — recomputed after connect, after the
     * `data-table-sort` default action, and after every filter change.
     * Not reflected as an attribute.
     * @type DataTableProvision
     */
    provision: Object as unknown as ConstructorType<DataTableProvision>,
    // private state, not part of the public API
    activeDataTh: {
      type: HTMLElement,
      store: "weak",
    },
    dataTbody: {
      type: HTMLElement,
      store: "weak",
    },
  },
})
  .defineMethods({
    /**
     * Rebuild `provision` from the DOM. New object only when a field
     * changed, so Quark / `neutron-provision` listeners skip no-ops.
     */
    _syncProvision: ({ dataTbody, activeDataTh, filterValue, provision }) => {
      const rows = dataTbody
        ? ([...dataTbody.children] as HTMLElement[]).filter(
            (child) => child.localName === "data-tr"
          )
        : [];
      const next: DataTableProvision = {
        totalRows: rows.length,
        visibleRows: rows.filter(
          (tr) => tr.style.getPropertyValue("--data-tr-display") !== "none"
        ).length,
        sortColumnIndex: activeDataTh?.parentElement
          ? [...activeDataTh.parentElement.children].indexOf(activeDataTh)
          : null,
        // Same default as `fireSortEvent` when the header carries none
        sortDirection: activeDataTh
          ? ((activeDataTh.getAttribute("sort-direction") ||
              "desc") as Directions)
          : null,
        filterValue: filterValue || null,
      };
      return isSameProvision(provision, next) ? {} : { provision: next };
    },
    fireSortEvent: ({ activeDataTh, dataTbody }) => {
      if (!activeDataTh || !dataTbody) return {};
      const rows = getChildren(dataTbody).otherChildren;
      if (!rows?.length || rows.length < 2) return {};
      const sortDirection = (activeDataTh.getAttribute("sort-direction") ||
        "desc") as Directions;
      const columnType = (activeDataTh.getAttribute("column-type") ||
        "string") as SortableTypes;
      const sortFn = CELL_SORTER_MAP[sortDirection][columnType];
      const columnIndex = [...activeDataTh.parentElement!.children].indexOf(
        activeDataTh
      );
      return {
        emit: [
          "data-table-sort",
          {
            detail: {
              // Attrs, not props: THs may not be connected yet when `onConnected` sorts
              sortDirection,
              // Nested tables would need `> data-thead > data-th` instead of this match
              columnType,
              columnIndex,
              sortFn,
              rows,
            },
          },
        ],
      };
    },
  })
  .onConnected((element) => {
    const activeDataTh = element.querySelector(
      "data-th[sort-direction]"
    ) as unknown as TDataThElement;
    const dataTbody = element.querySelector("data-tbody") as HTMLElement;

    return [
      {
        ...(dataTbody && { dataTbody }),
        ...(activeDataTh && { activeDataTh }),
      },
      ...(activeDataTh ? [{ fireSortEvent: [] }] : []),
      { _syncProvision: [] },
    ];
  })
  .onEvent("data-th-sort", (_, e) => {
    return [
      { activeDataTh: e.target as TDataThElement },
      { fireSortEvent: [] },
      // Column / direction are known now, even if `data-table-sort` is later prevented
      { _syncProvision: [] },
    ];
  })
  .onPropChanged("activeDataTh", (_, previous) => {
    previous?.activeDataTh?.removeAttribute("sort-direction");
  })
  .onEventDefault("data-table-sort", (_, e) => {
    const { columnIndex, sortFn, rows } = e.detail;

    if (rows?.length) {
      ([...rows] as HTMLElement[])
        .toSorted((a, b) => {
          return sortFn(
            a?.children?.[columnIndex]?.textContent?.trim() ?? "",
            b?.children?.[columnIndex]?.textContent?.trim() ?? ""
          );
        })
        .forEach((tr, index) => {
          tr.style.setProperty("--data-tr-order", (index + 1).toString());
        });
    }
    return { _syncProvision: [] };
  })
  .onCommand("--export", (element, { source }) => {
    const options = exportOptions(source);
    const { full } = options;
    // Rows from this table
    const fileType = options.fileType?.trim()?.toLowerCase() || "csv";
    if (!(fileType in ROW_CONVERSION_MAP)) {
      // no kit-logger dependency here; a bad option is an authoring error
      console.error(
        `data-table --export: invalid data-file-type "${fileType}" (csv | json)`
      );
      return;
    }
    let rows = [
      ...(element.querySelectorAll("data-tr") as NodeListOf<HTMLElement>),
    ];
    if ([null, undefined, false].includes(full)) {
      rows = rows
        .filter(
          (row) => row.style.getPropertyValue("--data-tr-display") !== "none"
        )
        .toSorted((a, b) => {
          const aVal = parseInt(
            a.style.getPropertyValue("--data-tr-order") || "0"
          );
          const bVal = parseInt(
            b.style.getPropertyValue("--data-tr-order") || "0"
          );
          return determineSortNumber(aVal - bVal);
        });
    }
    // Build CSV
    const str = ROW_CONVERSION_MAP[fileType](rows);
    // Download
    const fileName =
      options.fileName?.trim() ||
      `export_table_${new Date().toLocaleDateString()}`;
    const link = document.createElement("a");
    link.style.display = "none";
    link.setAttribute("target", "_blank");
    link.setAttribute(
      "href",
      `data:text/${fileType};charset=utf-8,${encodeURIComponent(str)}`
    );
    link.setAttribute("download", `${fileName}.${fileType}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  })
  .onPropChanged(["filterValue", "filterCasing"], (element) => {
    const { filterValue, filterCasing } = element;
    const trs = [
      ...element.querySelectorAll("data-tbody > data-tr"),
    ] as HTMLElement[];
    if (filterValue) {
      trs.forEach((tr) => {
        const isHidden = !(filterCasing
          ? tr.innerText.replace(/\t/g, " ").includes(filterValue)
          : tr.innerText
              .toLowerCase()
              .replace(/\t/g, " ")
              .includes(filterValue.toLowerCase()));
        if (isHidden) {
          tr.style.setProperty("--data-tr-display", "none");
        } else {
          tr.style.removeProperty("--data-tr-display");
        }
      });
    } else {
      trs.forEach((tr) => tr.style.removeProperty("--data-tr-display"));
    }
    return { _syncProvision: [] };
  });

/** `--export` options from the invoker's `data-*` (`data-full` = present and not `"false"`). */
function exportOptions(source: Element | null): DataTableExportOptions {
  const data: DOMStringMap =
    source instanceof HTMLElement ? source.dataset : {};
  return {
    fileType: data.fileType as DataTableExportOptions["fileType"],
    fileName: data.fileName,
    full: "full" in data && data.full !== "false",
  };
}
