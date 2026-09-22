import { ProviderOrientation } from "./provider-orientation";

ProviderOrientation.define();

export { ProviderOrientation };

type T_HTMLProviderOrientationElement =
  typeof ProviderOrientation.CustomElement;
declare global {
  interface HTMLProviderOrientationElement extends T_HTMLProviderOrientationElement {}
  interface Window {
    HTMLProviderOrientationElement: HTMLProviderOrientationElement;
  }
  interface HTMLElementTagNameMap {
    "provider-orientation": HTMLProviderOrientationElement;
  }
}
export type { HTMLProviderOrientationElement };
