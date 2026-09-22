import { DialogAnchor } from "./dialog-anchor";

DialogAnchor.define();

export { DialogAnchor };

type T_HTMLDialogAnchorElement = typeof DialogAnchor.CustomElement;
declare global {
  interface HTMLDialogAnchorElement extends T_HTMLDialogAnchorElement {}
  interface Window {
    HTMLDialogAnchorElement: HTMLDialogAnchorElement;
  }
  interface HTMLElementTagNameMap {
    "dialog-anchor": HTMLDialogAnchorElement;
  }
}
export type { HTMLDialogAnchorElement };
