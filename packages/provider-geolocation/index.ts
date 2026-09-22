import { ProviderGeolocation } from "./provider-geolocation";

ProviderGeolocation.define();

export { ProviderGeolocation };

type T_HTMLProviderGeolocationElement =
  typeof ProviderGeolocation.CustomElement;
declare global {
  interface HTMLProviderGeolocationElement extends T_HTMLProviderGeolocationElement {}
  interface Window {
    HTMLProviderGeolocationElement: HTMLProviderGeolocationElement;
  }
  interface HTMLElementTagNameMap {
    "provider-geolocation": HTMLProviderGeolocationElement;
  }
}
export type { HTMLProviderGeolocationElement };
