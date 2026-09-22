import { SuperInput } from "./super-input";

SuperInput.define();

export { SuperInput };

type T_HTMLSuperInputElement = typeof SuperInput.CustomElement;
declare global {
  interface HTMLSuperInputElement extends T_HTMLSuperInputElement {}
  interface Window {
    HTMLSuperInputElement: HTMLSuperInputElement;
  }
  interface HTMLElementTagNameMap {
    "super-input": HTMLSuperInputElement;
  }
}
export type { HTMLSuperInputElement };
