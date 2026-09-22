import { ScrollIntoView } from "./scroll-into-view";

ScrollIntoView.define();

export { ScrollIntoView };

type T_HTMLScrollIntoViewElement = typeof ScrollIntoView.CustomElement;
declare global {
  interface HTMLScrollIntoViewElement extends T_HTMLScrollIntoViewElement {}
  interface Window {
    HTMLScrollIntoViewElement: HTMLScrollIntoViewElement;
  }
  interface HTMLElementTagNameMap {
    "scroll-into-view": HTMLScrollIntoViewElement;
  }
}
export type { HTMLScrollIntoViewElement };
