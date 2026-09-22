import { IncludeContent } from "./include-content";

IncludeContent.define();

export { IncludeContent };

type T_HTMLIncludeContentElement = typeof IncludeContent.CustomElement;
declare global {
  interface HTMLIncludeContentElement extends T_HTMLIncludeContentElement {}
  interface Window {
    HTMLIncludeContentElement: HTMLIncludeContentElement;
  }
  interface HTMLElementTagNameMap {
    "include-content": HTMLIncludeContentElement;
  }
}
export type { HTMLIncludeContentElement };
