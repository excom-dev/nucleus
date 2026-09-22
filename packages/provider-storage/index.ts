import { ProviderStorage } from "./provider-storage";

ProviderStorage.define();

export { ProviderStorage };
export type { ProviderStorageChangedEvent } from "./provider-storage";

type T_HTMLProviderStorageElement = typeof ProviderStorage.CustomElement;
declare global {
  interface HTMLProviderStorageElement extends T_HTMLProviderStorageElement {}
  interface Window {
    HTMLProviderStorageElement: HTMLProviderStorageElement;
  }
  interface HTMLElementTagNameMap {
    "provider-storage": HTMLProviderStorageElement;
  }
}
export type { HTMLProviderStorageElement };
