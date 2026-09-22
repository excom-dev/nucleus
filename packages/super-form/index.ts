import { SuperForm } from "./super-form";

SuperForm.define();

export { SuperForm };

type T_HTMLSuperFormElement = typeof SuperForm.CustomElement;
declare global {
  interface HTMLSuperFormElement extends T_HTMLSuperFormElement {}
  interface Window {
    HTMLSuperFormElement: HTMLSuperFormElement;
  }
  interface HTMLElementTagNameMap {
    "super-form": HTMLSuperFormElement;
  }
}
export type { HTMLSuperFormElement };
