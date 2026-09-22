import { ProviderFetch } from "./provider-fetch";

ProviderFetch.define();

export { ProviderFetch };

type T_HTMLProviderFetchElement = typeof ProviderFetch.CustomElement;
declare global {
  interface HTMLProviderFetchElement extends T_HTMLProviderFetchElement {}
  interface Window {
    HTMLProviderFetchElement: HTMLProviderFetchElement;
  }
  interface HTMLElementTagNameMap {
    "provider-fetch": HTMLProviderFetchElement;
  }
}
export type { HTMLProviderFetchElement };
