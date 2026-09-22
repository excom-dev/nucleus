import { ContentDrawer } from "./content-drawer";

ContentDrawer.define();

export { ContentDrawer };

type T_HTMLContentDrawerElement = typeof ContentDrawer.CustomElement;
declare global {
  interface HTMLContentDrawerElement extends T_HTMLContentDrawerElement {}
  interface Window {
    HTMLContentDrawerElement: HTMLContentDrawerElement;
  }
  interface HTMLElementTagNameMap {
    "content-drawer": HTMLContentDrawerElement;
  }
}
export type { HTMLContentDrawerElement };
