import { QuarkSheet } from "./quark-sheet";

QuarkSheet.define();

export { QuarkSheet };

type T_HTMLQuarkSheetElement = typeof QuarkSheet.CustomElement;
declare global {
  interface HTMLQuarkSheetElement extends T_HTMLQuarkSheetElement {}
  interface Window {
    HTMLQuarkSheetElement: HTMLQuarkSheetElement;
  }
  interface HTMLElementTagNameMap {
    "quark-sheet": HTMLQuarkSheetElement;
  }
}
export type { HTMLQuarkSheetElement };
