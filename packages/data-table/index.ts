import { DataTable } from "./data-table";
import { DataTh } from "./data-th";

DataTable.define();
DataTh.define();

export { DataTable, DataTh };

type T_HTMLDataTableElement = typeof DataTable.CustomElement;
type T_HTMLDataThElement = typeof DataTh.CustomElement;
declare global {
  interface HTMLDataTableElement extends T_HTMLDataTableElement {}
  interface HTMLDataThElement extends T_HTMLDataThElement {}
  interface Window {
    HTMLDataTableElement: HTMLDataTableElement;
    HTMLDataThElement: HTMLDataThElement;
  }
  interface HTMLElementTagNameMap {
    "data-table": HTMLDataTableElement;
    "data-th": HTMLDataThElement;
  }
}
export type { HTMLDataTableElement, HTMLDataThElement };
