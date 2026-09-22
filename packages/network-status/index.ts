import { NetworkStatus } from "./network-status";

NetworkStatus.define();

export { NetworkStatus };

type T_HTMLNetworkStatusElement = typeof NetworkStatus.CustomElement;
declare global {
  interface HTMLNetworkStatusElement extends T_HTMLNetworkStatusElement {}
  interface Window {
    HTMLNetworkStatusElement: HTMLNetworkStatusElement;
  }
  interface HTMLElementTagNameMap {
    "network-status": HTMLNetworkStatusElement;
  }
}
export type { HTMLNetworkStatusElement };
